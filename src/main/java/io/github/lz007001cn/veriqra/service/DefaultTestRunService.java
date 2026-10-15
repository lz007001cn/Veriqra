package io.github.lz007001cn.veriqra.service;

import io.github.lz007001cn.veriqra.exception.OptimisticLockException;
import io.github.lz007001cn.veriqra.model.*;
import io.github.lz007001cn.veriqra.service.command.*;
import io.github.lz007001cn.veriqra.service.exception.*;
import io.github.lz007001cn.veriqra.service.support.*;
import io.github.lz007001cn.veriqra.service.query.RunDetails;
import java.time.*;
import java.util.*;

public final class DefaultTestRunService implements TestRunService {
    private final ServiceTransaction transactions;
    private final ServiceDaoFactory daoFactory;
    private final ProjectAccessPolicy access;
    private final Clock clock;

    @Override public io.github.lz007001cn.veriqra.service.query.RunCompletionImpact completionImpact(Long actor, Long project, Long run) {
        return new DefaultDefectRetestWorkflow(transactions, daoFactory, access).impact(actor, project, run);
    }

    public DefaultTestRunService(ServiceTransaction transactions, ServiceDaoFactory daoFactory,
                                 ProjectAccessPolicy access, Clock clock) {
        this.transactions = Objects.requireNonNull(transactions);
        this.daoFactory = Objects.requireNonNull(daoFactory);
        this.access = Objects.requireNonNull(access);
        this.clock = Objects.requireNonNull(clock);
    }

    @Override public TestRun createFromPlan(Long actorUserId, CreatePlanRunCommand command) {
        ServiceValidation.required(command, "command");
        ServiceValidation.required(command.projectId(), "projectId");
        ServiceValidation.required(command.testPlanId(), "testPlanId");
        RunText text = validateRunText(command.name(), command.environment(), command.buildVersion());
        return transactions.execute(connection -> {
            ServiceDaos daos = daoFactory.create(connection);
            Project project = writableProject(daos, actorUserId, command.projectId());
            TestPlan preliminary = daos.testPlans().findById(command.testPlanId())
                    .orElseThrow(() -> new NotFoundException("Test plan does not exist"));
            ensureSameProject(preliminary.projectId(), project.id(), "Test plan");
            List<Long> expectedCaseIds = planCaseIds(daos, preliminary.id());
            if (expectedCaseIds.isEmpty()) throw new ConflictException("Executable test plan cannot be empty");
            List<TestCase> cases = lockReadyCases(daos, project.id(), expectedCaseIds);
            TestPlan plan = daos.testPlans().findByIdForUpdate(preliminary.id())
                    .orElseThrow(() -> new NotFoundException("Test plan does not exist"));
            ensureSameProject(plan.projectId(), project.id(), "Test plan");
            if (plan.status() != TestPlanStatus.READY) {
                throw new ConflictException("Only a READY test plan can create a run");
            }
            if (!expectedCaseIds.equals(lockedPlanCaseIds(daos, plan.id()))) {
                throw new ConflictException("Test plan scope changed during run creation");
            }
            return createRunAndSnapshots(daos, project.id(), plan.id(), actorUserId, text, cases);
        });
    }

    @Override public TestRun createAdHoc(Long actorUserId, CreateAdHocRunCommand command) {
        ServiceValidation.required(command, "command");
        ServiceValidation.required(command.projectId(), "projectId");
        RunText text = validateRunText(command.name(), command.environment(), command.buildVersion());
        List<Long> caseIds = distinctNonemptyIds(command.testCaseIds());
        return transactions.execute(connection -> {
            ServiceDaos daos = daoFactory.create(connection);
            Project project = writableProject(daos, actorUserId, command.projectId());
            List<TestCase> cases = lockReadyCases(daos, project.id(), caseIds);
            return createRunAndSnapshots(daos, project.id(), null, actorUserId, text, cases);
        });
    }

    @Override public List<TestRun> listByProject(Long actorUserId, Long projectId) {
        ServiceValidation.required(projectId, "projectId");
        return transactions.execute(connection -> {
            ServiceDaos daos = daoFactory.create(connection);
            daos.projects().findById(projectId).orElseThrow(() -> new NotFoundException("Project does not exist"));
            access.requireProjectRead(daos.users(), daos.members(), actorUserId, projectId);
            return daos.testRuns().listByProject(projectId);
        });
    }

