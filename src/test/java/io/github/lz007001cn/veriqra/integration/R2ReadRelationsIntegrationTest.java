package io.github.lz007001cn.veriqra.integration;

import io.github.lz007001cn.veriqra.model.*;
import io.github.lz007001cn.veriqra.service.command.*;
import io.github.lz007001cn.veriqra.service.exception.*;
import org.junit.jupiter.api.Test;
import java.util.*;
import static org.junit.jupiter.api.Assertions.*;

/** Run only against this task's new EMPTY fixture schema; all workflow setup uses Services. */
class R2ReadRelationsIntegrationTest extends ServiceFixture {
    @Test void reverseTraceReadsAllRealStatesAndDoesNotChangeTheirIdentityOrReviewState() {
        User admin = actor("r2-trace-admin",SystemRole.ADMIN,UserStatus.ACTIVE);
        User tester = actor("r2-trace-tester",SystemRole.USER,UserStatus.ACTIVE);
        User developer = actor("r2-trace-dev",SystemRole.USER,UserStatus.ACTIVE);
        User outsider = actor("r2-trace-outsider",SystemRole.USER,UserStatus.ACTIVE);
        Project project = createProject(admin,"R2TRACE",tester,ProjectRole.TESTER);
        addMember(project,developer,ProjectRole.DEVELOPER,MembershipStatus.ACTIVE);
        TestCase testCase = createCase(tester,project,"Read-only relationships",1);
        Requirement confirmed = createRequirement(tester,project,"Confirmed requirement");
        Requirement review = createRequirement(tester,project,"Needs review requirement");
        Requirement removed = createRequirement(tester,project,"Removed requirement");
        traceability.attach(tester.id(),project.id(),confirmed.id(),testCase.id());
        traceability.confirm(tester.id(),project.id(),confirmed.id(),testCase.id());
        traceability.attach(tester.id(),project.id(),review.id(),testCase.id());
        traceability.attach(tester.id(),project.id(),removed.id(),testCase.id());
        traceability.remove(tester.id(),project.id(),removed.id(),testCase.id());
        var before = tx.inTransaction(c -> new io.github.lz007001cn.veriqra.dao.jdbc.JdbcTestCaseRequirementDao(c).listByTestCase(testCase.id()));
        var result = traceability.listByTestCase(developer.id(),project.id(),testCase.id());
        assertEquals(3,result.size());
        assertEquals(Set.of(TraceabilityStatus.CONFIRMED,TraceabilityStatus.NEEDS_REVIEW,TraceabilityStatus.REMOVED),
                new HashSet<>(result.stream().map(v -> v.link().status()).toList()));
        assertEquals(before,result.stream().map(v -> v.link()).toList());
        assertEquals(before,tx.inTransaction(c -> new io.github.lz007001cn.veriqra.dao.jdbc.JdbcTestCaseRequirementDao(c).listByTestCase(testCase.id())));
        assertThrows(ForbiddenException.class,() -> traceability.listByTestCase(outsider.id(),project.id(),testCase.id()));
        Project other = createProject(admin,"R2TRACEOTHER",tester,ProjectRole.TESTER);
        assertThrows(NotFoundException.class,() -> traceability.listByTestCase(tester.id(),other.id(),testCase.id()));
        assertThrows(NotFoundException.class,() -> traceability.listByTestCase(admin.id(),other.id(),testCase.id()));
        assertEquals(3,traceability.listByTestCase(admin.id(),project.id(),testCase.id()).size());
    }

    @Test void originalFailStillFindsClosedDefectAfterRetestAndEveryPathParentIsAuthoritative() {
        User admin = actor("r2-attempt-admin",SystemRole.ADMIN,UserStatus.ACTIVE);
        User tester = actor("r2-attempt-tester",SystemRole.USER,UserStatus.ACTIVE);
        User developer = actor("r2-attempt-dev",SystemRole.USER,UserStatus.ACTIVE);
        User outsider = actor("r2-attempt-outsider",SystemRole.USER,UserStatus.ACTIVE);
        Project project = createProject(admin,"R2ATTEMPT",tester,ProjectRole.TESTER);
        addMember(project,developer,ProjectRole.DEVELOPER,MembershipStatus.ACTIVE);
        TestCase testCase = readyCase(tester,project,"Original immutable failure",1);
        TestRun run = testRuns.createAdHoc(tester.id(),new CreateAdHocRunCommand(project.id(),"R2 simulated run",null,null,List.of(testCase.id())));
        long runCase = testRuns.getDetails(tester.id(),project.id(),run.id()).cases().getFirst().snapshot().id();
        TestAttempt failure = execution.recordAttempt(tester.id(),project.id(),run.id(),new RecordAttemptCommand(runCase,TestAttemptStatus.FAIL,null,"SIMULATED",null,UUID.randomUUID()));
        Defect defect = defects.create(tester.id(),new CreateDefectCommand(project.id(),failure.id(),"R2 simulated defect",null,DefectSeverity.MEDIUM,Priority.MEDIUM,developer.id()));
        Defect started = defects.transition(developer.id(),project.id(),new TransitionDefectCommand(defect.id(),DefectStatus.IN_PROGRESS,null,defect.lockVersion()));
        Defect resolved = defects.transition(developer.id(),project.id(),new TransitionDefectCommand(defect.id(),DefectStatus.RESOLVED,"Ready for verification",started.lockVersion()));
        TestAttempt pass = execution.recordAttempt(tester.id(),project.id(),run.id(),new RecordAttemptCommand(runCase,TestAttemptStatus.PASS,null,"SIMULATED retest",null,UUID.randomUUID()));
        Defect closed = defects.transition(tester.id(),project.id(),new TransitionDefectCommand(defect.id(),DefectStatus.CLOSED,null,resolved.lockVersion()));
        assertEquals(DefectStatus.CLOSED,closed.status());
        var historyBefore = execution.listAttempts(tester.id(),project.id(),run.id(),runCase);
        assertEquals(List.of(closed),defects.listForAttempt(developer.id(),project.id(),run.id(),runCase,failure.id()));
        assertEquals(List.of(),defects.listForAttempt(tester.id(),project.id(),run.id(),runCase,pass.id()));
        assertEquals(historyBefore,execution.listAttempts(tester.id(),project.id(),run.id(),runCase));
        assertEquals(closed,defects.get(tester.id(),closed.id()));
        assertThrows(ForbiddenException.class,() -> defects.listForAttempt(outsider.id(),project.id(),run.id(),runCase,failure.id()));
        Project other = createProject(admin,"R2ATTEMPTOTHER",tester,ProjectRole.TESTER);
        assertThrows(NotFoundException.class,() -> defects.listForAttempt(tester.id(),other.id(),run.id(),runCase,failure.id()));
        TestRun second = testRuns.createAdHoc(tester.id(),new CreateAdHocRunCommand(project.id(),"Second isolated run",null,null,List.of(testCase.id())));
        long secondCase = testRuns.getDetails(tester.id(),project.id(),second.id()).cases().getFirst().snapshot().id();
        assertThrows(NotFoundException.class,() -> defects.listForAttempt(tester.id(),project.id(),second.id(),runCase,failure.id()));
        assertThrows(NotFoundException.class,() -> defects.listForAttempt(tester.id(),project.id(),second.id(),secondCase,failure.id()));
    }
}
