package io.github.lz007001cn.veriqra.integration;

import io.github.lz007001cn.veriqra.exception.DataAccessException;
import io.github.lz007001cn.veriqra.model.*;
import io.github.lz007001cn.veriqra.service.DefaultDefectService;
import io.github.lz007001cn.veriqra.service.command.*;
import io.github.lz007001cn.veriqra.service.exception.*;
import org.junit.jupiter.api.Test;
import java.util.*;
import java.util.concurrent.*;
import static org.junit.jupiter.api.Assertions.*;

class DefectServiceIntegrationTest extends ServiceFixture {
    @Test void developerReportsFailureAndQueriesPreserveSpecificEvidence() {
        Scenario s = scenario("DFCREATE", 1);
        TestAttempt failure = attempt(s, 0, TestAttemptStatus.FAIL);
        Defect defect = createDefect(s.developer(), s, failure, "Login fails");
        assertEquals(1L, defect.keyNo());
        assertEquals(DefectStatus.OPEN, defect.status());
        assertEquals(s.developer().id(), defect.reporterId());
        assertEquals(s.developer().id(), defect.assigneeId());
        assertEquals(defect, defects.get(s.tester().id(), defect.id()));
        assertEquals(List.of(defect), defects.listByProject(s.developer().id(), s.project().id()));
        TestAttemptDefect link = defects.listEvidence(s.tester().id(), defect.id()).getFirst();
        assertEquals(failure.id(), link.attemptId());
        assertEquals(List.of(link), defects.listDefectsForAttempt(s.developer().id(), failure.id()));
        assertEquals(link, defects.addEvidence(s.tester().id(), defect.id(), failure.id()));
        assertEquals(1, defects.listEvidence(s.tester().id(), defect.id()).size());
    }

    @Test void createRejectsNonFailCrossProjectUnauthorizedAndArchivedWrites() {
        Scenario s = scenario("DFINVALID", 1);
        for (TestAttemptStatus status : List.of(TestAttemptStatus.PASS, TestAttemptStatus.BLOCKED,
                TestAttemptStatus.SKIPPED)) {
            TestAttempt attempt = attempt(s, 0, status);
            assertThrows(ConflictException.class, () -> createDefect(s.tester(), s, attempt, status.name()));
        }
        Scenario other = scenario("DFOTHER", 1);
        TestAttempt otherFailure = attempt(other, 0, TestAttemptStatus.FAIL);
        assertThrows(ValidationException.class, () -> defects.create(s.tester().id(), new CreateDefectCommand(
                s.project().id(), otherFailure.id(), "Cross project", null, DefectSeverity.HIGH,
                Priority.HIGH, s.developer().id())));

        User inactive = actor("inactive-defect", SystemRole.USER, UserStatus.ACTIVE);
        addMember(s.project(), inactive, ProjectRole.DEVELOPER, MembershipStatus.INACTIVE);
        TestAttempt failure = attempt(s, 0, TestAttemptStatus.FAIL);
        assertThrows(ForbiddenException.class, () -> createDefect(inactive, s, failure, "Inactive"));
        User disabled = actor("disabled-defect", SystemRole.USER, UserStatus.DISABLED);
        addMember(s.project(), disabled, ProjectRole.DEVELOPER, MembershipStatus.ACTIVE);
        assertThrows(ForbiddenException.class, () -> createDefect(disabled, s, failure, "Disabled"));

        Scenario archivedScenario = scenario("DFARCH", 1);
        TestAttempt archivedFailure = attempt(archivedScenario, 0, TestAttemptStatus.FAIL);
        TestRun completed = testRuns.complete(archivedScenario.tester().id(), archivedScenario.run().id(),
                archivedScenario.run().lockVersion());
        assertEquals(TestRunStatus.COMPLETED, completed.status());
        Project archived = projects.archive(archivedScenario.admin().id(), archivedScenario.project().id(),
                archivedScenario.project().lockVersion());
        assertEquals(ProjectStatus.ARCHIVED, archived.status());
        assertThrows(ConflictException.class,
                () -> createDefect(archivedScenario.tester(), archivedScenario, archivedFailure, "Archived"));
        assertTrue(defects.listByProject(archivedScenario.tester().id(), archived.id()).isEmpty());
    }