    @Override public RunDetails getDetails(Long actorUserId, Long projectId, Long testRunId) {
        ServiceValidation.required(projectId, "projectId");
        ServiceValidation.required(testRunId, "testRunId");
        return transactions.execute(connection -> {
            ServiceDaos daos = daoFactory.create(connection);
            TestRun run = daos.testRuns().findById(testRunId)
                    .orElseThrow(() -> new NotFoundException("Test run does not exist"));
            ProjectOwnership.require(run.projectId(), projectId);
            access.requireProjectRead(daos.users(), daos.members(), actorUserId, projectId);
            return new RunDetails(run, daos.runCases().listByRun(run.id()).stream()
                    .map(item -> new RunDetails.CaseDetails(item, daos.runCaseSteps().listByRunCase(item.id()),
                            daos.attempts().findLatestByRunCase(item.id()))).toList());
        });
    }

    @Override public TestRun get(Long actorUserId, Long testRunId) {
        ServiceValidation.required(testRunId, "testRunId");
        return transactions.execute(connection -> {
            ServiceDaos daos = daoFactory.create(connection);
            TestRun run = daos.testRuns().findById(testRunId)
                    .orElseThrow(() -> new NotFoundException("Test run does not exist"));
            access.requireProjectRead(daos.users(), daos.members(), actorUserId, run.projectId());
            return run;
        });
    }

    @Override public List<TestRunCase> listRunCases(Long actorUserId, Long testRunId) {
        ServiceValidation.required(testRunId, "testRunId");
        return transactions.execute(connection -> {
            ServiceDaos daos = daoFactory.create(connection);
            TestRun run = daos.testRuns().findById(testRunId)
                    .orElseThrow(() -> new NotFoundException("Test run does not exist"));
            access.requireProjectRead(daos.users(), daos.members(), actorUserId, run.projectId());
            return daos.runCases().listByRun(run.id());
        });
    }

    @Override public List<TestRunCaseStep> listSnapshotSteps(Long actorUserId, Long testRunCaseId) {
        ServiceValidation.required(testRunCaseId, "testRunCaseId");
        return transactions.execute(connection -> {
            ServiceDaos daos = daoFactory.create(connection);
            TestRunCase runCase = daos.runCases().findById(testRunCaseId)
                    .orElseThrow(() -> new NotFoundException("Test run case does not exist"));
            TestRun run = daos.testRuns().findById(runCase.testRunId())
                    .orElseThrow(() -> new NotFoundException("Test run does not exist"));
            access.requireProjectRead(daos.users(), daos.members(), actorUserId, run.projectId());
            return daos.runCaseSteps().listByRunCase(runCase.id());
        });
    }

    @Override public TestRun complete(Long actorUserId, Long testRunId, Integer lockVersion) {
        return complete(actorUserId, null, testRunId, lockVersion);
    }

    @Override public TestRun cancel(Long actorUserId, Long testRunId, Integer lockVersion) {
        return cancel(actorUserId, null, testRunId, lockVersion);
    }

    @Override public TestRun complete(Long actorUserId, Long projectId, Long testRunId, Integer lockVersion) {
        return finish(actorUserId, projectId, testRunId, lockVersion, TestRunStatus.COMPLETED);
    }

    @Override public TestRun cancel(Long actorUserId, Long projectId, Long testRunId, Integer lockVersion) {
        return finish(actorUserId, projectId, testRunId, lockVersion, TestRunStatus.CANCELLED);
    }

    private TestRun finish(Long actorUserId, Long projectId, Long testRunId, Integer lockVersion, TestRunStatus terminalStatus) {
        ServiceValidation.required(testRunId, "testRunId");
        ServiceValidation.required(lockVersion, "lockVersion");
        return transactions.execute(connection -> {
            ServiceDaos daos = daoFactory.create(connection);
            TestRun preliminary = daos.testRuns().findById(testRunId)
                    .orElseThrow(() -> new NotFoundException("Test run does not exist"));
            ProjectOwnership.require(preliminary.projectId(), projectId);
            Project project = writableProject(daos, actorUserId, preliminary.projectId());
            TestRun run = daos.testRuns().findByIdForUpdate(testRunId)
                    .orElseThrow(() -> new NotFoundException("Test run does not exist"));
            ensureSameProject(run.projectId(), project.id(), "Test run");
            if (run.status() != TestRunStatus.IN_PROGRESS) {
                throw new ConflictException("Only an IN_PROGRESS test run can enter a terminal state");
            }
            if (terminalStatus == TestRunStatus.COMPLETED) requireEveryRunCaseHandled(daos, run.id());
            try {
                return daos.testRuns().update(new TestRun(run.id(), run.projectId(), run.testPlanId(), run.name(),
                        run.environment(), run.buildVersion(), terminalStatus, LocalDateTime.now(clock), run.createdBy(),
                        run.createdAt(), run.updatedAt(), lockVersion));
            } catch (OptimisticLockException failure) { throw ServiceFailures.stale("Test run", failure); }
        });
    }

