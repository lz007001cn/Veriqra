package io.github.lz007001cn.veriqra.integration;

import io.github.lz007001cn.veriqra.dao.jdbc.JdbcDefectDao;
import io.github.lz007001cn.veriqra.dao.jdbc.JdbcUserDao;
import io.github.lz007001cn.veriqra.model.*;
import io.github.lz007001cn.veriqra.service.command.CreateAdHocRunCommand;
import io.github.lz007001cn.veriqra.service.command.RecordAttemptCommand;
import io.github.lz007001cn.veriqra.service.exception.*;
import io.github.lz007001cn.veriqra.service.release.ReleaseAcceptance;
import io.github.lz007001cn.veriqra.service.release.ReleaseAcceptance.*;
import io.github.lz007001cn.veriqra.service.release.ReleaseAcceptanceService;
import io.github.lz007001cn.veriqra.service.release.ReleaseAcceptanceService.CreateRequest;
import io.github.lz007001cn.veriqra.service.release.ReleaseAcceptanceService.PreviewRequest;
import java.time.LocalDateTime;
import java.util.*;
import java.util.concurrent.*;
import java.util.stream.IntStream;
import org.junit.jupiter.api.Test;
import static org.junit.jupiter.api.Assertions.*;

class ReleaseAcceptanceServiceIntegrationTest extends ServiceFixture {
    private static final String BUILD = "release-2026.11.06";

    @Test void capturesAllSelectedRunCountsAndProjectUnclosedDefectsThenReplaysTheFrozenRecord() {
        User admin = actor("release-admin", SystemRole.ADMIN, UserStatus.ACTIVE);
        User tester = actor("release-tester", SystemRole.USER, UserStatus.ACTIVE);
        Project project = createProject(admin, "RELACCEPT", tester, ProjectRole.TESTER);
        Project other = createProject(admin, "RELOTHER", null, null);
        var run = run(tester, project, BUILD, "Desktop", "staging", 5);
        var otherSelected = run(tester, project, BUILD, "Mobile", "device lab", 1);
        run(tester, project, BUILD, "Omitted by reviewer", "other", 1);
        var cases = testRuns.listRunCases(tester.id(), run.id());
        attempt(tester, project, run, cases.get(0), TestAttemptStatus.FAIL);
        attempt(tester, project, run, cases.get(0), TestAttemptStatus.PASS);
        attempt(tester, project, run, cases.get(1), TestAttemptStatus.FAIL);
        attempt(tester, project, run, cases.get(2), TestAttemptStatus.BLOCKED);
        attempt(tester, project, run, cases.get(3), TestAttemptStatus.SKIPPED);
        Defect open = defect(project, tester, 1, DefectStatus.OPEN);
        Defect resolved = defect(project, tester, 2, DefectStatus.RESOLVED);
        defect(project, tester, 3, DefectStatus.CLOSED);
        defect(other, admin, 1, DefectStatus.OPEN);

        var service = service();
        var key = UUID.randomUUID().toString();
        var selectedIds = List.of(otherSelected.id(), run.id());
        var preview = service.preview(tester.id(), project.id(), new PreviewRequest(BUILD, selectedIds));
        assertTrue(service.list(tester.id(), project.id(), null).isEmpty());
        var submission = new CreateRequest(BUILD, selectedIds, Verdict.APPROVED, "人工评审记录", key, preview.reviewToken());
        var saved = service.create(tester.id(), project.id(), submission);
        assertEquals(BUILD, saved.buildVersion());
        assertEquals(Verdict.APPROVED, saved.verdict());
        assertEquals("人工评审记录", saved.notes());
        assertEquals(tester.id(), saved.reviewerId());
        assertEquals(tester.displayName(), saved.reviewerName());
        assertEquals(LocalDateTime.now(executionClock), saved.createdAt());
        assertEquals(2, saved.runCount());
        assertEquals(List.of(run.id(), otherSelected.id()), saved.runs().stream().map(RunEvidence::id).toList());
        var desktop = saved.runs().getFirst();
        assertEquals("staging", desktop.environment());
        assertEquals(TestRunStatus.IN_PROGRESS, desktop.status());
        assertEquals(Outcome.FAIL, desktop.outcome());
        assertEquals(new Counts(5, 4, 1, 1, 1, 1, 1), desktop.counts());
        assertEquals(Outcome.NOT_RUN, saved.runs().getLast().outcome());
        assertEquals(ReleaseAcceptance.ALL_PROJECT_UNCLOSED, saved.defectScope());
        assertEquals(2, saved.unclosedDefectCount());
        assertEquals(List.of(open.id(), resolved.id()), saved.unclosedDefects().stream().map(DefectEvidence::id).toList());
        assertEquals(List.of(DefectStatus.OPEN, DefectStatus.RESOLVED), saved.unclosedDefects().stream().map(DefectEvidence::status).toList());
        assertEquals(preview.runs(), saved.runs());
        assertEquals(preview.unclosedDefects(), saved.unclosedDefects());

        attempt(tester, project, run, cases.get(1), TestAttemptStatus.PASS);
        TestRun latest = testRuns.getDetails(tester.id(), project.id(), run.id()).run();
        testRuns.cancel(tester.id(), project.id(), run.id(), latest.lockVersion());
        tx.inTransaction(connection -> {
            new JdbcDefectDao(connection).update(new Defect(open.id(), open.projectId(), open.keyNo(), "Changed defect",
                    null, open.severity(), open.priority(), DefectStatus.CLOSED, open.reporterId(), null,
                    "Later verification", open.createdAt(), open.updatedAt(), open.lockVersion()));
            new JdbcUserDao(connection).update(new User(tester.id(), tester.username(), "New reviewer name", tester.passwordHash(),
                    tester.systemRole(), tester.status(), tester.createdAt(), tester.updatedAt(), tester.lockVersion()));
            return null;
        });
        defect(project, tester, 4, DefectStatus.OPEN);
        assertEquals(saved, service.get(tester.id(), project.id(), saved.id()));
        assertThrows(ReleaseAcceptanceService.EvidenceChanged.class, () -> service.create(tester.id(), project.id(),
                new CreateRequest(BUILD, selectedIds, Verdict.APPROVED, submission.notes(), UUID.randomUUID().toString(), preview.reviewToken())));
        assertEquals(saved, service.create(tester.id(), project.id(),
                new CreateRequest(BUILD, List.of(run.id(), otherSelected.id()), Verdict.APPROVED, submission.notes(), key, preview.reviewToken())));
        assertThrows(ConflictException.class, () -> service.create(tester.id(), project.id(),
                new CreateRequest(BUILD, submission.runIds(), Verdict.REJECTED, submission.notes(), key, preview.reviewToken())));
        var revised = service.preview(tester.id(), project.id(), new PreviewRequest(BUILD, selectedIds));
        assertNotEquals(preview.reviewToken(), revised.reviewToken());
        assertThrows(ConflictException.class, () -> service.create(tester.id(), project.id(),
                new CreateRequest(BUILD, selectedIds, Verdict.APPROVED, submission.notes(), key, revised.reviewToken())));
        var summary = service.list(tester.id(), project.id(), null).getFirst();
        assertEquals(saved.id(), summary.id());
        assertEquals(saved.reviewerName(), summary.reviewerName());
        assertEquals(2, summary.unclosedDefectCount());
        assertTrue(service.list(tester.id(), project.id(), summary.id()).isEmpty());
    }

