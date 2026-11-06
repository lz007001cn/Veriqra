package io.github.lz007001cn.veriqra.integration;

import io.github.lz007001cn.veriqra.exception.DataAccessException;
import io.github.lz007001cn.veriqra.model.*;
import io.github.lz007001cn.veriqra.service.DefaultTestRunService;
import io.github.lz007001cn.veriqra.service.command.*;
import io.github.lz007001cn.veriqra.service.exception.*;
import org.junit.jupiter.api.Test;
import java.util.List;
import java.util.concurrent.*;
import static org.junit.jupiter.api.Assertions.*;

class TestRunServiceIntegrationTest extends ServiceFixture {
    @Test void assignsOnlyAnActiveProjectTesterAndKeepsAssignmentInRunHistory() {
        User admin = actor("admin-run-owner", SystemRole.ADMIN, UserStatus.ACTIVE);
        User tester = actor("tester-run-owner", SystemRole.USER, UserStatus.ACTIVE);
        User outsider = actor("outside-run-owner", SystemRole.USER, UserStatus.ACTIVE);
        Project project = createProject(admin, "RUNOWNER", tester, ProjectRole.TESTER);
        TestCase testCase = readyCase(tester, project, "Owner regression", 1);
        assertThrows(ConflictException.class, () -> testRuns.createAdHoc(tester.id(), new CreateAdHocRunCommand(
                project.id(), "Foreign assignee", null, null, List.of(testCase.id()), outsider.id())));
        TestRun run = testRuns.createAdHoc(tester.id(), new CreateAdHocRunCommand(
                project.id(), "Assigned run", null, null, List.of(testCase.id()), tester.id()));
        assertEquals(tester.id(), testRuns.getDetails(tester.id(), project.id(), run.id()).run().assigneeId());
        assertThrows(ValidationException.class, () -> testRuns.assign(admin.id(), project.id(), run.id(), -1, null));
        TestRun unassigned = testRuns.assign(admin.id(), project.id(), run.id(), run.lockVersion(), null);
        assertNull(unassigned.assigneeId());
        assertThrows(ConflictException.class, () -> testRuns.assign(admin.id(), project.id(), run.id(), run.lockVersion(), tester.id()));
        TestRun reassigned = testRuns.assign(admin.id(), project.id(), run.id(), unassigned.lockVersion(), tester.id());
        TestRun cancelled = testRuns.cancel(tester.id(), project.id(), run.id(), reassigned.lockVersion());
        assertEquals(tester.id(), cancelled.assigneeId());
        assertThrows(ConflictException.class, () -> testRuns.assign(admin.id(), project.id(), run.id(), cancelled.lockVersion(), null));
    }

    @Test void planRunFreezesScopeCaseAndStepsAgainstLaterEdits() {
        User admin = actor("admin-run-plan", SystemRole.ADMIN, UserStatus.ACTIVE);
        User tester = actor("tester-run-plan", SystemRole.USER, UserStatus.ACTIVE);
        Project project = createProject(admin, "RUNPLAN", tester, ProjectRole.TESTER);
        TestCase testCase = readyCase(tester, project, "Original title", 1);
        TestPlan draft = testPlans.create(tester.id(),
                new CreateTestPlanCommand(project.id(), "Plan", null, List.of(testCase.id())));
        TestPlan ready = testPlans.update(tester.id(), new UpdateTestPlanCommand(
                draft.id(), draft.name(), draft.description(), TestPlanStatus.READY, draft.lockVersion()));
        TestRun run = testRuns.createFromPlan(tester.id(), new CreatePlanRunCommand(
                project.id(), ready.id(), "Plan run", "staging", "1.0"));
        TestRunCase snapshot = testRuns.listRunCases(tester.id(), run.id()).getFirst();
        assertEquals("Original title", snapshot.snapshotTitle());
        assertEquals("action 1", testRuns.listSnapshotSteps(tester.id(), snapshot.id()).getFirst().action());

        testPlans.removeCase(tester.id(), ready.id(), testCase.id(), ready.lockVersion());
        testCases.update(tester.id(), new UpdateTestCaseCommand(testCase.id(), "Changed title",
                testCase.description(), testCase.preconditions(), testCase.priority(), TestCaseStatus.READY,
                testCase.lockVersion(), List.of(new TestStepInput(1, "new action", "new expected"))));
        assertEquals(1, testRuns.listRunCases(tester.id(), run.id()).size());
        assertEquals("Original title", testRuns.listRunCases(tester.id(), run.id()).getFirst().snapshotTitle());
        assertEquals("action 1", testRuns.listSnapshotSteps(tester.id(), snapshot.id()).getFirst().action());
    }