    @Test void bugCounterDefectAndEvidenceRollbackTogether() {
        Scenario s = scenario("DFROLLBACK", 1);
        TestAttempt failure = attempt(s, 0, TestAttemptStatus.FAIL);
        var failingFactory = (io.github.lz007001cn.veriqra.service.support.ServiceDaoFactory) connection -> {
            var d = jdbcDaos.create(connection);
            var failing = new ServiceDaoDelegates.AttemptDefectDelegate(d.attemptDefects()) {
                @Override public TestAttemptDefect add(TestAttemptDefect value) {
                    target.add(value);
                    throw new DataAccessException("Injected evidence insert failure");
                }
            };
            return ServiceDaoDelegates.attemptDefects(d, failing);
        };
        var service = new DefaultDefectService(serviceTx, failingFactory, access);
        assertThrows(DataAccessException.class, () -> service.create(s.tester().id(), command(
                s, failure, "Rollback")));
        tx.inTransaction(c -> {
            assertTrue(new io.github.lz007001cn.veriqra.dao.jdbc.JdbcDefectDao(c)
                    .listByProject(s.project().id()).isEmpty());
            assertEquals(1L, new io.github.lz007001cn.veriqra.dao.jdbc.JdbcProjectCounterDao(c)
                    .find(s.project().id(), CounterEntityType.BUG).orElseThrow().nextValue());
            assertTrue(new io.github.lz007001cn.veriqra.dao.jdbc.JdbcTestAttemptDefectDao(c)
                    .listDefectsByAttempt(failure.id()).isEmpty());
            return null;
        });
    }

    @Test void reopenStatusAndEvidenceRollbackTogetherWhenLinkInsertFails() {
        Scenario s = scenario("DFREOPENRB", 1);
        TestAttempt failure = attempt(s, 0, TestAttemptStatus.FAIL);
        Defect defect = createDefect(s.tester(), s, failure, "Reopen rollback");
        Defect inProgress = defects.transition(s.tester().id(), new TransitionDefectCommand(
                defect.id(), DefectStatus.IN_PROGRESS, null, defect.lockVersion()));
        Defect resolved = defects.transition(s.tester().id(), new TransitionDefectCommand(
                defect.id(), DefectStatus.RESOLVED, "fixed", inProgress.lockVersion()));
        attempt(s, 0, TestAttemptStatus.PASS);
        Defect closed = defects.transition(s.tester().id(), new TransitionDefectCommand(
                defect.id(), DefectStatus.CLOSED, null, resolved.lockVersion()));
        TestAttempt regression = attempt(s, 0, TestAttemptStatus.FAIL);

        var failingFactory = (io.github.lz007001cn.veriqra.service.support.ServiceDaoFactory) connection -> {
            var d = jdbcDaos.create(connection);
            var failing = new ServiceDaoDelegates.AttemptDefectDelegate(d.attemptDefects()) {
                @Override public TestAttemptDefect add(TestAttemptDefect value) {
                    target.add(value);
                    throw new DataAccessException("Injected reopen evidence insert failure");
                }
            };
            return ServiceDaoDelegates.attemptDefects(d, failing);
        };
        var service = new DefaultDefectService(serviceTx, failingFactory, access);
        assertThrows(DataAccessException.class, () -> service.reopen(s.tester().id(), new ReopenDefectCommand(
                closed.id(), regression.id(), s.developer().id(), closed.lockVersion())));

        Defect persisted = defects.get(s.tester().id(), closed.id());
        assertEquals(DefectStatus.CLOSED, persisted.status());
        assertEquals(closed.lockVersion(), persisted.lockVersion());
        assertEquals(List.of(failure.id()), defects.listEvidence(s.tester().id(), closed.id()).stream()
                .map(TestAttemptDefect::attemptId).toList());
        assertTrue(defects.listDefectsForAttempt(s.tester().id(), regression.id()).isEmpty());
    }