    private static void requireEveryRunCaseHandled(ServiceDaos daos, Long runId) {
        List<TestRunCase> runCases = daos.runCases().listByRun(runId).stream()
                .sorted(Comparator.comparing(TestRunCase::id)).toList();
        if (runCases.isEmpty()) throw new ConflictException("Test run cannot complete without execution items");
        for (TestRunCase runCase : runCases) {
            daos.runCases().findByIdForUpdate(runCase.id())
                    .orElseThrow(() -> new ConflictException("Test run scope changed during completion"));
            if (daos.attempts().findLatestByRunCaseForUpdate(runCase.id()).isEmpty()) {
                throw new ConflictException("Every test run case requires at least one attempt before completion");
            }
        }
    }

    private static TestRun createRunAndSnapshots(ServiceDaos daos, Long projectId, Long planId,
                                                  Long actorUserId, RunText text, List<TestCase> cases) {
        TestRun run = daos.testRuns().insert(new TestRun(null, projectId, planId, text.name(), text.environment(),
                text.buildVersion(), TestRunStatus.IN_PROGRESS, null, actorUserId, null, null, null));
        for (TestCase testCase : cases) {
            List<TestStep> steps = daos.steps().listByTestCaseForShare(testCase.id());
            validateSnapshotSteps(testCase.id(), steps);
            TestRunCase runCase = daos.runCases().insert(new TestRunCase(null, run.id(), testCase.id(),
                    testCase.title(), testCase.description(), testCase.preconditions(), testCase.priority(), null));
            for (TestStep step : steps) {
                daos.runCaseSteps().insert(new TestRunCaseStep(runCase.id(), step.stepOrder(),
                        step.action(), step.expectedResult()));
            }
        }
        return run;
    }

    private static List<TestCase> lockReadyCases(ServiceDaos daos, Long projectId, List<Long> caseIds) {
        List<TestCase> result = new ArrayList<>(caseIds.size());
        for (Long caseId : caseIds.stream().sorted().toList()) {
            TestCase testCase = daos.testCases().findByIdForUpdate(caseId)
                    .orElseThrow(() -> new NotFoundException("Test case does not exist: " + caseId));
            ensureSameProject(testCase.projectId(), projectId, "Test case");
            if (testCase.status() != TestCaseStatus.READY) {
                throw new ConflictException("Only READY test cases can be included in a test run");
            }
            result.add(testCase);
        }
        return List.copyOf(result);
    }

    private Project writableProject(ServiceDaos daos, Long actorUserId, Long projectId) {
        Project project = daos.projects().findByIdForShare(projectId)
                .orElseThrow(() -> new NotFoundException("Project does not exist"));
        access.requireAssetWrite(daos.users(), daos.members(), actorUserId, project.id());
        if (project.status() != ProjectStatus.ACTIVE) throw new ConflictException("Archived project is read-only");
        return project;
    }

    private static RunText validateRunText(String name, String environment, String buildVersion) {
        return new RunText(ServiceValidation.requiredText(name, 160, "name"),
                ServiceValidation.optionalText(environment, 160, "environment"),
                ServiceValidation.optionalText(buildVersion, 80, "buildVersion"));
    }

    private static List<Long> distinctNonemptyIds(List<Long> values) {
        if (values == null || values.isEmpty()) throw new ValidationException("Ad-hoc run requires testCaseIds");
        Set<Long> unique = new LinkedHashSet<>();
        for (Long id : values) {
            if (id == null) throw new ValidationException("testCaseId is required");
            if (!unique.add(id)) throw new ValidationException("Duplicate testCaseId is not allowed");
        }
        return List.copyOf(unique);
    }

    private static List<Long> planCaseIds(ServiceDaos daos, Long planId) {
        return daos.testPlanCases().listByTestPlan(planId).stream().map(TestPlanCase::testCaseId).sorted().toList();
    }

    private static List<Long> lockedPlanCaseIds(ServiceDaos daos, Long planId) {
        return daos.testPlanCases().listByTestPlanForUpdate(planId).stream()
                .map(TestPlanCase::testCaseId).toList();
    }

    private static void validateSnapshotSteps(Long caseId, List<TestStep> steps) {
        if (steps.isEmpty()) throw new ConflictException("READY test case has no steps: " + caseId);
        for (int index = 0; index < steps.size(); index++) {
            if (!Objects.equals(steps.get(index).stepOrder(), index + 1)) {
                throw new ConflictException("Test case steps are not contiguous: " + caseId);
            }
        }
    }

    private static void ensureSameProject(Long actual, Long expected, String entity) {
        if (!Objects.equals(actual, expected)) throw new ValidationException(entity + " belongs to another project");
    }

    private record RunText(String name, String environment, String buildVersion) { }
}
