package io.github.lz007001cn.veriqra.integration;

import io.github.lz007001cn.veriqra.dao.jdbc.*;
import io.github.lz007001cn.veriqra.model.*;
import io.github.lz007001cn.veriqra.service.*;
import io.github.lz007001cn.veriqra.service.command.*;
import io.github.lz007001cn.veriqra.service.support.*;
import org.junit.jupiter.api.BeforeEach;
import java.time.*;

abstract class ServiceFixture extends MysqlFixture {
    protected JdbcServiceDaoFactory jdbcDaos;
    protected JdbcServiceTransaction serviceTx;
    protected ProjectAccessPolicy access;
    protected ProjectService projects;
    protected RequirementService requirements;
    protected TestCaseService testCases;
    protected TraceabilityService traceability;
    protected TestPlanService testPlans;
    protected TestRunService testRuns;
    protected TestExecutionService execution;
    protected DefectService defects;
    protected AutomationService automation;
    protected TestImportService imports;
    protected ProjectSettingsService projectSettings;
    protected final Clock clock = Clock.fixed(Instant.parse("2026-09-16T00:00:00Z"), ZoneOffset.UTC);
    protected final Clock executionClock = Clock.fixed(Instant.parse("2030-01-01T00:00:00Z"), ZoneOffset.UTC);

    @BeforeEach void configureServices() {
        jdbcDaos = new JdbcServiceDaoFactory();
        serviceTx = new JdbcServiceTransaction(tx);
        access = new ProjectAccessPolicy();
        projects = new DefaultProjectService(serviceTx, jdbcDaos, access);
        requirements = new DefaultRequirementService(serviceTx, jdbcDaos, access);
        testCases = new DefaultTestCaseService(serviceTx, jdbcDaos, access);
        traceability = new DefaultTraceabilityService(serviceTx, jdbcDaos, access, clock);
        testPlans = new DefaultTestPlanService(serviceTx, jdbcDaos, access);
        testRuns = new DefaultTestRunService(serviceTx, jdbcDaos, access, executionClock);
        execution = new DefaultTestExecutionService(serviceTx, jdbcDaos, access, executionClock);
        defects = new DefaultDefectService(serviceTx, jdbcDaos, access);
        automation = new DefaultAutomationService(serviceTx, jdbcDaos, access);
        imports = new DefaultTestImportService(serviceTx, jdbcDaos, access,
                new io.github.lz007001cn.veriqra.service.importing.JUnitXmlParser(), executionClock);
        projectSettings = new DefaultProjectSettingsService(serviceTx, jdbcDaos, access);
    }

    protected User actor(String username, SystemRole role, UserStatus status) {
        return tx.inTransaction(c -> new JdbcUserDao(c).insert(new User(null, username, username,
                "fixture-hash-not-for-login", role, status, null, null, null)));
    }

    protected Project createProject(User admin, String key, User initialMember, ProjectRole role) {
        return projects.create(admin.id(), new CreateProjectCommand(key, key + " project", null,
                initialMember == null ? null : initialMember.id(), initialMember == null ? null : role));
    }

    protected Requirement createRequirement(User actor, Project project, String title) {
        return requirements.create(actor.id(), new CreateRequirementCommand(project.id(), title, "description", Priority.MEDIUM));
    }

    protected TestCase createCase(User actor, Project project, String title, int stepCount) {
        var steps = java.util.stream.IntStream.rangeClosed(1, stepCount)
                .mapToObj(i -> new TestStepInput(i, "action " + i, "expected " + i)).toList();
        return testCases.create(actor.id(), new CreateTestCaseCommand(project.id(), title, "description",
                "preconditions", Priority.MEDIUM, steps));
    }

    protected TestCase readyCase(User actor, Project project, String title, int stepCount) {
        TestCase draft = createCase(actor, project, title, stepCount);
        var steps = java.util.stream.IntStream.rangeClosed(1, stepCount)
                .mapToObj(i -> new TestStepInput(i, "action " + i, "expected " + i)).toList();
        return testCases.update(actor.id(), new UpdateTestCaseCommand(draft.id(), draft.title(), draft.description(),
                draft.preconditions(), draft.priority(), TestCaseStatus.READY, draft.lockVersion(), steps));
    }

    protected void addMember(Project project, User user, ProjectRole role, MembershipStatus status) {
        tx.inTransaction(c -> {
            new JdbcProjectMemberDao(c).add(new ProjectMember(project.id(), user.id(), role, status, null, null, null));
            return null;
        });
    }
}