    @Test void checksExactBuildScopeAndProjectPermissionsBeforeSavingOrReturningEvidence() {
        User admin = actor("release-scope-admin", SystemRole.ADMIN, UserStatus.ACTIVE);
        User tester = actor("release-scope-tester", SystemRole.USER, UserStatus.ACTIVE);
        User developer = actor("release-scope-dev", SystemRole.USER, UserStatus.ACTIVE);
        User disabled = actor("release-disabled", SystemRole.USER, UserStatus.DISABLED);
        User outside = actor("release-outsider", SystemRole.USER, UserStatus.ACTIVE);
        Project project = createProject(admin, "RELSCOPE", tester, ProjectRole.TESTER);
        Project other = createProject(admin, "RELFOREIGN", outside, ProjectRole.TESTER);
        addMember(project, developer, ProjectRole.DEVELOPER, MembershipStatus.ACTIVE);
        addMember(project, disabled, ProjectRole.TESTER, MembershipStatus.ACTIVE);
        var selected = run(tester, project, BUILD, "Candidate", null, 1);
        var withoutBuild = run(tester, project, null, "No build", null, 1);
        var foreign = run(outside, other, BUILD, "Foreign", null, 1);
        var service = service();
        var submission = request(BUILD, List.of(selected.id()));

        assertThrows(ForbiddenException.class, () -> service.create(developer.id(), project.id(), submission));
        assertThrows(ForbiddenException.class, () -> service.preview(developer.id(), project.id(), new PreviewRequest(BUILD, List.of(selected.id()))));
        assertThrows(ForbiddenException.class, () -> service.create(disabled.id(), project.id(), submission));
        assertThrows(ForbiddenException.class, () -> service.list(outside.id(), project.id(), null));
        assertThrows(ValidationException.class, () -> service.create(tester.id(), project.id(), request(" ", List.of(selected.id()))));
        assertThrows(ValidationException.class, () -> service.create(tester.id(), project.id(), request(BUILD.toUpperCase(Locale.ROOT), List.of(selected.id()))));
        assertThrows(ValidationException.class, () -> service.create(tester.id(), project.id(), request(BUILD, List.of(selected.id(), selected.id()))));
        assertThrows(ValidationException.class, () -> service.create(tester.id(), project.id(), request(BUILD, List.of(withoutBuild.id()))));
        assertThrows(ValidationException.class, () -> service.create(tester.id(), project.id(), request(BUILD, List.of(selected.id(), foreign.id()))));
        assertThrows(ValidationException.class, () -> service.create(tester.id(), project.id(),
                new CreateRequest(BUILD, List.of(selected.id()), Verdict.APPROVED, null, submission.requestKey(), null)));
        assertTrue(service.list(tester.id(), project.id(), null).isEmpty());

        var saved = service.create(admin.id(), project.id(), reviewed(service, admin, project, List.of(selected.id())));
        assertEquals(admin.id(), saved.reviewerId());
        assertEquals(saved, service.get(developer.id(), project.id(), saved.id()));
        assertEquals(saved.id(), service.list(developer.id(), project.id(), null).getFirst().id());
        assertThrows(ForbiddenException.class, () -> service.get(outside.id(), project.id(), saved.id()));
        assertThrows(NotFoundException.class, () -> service.get(admin.id(), other.id(), saved.id()));
        assertTrue(service.list(admin.id(), other.id(), null).isEmpty());
    }

