package io.github.lz007001cn.veriqra.integration;

import io.github.lz007001cn.veriqra.model.*;
import io.github.lz007001cn.veriqra.service.DefectCommentService;
import io.github.lz007001cn.veriqra.service.command.CreateAdHocRunCommand;
import io.github.lz007001cn.veriqra.service.command.CreateDefectCommand;
import io.github.lz007001cn.veriqra.service.command.RecordAttemptCommand;
import io.github.lz007001cn.veriqra.service.exception.ConflictException;
import io.github.lz007001cn.veriqra.service.exception.ForbiddenException;
import io.github.lz007001cn.veriqra.service.exception.NotFoundException;
import io.github.lz007001cn.veriqra.service.exception.ValidationException;
import org.junit.jupiter.api.Test;

import javax.imageio.ImageIO;
import java.awt.image.BufferedImage;
import java.io.ByteArrayOutputStream;
import java.util.Base64;
import java.util.List;
import java.util.UUID;

import static org.junit.jupiter.api.Assertions.*;

class DefectCommentServiceIntegrationTest extends ServiceFixture {
    @Test void evidenceIsProjectScopedAndSubmittingTheSameCommentCanBeRetried() throws Exception {
        User admin = actor("comment-admin", SystemRole.ADMIN, UserStatus.ACTIVE);
        User tester = actor("comment-tester", SystemRole.USER, UserStatus.ACTIVE);
        User developer = actor("comment-dev", SystemRole.USER, UserStatus.ACTIVE);
        User outsider = actor("comment-outsider", SystemRole.USER, UserStatus.ACTIVE);
        Project project = createProject(admin, "COMMENTS", tester, ProjectRole.TESTER);
        Project otherProject = createProject(admin, "OTHERCOMMENTS", outsider, ProjectRole.TESTER);
        addMember(project, developer, ProjectRole.DEVELOPER, MembershipStatus.ACTIVE);
        TestCase testCase = readyCase(tester, project, "Reported failure", 1);
        TestRun run = testRuns.createAdHoc(tester.id(), new CreateAdHocRunCommand(
                project.id(), "Run", null, null, List.of(testCase.id())));
        TestRunCase runCase = testRuns.listRunCases(tester.id(), run.id()).getFirst();
        TestAttempt attempt = execution.recordAttempt(tester.id(), new RecordAttemptCommand(
                runCase.id(), TestAttemptStatus.FAIL, 1L, null, "failure", UUID.randomUUID()));
        Defect defect = defects.create(tester.id(), new CreateDefectCommand(project.id(), attempt.id(),
                "Observed issue", null, DefectSeverity.HIGH, Priority.HIGH, developer.id()));
        DefectCommentService comments = new DefectCommentService(serviceTx, jdbcDaos, access);

        ByteArrayOutputStream screenshot = new ByteArrayOutputStream();
        assertTrue(ImageIO.write(new BufferedImage(2, 2, BufferedImage.TYPE_INT_RGB), "png", screenshot));
        String encoded = Base64.getEncoder().encodeToString(screenshot.toByteArray());
        String requestKey = UUID.randomUUID().toString();
        String logUrl = "https://example.com/builds/42/log";
        var posted = comments.add(developer.id(), project.id(), defect.id(), requestKey, "Stack trace attached", logUrl, encoded);
        assertFalse(posted.replayed());
        assertEquals(developer.id(), posted.comment().authorId());
        assertNotNull(posted.comment().createdAt());
        assertTrue(posted.comment().hasImage());
        assertEquals(logUrl, posted.comment().logUrl());

        var replay = comments.add(developer.id(), project.id(), defect.id(), requestKey, "Stack trace attached", logUrl, encoded);
        assertTrue(replay.replayed());
        assertEquals(posted.comment(), replay.comment());
        assertThrows(ConflictException.class, () -> comments.add(developer.id(), project.id(), defect.id(),
                requestKey, "Different comment", logUrl, encoded));
        assertThrows(ValidationException.class, () -> comments.add(developer.id(), project.id(), defect.id(),
                UUID.randomUUID().toString(), "Unsafe URL", "javascript:alert(1)", null));
        assertThrows(DefectCommentService.ScreenshotException.class, () -> comments.add(developer.id(), project.id(), defect.id(),
                UUID.randomUUID().toString(), "Invalid image", null, "YWJj"));

        var page = comments.list(tester.id(), project.id(), defect.id(), null);
        assertEquals(List.of(posted.comment()), page.comments());
        assertNull(page.nextBeforeId());
        assertEquals(defect.lockVersion(), defects.get(tester.id(), defect.id()).lockVersion());

        long commentId = posted.comment().id();
        var image = comments.image(tester.id(), project.id(), defect.id(), commentId);
        assertEquals("image/png", image.contentType());
        assertArrayEquals(screenshot.toByteArray(), image.bytes());
        assertThrows(ForbiddenException.class, () -> comments.image(outsider.id(), project.id(), defect.id(), commentId));
        assertThrows(NotFoundException.class, () -> comments.image(admin.id(), otherProject.id(), defect.id(), commentId));
        assertThrows(NotFoundException.class, () -> comments.image(tester.id(), project.id(), defect.id(), commentId + 1));
    }
}