    @Test void adHocRunUsesNullPlanAndRejectsCrossProjectOrArchivedProject() {
        User admin = actor("admin-run-adhoc", SystemRole.ADMIN, UserStatus.ACTIVE);
        User tester = actor("tester-run-adhoc", SystemRole.USER, UserStatus.ACTIVE);
        Project first = createProject(admin, "RUNADHOC", tester, ProjectRole.TESTER);
        Project second = createProject(admin, "RUNOTHER", tester, ProjectRole.TESTER);
        Project third = createProject(admin, "RUNARCH", tester, ProjectRole.TESTER);
        TestCase firstCase = readyCase(tester, first, "First", 1);
        TestCase otherCase = readyCase(tester, second, "Other", 1);
        TestRun run = testRuns.createAdHoc(tester.id(), new CreateAdHocRunCommand(
                first.id(), "Ad-hoc", null, null, List.of(firstCase.id())));
        assertNull(run.testPlanId());
        assertEquals(TestRunStatus.IN_PROGRESS, run.status());
        assertThrows(ValidationException.class, () -> testRuns.createAdHoc(tester.id(),
                new CreateAdHocRunCommand(first.id(), "Cross", null, null, List.of(otherCase.id()))));
        TestPlan otherPlan = testPlans.create(tester.id(),
                new CreateTestPlanCommand(second.id(), "Other plan", null, List.of(otherCase.id())));
        TestPlan readyOther = testPlans.update(tester.id(), new UpdateTestPlanCommand(otherPlan.id(),
                otherPlan.name(), null, TestPlanStatus.READY, otherPlan.lockVersion()));
        assertThrows(ValidationException.class, () -> testRuns.createFromPlan(tester.id(),
                new CreatePlanRunCommand(first.id(), readyOther.id(), "Wrong", null, null)));
        Project archived = projects.archive(admin.id(), third.id(), third.lockVersion());
        assertThrows(ConflictException.class, () -> testRuns.createAdHoc(admin.id(),
                new CreateAdHocRunCommand(archived.id(), "Archived", null, null, List.of(firstCase.id()))));
        TestRun cancelled = testRuns.cancel(tester.id(), run.id(), run.lockVersion());
        assertEquals(TestRunStatus.CANCELLED, cancelled.status());
    }

    @Test void snapshotFailureRollsBackRunCasesAndSteps() {
        User admin = actor("admin-run-fault", SystemRole.ADMIN, UserStatus.ACTIVE);
        User tester = actor("tester-run-fault", SystemRole.USER, UserStatus.ACTIVE);
        Project project = createProject(admin, "RUNFAULT", tester, ProjectRole.TESTER);
        TestCase first = readyCase(tester, project, "First", 1);
        TestCase second = readyCase(tester, project, "Second", 1);
        var failingFactory = (io.github.lz007001cn.veriqra.service.support.ServiceDaoFactory) connection -> {
            var d = jdbcDaos.create(connection);
            var failing = new ServiceDaoDelegates.RunCaseStepDelegate(d.runCaseSteps()) {
                int writes;
                @Override public TestRunCaseStep insert(TestRunCaseStep value) {
                    TestRunCaseStep saved = target.insert(value);
                    if (++writes == 2) throw new DataAccessException("Injected snapshot step failure");
                    return saved;
                }
            };
            return ServiceDaoDelegates.runCaseSteps(d, failing);
        };
        var service = new DefaultTestRunService(serviceTx, failingFactory, access, executionClock);
        assertThrows(DataAccessException.class, () -> service.createAdHoc(tester.id(),
                new CreateAdHocRunCommand(project.id(), "Rollback", null, null, List.of(first.id(), second.id()))));
        tx.inTransaction(c -> {
            assertTrue(new io.github.lz007001cn.veriqra.dao.jdbc.JdbcTestRunDao(c)
                    .listByProject(project.id()).isEmpty());
            assertTrue(new io.github.lz007001cn.veriqra.dao.jdbc.JdbcTestRunCaseDao(c)
                    .listByTestCase(first.id()).isEmpty());
            assertTrue(new io.github.lz007001cn.veriqra.dao.jdbc.JdbcTestRunCaseDao(c)
                    .listByTestCase(second.id()).isEmpty());
            return null;
        });
    }