    @Test void simultaneousSameKeySavesReturnOneImmutableRecord() throws Exception {
        User admin = actor("release-race-admin", SystemRole.ADMIN, UserStatus.ACTIVE);
        User tester = actor("release-race-tester", SystemRole.USER, UserStatus.ACTIVE);
        Project project = createProject(admin, "RELRACE", tester, ProjectRole.TESTER);
        var run = run(tester, project, BUILD, "Concurrent request", null, 1);
        var service = service();
        var submission = reviewed(service, tester, project, List.of(run.id()));
        var gate = new CountDownLatch(1);
        try (var workers = Executors.newFixedThreadPool(2)) {
            Callable<ReleaseAcceptance> save = () -> { gate.await(); return service.create(tester.id(), project.id(), submission); };
            var first = workers.submit(save);
            var second = workers.submit(save);
            gate.countDown();
            assertEquals(first.get(10, TimeUnit.SECONDS), second.get(10, TimeUnit.SECONDS));
        }
        assertEquals(1, service.list(tester.id(), project.id(), null).size());
    }

    private ReleaseAcceptanceService service() { return new ReleaseAcceptanceService(serviceTx, jdbcDaos, access, executionClock); }

    private static CreateRequest request(String build, List<Long> runIds) {
        return new CreateRequest(build, runIds, Verdict.REJECTED, null, UUID.randomUUID().toString(), "0".repeat(64));
    }

    private static CreateRequest reviewed(ReleaseAcceptanceService service, User actor, Project project, List<Long> runIds) {
        var preview = service.preview(actor.id(), project.id(), new PreviewRequest(BUILD, runIds));
        return new CreateRequest(BUILD, runIds, Verdict.REJECTED, null, UUID.randomUUID().toString(), preview.reviewToken());
    }

    private TestRun run(User tester, Project project, String build, String name, String environment, int size) {
        List<Long> ids = IntStream.rangeClosed(1, size)
                .mapToObj(i -> readyCase(tester, project, name + " case " + i, 1).id()).toList();
        return testRuns.createAdHoc(tester.id(), new CreateAdHocRunCommand(project.id(), name, environment, build, ids));
    }

    private void attempt(User tester, Project project, TestRun run, TestRunCase runCase, TestAttemptStatus outcome) {
        execution.recordAttempt(tester.id(), project.id(), run.id(), new RecordAttemptCommand(runCase.id(), outcome,
                null, null, outcome == TestAttemptStatus.FAIL ? "Saved failure" : null, UUID.randomUUID()));
    }

    private Defect defect(Project project, User reporter, long key, DefectStatus status) {
        return tx.inTransaction(connection -> new JdbcDefectDao(connection).insert(new Defect(null, project.id(), key,
                "Bug " + key, null, DefectSeverity.HIGH, Priority.MEDIUM, status, reporter.id(), null,
                status == DefectStatus.RESOLVED || status == DefectStatus.CLOSED ? "Fix recorded" : null, null, null, null)));
    }
}