    @Test void evidenceCanBeAddedCorrectedAndNeverDeletesEndpoints() {
        Scenario s = scenario("DFEVID", 1);
        TestAttempt first = attempt(s, 0, TestAttemptStatus.FAIL);
        Defect defect = createDefect(s.tester(), s, first, "Evidence");
        TestAttempt second = attempt(s, 0, TestAttemptStatus.FAIL);
        TestAttemptDefect secondLink = defects.addEvidence(s.tester().id(), defect.id(), second.id());
        Defect evidenceAdded = defects.get(s.tester().id(), defect.id());
        assertEquals(defect.lockVersion() + 1, evidenceAdded.lockVersion());
        assertEquals(secondLink, defects.addEvidence(s.tester().id(), defect.id(), second.id()));
        assertEquals(evidenceAdded, defects.get(s.tester().id(), defect.id()), "Duplicate ADD must not bump the version");
        assertEquals(List.of(first.id(), second.id()), defects.listEvidence(s.tester().id(), defect.id())
                .stream().map(TestAttemptDefect::attemptId).toList());

        Scenario other = scenario("DFEVIDOTHER", 1);
        TestAttempt otherFailure = attempt(other, 0, TestAttemptStatus.FAIL);
        assertThrows(ValidationException.class,
                () -> defects.addEvidence(s.tester().id(), defect.id(), otherFailure.id()));
        defects.removeEvidence(s.tester().id(), defect.id(), second.id());
        assertEquals(evidenceAdded.lockVersion() + 1, defects.get(s.tester().id(), defect.id()).lockVersion());
        assertEquals(List.of(first.id()), defects.listEvidence(s.tester().id(), defect.id())
                .stream().map(TestAttemptDefect::attemptId).toList());
        assertTrue(execution.listAttempts(s.tester().id(), s.runCases().getFirst().id()).stream()
                .anyMatch(value -> Objects.equals(value.id(), second.id())));
        assertEquals(defect.id(), defects.get(s.tester().id(), defect.id()).id());
        assertThrows(NotFoundException.class,
                () -> defects.removeEvidence(s.tester().id(), defect.id(), second.id()));
    }

    @Test void allFailureEvidenceNeedsLaterCurrentPassBeforeCloseAndReopenKeepsHistory() {
        Scenario s = scenario("DFRETEST", 3);
        TestAttempt firstFailure = attempt(s, 0, TestAttemptStatus.FAIL);
        TestAttempt secondFailure = attempt(s, 1, TestAttemptStatus.FAIL);
        Defect defect = createDefect(s.tester(), s, firstFailure, "Multi evidence");
        defects.addEvidence(s.tester().id(), defect.id(), secondFailure.id());
        Defect withEvidence = defects.get(s.tester().id(), defect.id());
        assertEquals(defect.lockVersion() + 1, withEvidence.lockVersion());
        assertThrows(ConflictException.class, () -> defects.transition(s.tester().id(),
                new TransitionDefectCommand(withEvidence.id(), DefectStatus.RESOLVED, "skip", withEvidence.lockVersion())));
        assertThrows(ConflictException.class, () -> defects.transition(s.tester().id(),
                new TransitionDefectCommand(withEvidence.id(), DefectStatus.OPEN, null, withEvidence.lockVersion())));
        assertThrows(ConflictException.class, () -> defects.transition(s.tester().id(),
                new TransitionDefectCommand(withEvidence.id(), DefectStatus.REOPENED, null, withEvidence.lockVersion())));
        assertThrows(ConflictException.class, () -> defects.transition(s.tester().id(),
                new TransitionDefectCommand(withEvidence.id(), DefectStatus.CLOSED, null, withEvidence.lockVersion())));
        Defect inProgress = defects.transition(s.tester().id(), new TransitionDefectCommand(
                withEvidence.id(), DefectStatus.IN_PROGRESS, null, withEvidence.lockVersion()));
        Defect resolved = defects.transition(s.tester().id(), new TransitionDefectCommand(
                defect.id(), DefectStatus.RESOLVED, "fixed", inProgress.lockVersion()));

        attempt(s, 0, TestAttemptStatus.PASS);
        attempt(s, 2, TestAttemptStatus.PASS); // Unrelated RunCase cannot verify the second evidence.
        assertThrows(ConflictException.class, () -> defects.transition(s.tester().id(),
                new TransitionDefectCommand(defect.id(), DefectStatus.CLOSED, null, resolved.lockVersion())));
        attempt(s, 1, TestAttemptStatus.FAIL);
        assertThrows(ConflictException.class, () -> defects.transition(s.tester().id(),
                new TransitionDefectCommand(defect.id(), DefectStatus.CLOSED, null, resolved.lockVersion())));
        attempt(s, 1, TestAttemptStatus.PASS);
        Defect closed = defects.transition(s.tester().id(), new TransitionDefectCommand(
                defect.id(), DefectStatus.CLOSED, null, resolved.lockVersion()));
        assertEquals(DefectStatus.CLOSED, closed.status());
        assertThrows(ConflictException.class, () -> defects.update(s.tester().id(), new UpdateDefectCommand(
                closed.id(), "Cannot edit", closed.description(), closed.severity(), closed.priority(),
                closed.assigneeId(), closed.lockVersion())));
        assertThrows(ConflictException.class,
                () -> defects.addEvidence(s.tester().id(), closed.id(), secondFailure.id()));
        assertThrows(ConflictException.class,
                () -> defects.removeEvidence(s.tester().id(), closed.id(), firstFailure.id()));

        TestAttempt regression = attempt(s, 0, TestAttemptStatus.FAIL);
        Defect reopened = defects.reopen(s.tester().id(), new ReopenDefectCommand(
                closed.id(), regression.id(), s.developer().id(), closed.lockVersion()));
        assertEquals(closed.keyNo(), reopened.keyNo());
        assertEquals(DefectStatus.REOPENED, reopened.status());
        assertNull(reopened.resolutionNote());
        assertEquals(3, defects.listEvidence(s.tester().id(), reopened.id()).size());
        Defect workingAgain = defects.transition(s.developer().id(), new TransitionDefectCommand(
                reopened.id(), DefectStatus.IN_PROGRESS, null, reopened.lockVersion()));
        assertEquals(DefectStatus.IN_PROGRESS, workingAgain.status());
    }