    @Test void projectLockSerializesRunCreationAgainstArchive() throws Exception {
        User admin = actor("admin-run-race", SystemRole.ADMIN, UserStatus.ACTIVE);
        User tester = actor("tester-run-race", SystemRole.USER, UserStatus.ACTIVE);
        Project project = createProject(admin, "RUNRACE", tester, ProjectRole.TESTER);
        TestCase testCase = readyCase(tester, project, "Case", 1);
        CountDownLatch beforeInsert = new CountDownLatch(1);
        CountDownLatch releaseInsert = new CountDownLatch(1);
        var blockingFactory = (io.github.lz007001cn.veriqra.service.support.ServiceDaoFactory) connection -> {
            var d = jdbcDaos.create(connection);
            var blocking = new ServiceDaoDelegates.TestRunDelegate(d.testRuns()) {
                @Override public TestRun insert(TestRun value) {
                    beforeInsert.countDown();
                    try {
                        if (!releaseInsert.await(5, TimeUnit.SECONDS)) throw new IllegalStateException("Test latch timeout");
                    } catch (InterruptedException e) {
                        Thread.currentThread().interrupt();
                        throw new IllegalStateException(e);
                    }
                    return target.insert(value);
                }
            };
            return ServiceDaoDelegates.testRuns(d, blocking);
        };
        var blockingRuns = new DefaultTestRunService(serviceTx, blockingFactory, access, executionClock);
        ExecutorService executor = Executors.newFixedThreadPool(2);
        try {
            Future<TestRun> create = executor.submit(() -> blockingRuns.createAdHoc(tester.id(),
                    new CreateAdHocRunCommand(project.id(), "Concurrent", null, null, List.of(testCase.id()))));
            assertTrue(beforeInsert.await(5, TimeUnit.SECONDS));
            Future<Project> archive = executor.submit(() -> projects.archive(admin.id(), project.id(), project.lockVersion()));
            assertThrows(TimeoutException.class, () -> archive.get(300, TimeUnit.MILLISECONDS));
            releaseInsert.countDown();
            assertEquals(TestRunStatus.IN_PROGRESS, create.get(5, TimeUnit.SECONDS).status());
            ExecutionException failure = assertThrows(ExecutionException.class,
                    () -> archive.get(5, TimeUnit.SECONDS));
            assertInstanceOf(ConflictException.class, failure.getCause());
            assertEquals(ProjectStatus.ACTIVE, projects.get(admin.id(), project.id()).status());
        } finally {
            releaseInsert.countDown();
            executor.shutdownNow();
        }
    }

    @Test void planRunRejectsScopeCommittedAfterItsEarlierRepeatableRead() {
        User admin = actor("admin-run-current", SystemRole.ADMIN, UserStatus.ACTIVE);
        User tester = actor("tester-run-current", SystemRole.USER, UserStatus.ACTIVE);
        Project project = createProject(admin, "RUNCURRENT", tester, ProjectRole.TESTER);
        TestCase first = readyCase(tester, project, "First", 1);
        TestCase added = readyCase(tester, project, "Added concurrently", 1);
        TestPlan draft = testPlans.create(tester.id(),
                new CreateTestPlanCommand(project.id(), "Plan", null, List.of(first.id())));
        TestPlan ready = testPlans.update(tester.id(), new UpdateTestPlanCommand(
                draft.id(), draft.name(), draft.description(), TestPlanStatus.READY, draft.lockVersion()));
        var changed = new java.util.concurrent.atomic.AtomicBoolean();
        var changingFactory = (io.github.lz007001cn.veriqra.service.support.ServiceDaoFactory) connection -> {
            var d = jdbcDaos.create(connection);
            var changing = new ServiceDaoDelegates.PlanCaseDelegate(d.testPlanCases()) {
                @Override public List<TestPlanCase> listByTestPlan(Long planId) {
                    List<TestPlanCase> snapshot = target.listByTestPlan(planId);
                    if (changed.compareAndSet(false, true)) {
                        try (var other = pool.borrow()) {
                            new io.github.lz007001cn.veriqra.dao.jdbc.JdbcTestPlanCaseDao(other).add(
                                    new TestPlanCase(planId, added.id(), tester.id(), null));
                        } catch (java.sql.SQLException failure) {
                            throw new DataAccessException("Close concurrent plan scope connection", failure);
                        }
                    }
                    return snapshot;
                }
            };
            return ServiceDaoDelegates.planCases(d, changing);
        };
        var service = new DefaultTestRunService(serviceTx, changingFactory, access, executionClock);
        assertThrows(ConflictException.class, () -> service.createFromPlan(tester.id(),
                new CreatePlanRunCommand(project.id(), ready.id(), "Run", null, null)));
        assertTrue(Boolean.TRUE.equals(tx.inTransaction(c ->
                new io.github.lz007001cn.veriqra.dao.jdbc.JdbcTestRunDao(c)
                        .listByProject(project.id()).isEmpty())));
    }
}