    @Test void developerOnlyProcessesAssignedDefectAndOptimisticVersionRejectsStaleUpdate() {
        Scenario s = scenario("DFPERM", 1);
        User otherDeveloper = actor("other-developer", SystemRole.USER, UserStatus.ACTIVE);
        addMember(s.project(), otherDeveloper, ProjectRole.DEVELOPER, MembershipStatus.ACTIVE);
        TestAttempt failure = attempt(s, 0, TestAttemptStatus.FAIL);
        Defect defect = createDefect(s.developer(), s, failure, "Permissions");
        assertThrows(ForbiddenException.class, () -> defects.update(s.developer().id(), new UpdateDefectCommand(
                defect.id(), defect.title(), defect.description(), defect.severity(), defect.priority(),
                defect.assigneeId(), defect.lockVersion())));
        assertThrows(ForbiddenException.class, () -> defects.transition(otherDeveloper.id(),
                new TransitionDefectCommand(defect.id(), DefectStatus.IN_PROGRESS, null, defect.lockVersion())));
        Defect inProgress = defects.transition(s.developer().id(), new TransitionDefectCommand(
                defect.id(), DefectStatus.IN_PROGRESS, null, defect.lockVersion()));
        Defect resolved = defects.transition(s.developer().id(), new TransitionDefectCommand(
                defect.id(), DefectStatus.RESOLVED, "developer fix", inProgress.lockVersion()));
        assertEquals(DefectStatus.RESOLVED, resolved.status());
        TestAttempt regression = attempt(s, 0, TestAttemptStatus.FAIL);
        assertThrows(ForbiddenException.class,
                () -> defects.addEvidence(s.developer().id(), defect.id(), regression.id()));
        assertThrows(ForbiddenException.class, () -> defects.reopen(s.developer().id(), new ReopenDefectCommand(
                defect.id(), regression.id(), s.developer().id(), resolved.lockVersion())));
        assertThrows(ForbiddenException.class, () -> defects.transition(s.developer().id(),
                new TransitionDefectCommand(defect.id(), DefectStatus.CLOSED, null, resolved.lockVersion())));

        Defect editable = createDefect(s.tester(), s, attempt(s, 0, TestAttemptStatus.FAIL), "Editable");
        Defect updated = defects.update(s.tester().id(), new UpdateDefectCommand(editable.id(), "Updated",
                editable.description(), DefectSeverity.CRITICAL, Priority.HIGH, editable.assigneeId(),
                editable.lockVersion()));
        assertEquals(1, updated.lockVersion());
        assertThrows(ConflictException.class, () -> defects.update(s.tester().id(), new UpdateDefectCommand(
                editable.id(), "Stale", editable.description(), editable.severity(), editable.priority(),
                editable.assigneeId(), editable.lockVersion())));
    }

    @Test void concurrentCreationAndUpdatesKeepUniqueNumbersAndOneOptimisticWinner() throws Exception {
        Scenario s = scenario("DFCONCUR", 2);
        TestAttempt first = attempt(s, 0, TestAttemptStatus.FAIL);
        TestAttempt second = attempt(s, 1, TestAttemptStatus.FAIL);
        ExecutorService executor = Executors.newFixedThreadPool(2);
        try {
            List<Future<Defect>> created = executor.invokeAll(List.of(
                    () -> defects.create(s.tester().id(), command(s, first, "First")),
                    () -> defects.create(s.tester().id(), command(s, second, "Second"))));
            List<Defect> values = new ArrayList<>();
            for (Future<Defect> future : created) values.add(future.get(10, TimeUnit.SECONDS));
            assertEquals(List.of(1L, 2L), values.stream().map(Defect::keyNo).sorted().toList());

            Defect base = values.getFirst();
            List<Future<Defect>> updates = executor.invokeAll(List.of(
                    () -> defects.update(s.tester().id(), update(base, "Concurrent A")),
                    () -> defects.update(s.tester().id(), update(base, "Concurrent B"))));
            int successes = 0;
            int conflicts = 0;
            for (Future<Defect> future : updates) {
                try { future.get(10, TimeUnit.SECONDS); successes++; }
                catch (ExecutionException failure) {
                    assertInstanceOf(ConflictException.class, failure.getCause());
                    conflicts++;
                }
            }
            assertEquals(1, successes);
            assertEquals(1, conflicts);
        } finally {
            executor.shutdownNow();
        }
    }

    private Scenario scenario(String key, int caseCount) {
        String suffix = key.toLowerCase(Locale.ROOT);
        User admin = actor("admin-" + suffix, SystemRole.ADMIN, UserStatus.ACTIVE);
        User tester = actor("tester-" + suffix, SystemRole.USER, UserStatus.ACTIVE);
        User developer = actor("developer-" + suffix, SystemRole.USER, UserStatus.ACTIVE);
        Project project = createProject(admin, key, tester, ProjectRole.TESTER);
        addMember(project, developer, ProjectRole.DEVELOPER, MembershipStatus.ACTIVE);
        List<Long> caseIds = new ArrayList<>();
        for (int i = 1; i <= caseCount; i++) {
            caseIds.add(readyCase(tester, project, "Case " + i, 1).id());
        }
        TestRun run = testRuns.createAdHoc(tester.id(), new CreateAdHocRunCommand(
                project.id(), "Run", null, null, caseIds));
        return new Scenario(admin, tester, developer, project, run,
                testRuns.listRunCases(tester.id(), run.id()));
    }

    private TestAttempt attempt(Scenario s, int runCaseIndex, TestAttemptStatus status) {
        return execution.recordAttempt(s.tester().id(), new RecordAttemptCommand(
                s.runCases().get(runCaseIndex).id(), status, 1L, null,
                status == TestAttemptStatus.FAIL ? "failure" : null, UUID.randomUUID()));
    }

    private Defect createDefect(User actor, Scenario s, TestAttempt failure, String title) {
        return defects.create(actor.id(), command(s, failure, title));
    }

    private CreateDefectCommand command(Scenario s, TestAttempt failure, String title) {
        return new CreateDefectCommand(s.project().id(), failure.id(), title, "details",
                DefectSeverity.HIGH, Priority.HIGH, s.developer().id());
    }

    private static UpdateDefectCommand update(Defect defect, String title) {
        return new UpdateDefectCommand(defect.id(), title, defect.description(), defect.severity(),
                defect.priority(), defect.assigneeId(), defect.lockVersion());
    }

    private record Scenario(User admin, User tester, User developer, Project project,
                            TestRun run, List<TestRunCase> runCases) { }
}
