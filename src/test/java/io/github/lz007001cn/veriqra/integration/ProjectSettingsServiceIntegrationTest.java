package io.github.lz007001cn.veriqra.integration;

import io.github.lz007001cn.veriqra.exception.DataAccessException;
import io.github.lz007001cn.veriqra.model.*;
import io.github.lz007001cn.veriqra.service.DefaultProjectSettingsService;
import io.github.lz007001cn.veriqra.service.ProjectSettingsService.MemberChange;
import io.github.lz007001cn.veriqra.service.ProjectSettingsService.MemberView;
import io.github.lz007001cn.veriqra.service.command.*;
import io.github.lz007001cn.veriqra.service.exception.*;
import org.junit.jupiter.api.Test;
import java.util.List;
import java.util.UUID;
import static org.junit.jupiter.api.Assertions.*;

class ProjectSettingsServiceIntegrationTest extends ServiceFixture {
    @Test void managerCanAddExistingUsersOnlyWithinTheirOwnProject() {
        User admin=actor("settings-admin",SystemRole.ADMIN,UserStatus.ACTIVE);
        User manager=actor("settings-manager",SystemRole.USER,UserStatus.ACTIVE);
        User target=actor("settings-target",SystemRole.USER,UserStatus.ACTIVE);
        Project first=createProject(admin,"FIRST",manager,ProjectRole.TESTER);
        Project second=createProject(admin,"SECOND",null,null);
        projectSettings.appointManager(admin.id(),first.id(),manager.id());
        var added=projectSettings.addProjectMember(manager.id(),first.id(),target.username(),ProjectRole.DEVELOPER);
        assertEquals(target.id(),added.userId()); assertEquals(ProjectRole.DEVELOPER,added.projectRole());
        assertThrows(ForbiddenException.class,()->projectSettings.addProjectMember(manager.id(),second.id(),target.username(),ProjectRole.TESTER));
        assertThrows(ForbiddenException.class,()->projectSettings.appointManager(manager.id(),first.id(),target.id()));
        projectSettings.revokeManager(admin.id(),first.id(),manager.id());
        assertThrows(ForbiddenException.class,()->projectSettings.addProjectMember(manager.id(),first.id(),admin.username(),ProjectRole.TESTER));
    }
    @Test void appointmentsRequireActiveProjectMembershipAndExistingMembersAreNotDuplicated() {
        User admin=actor("settings-admin",SystemRole.ADMIN,UserStatus.ACTIVE);
        User tester=actor("settings-tester",SystemRole.USER,UserStatus.ACTIVE);
        User disabled=actor("settings-disabled",SystemRole.USER,UserStatus.DISABLED);
        Project project=createProject(admin,"SETTINGS",null,null);
        assertThrows(ForbiddenException.class,()->projectSettings.appointManager(admin.id(),project.id(),tester.id()));
        assertThrows(ConflictException.class,()->projectSettings.addProjectMember(admin.id(),project.id(),disabled.username(),ProjectRole.TESTER));
        projectSettings.addProjectMember(admin.id(),project.id(),tester.username(),ProjectRole.TESTER);
        projectSettings.appointManager(admin.id(),project.id(),tester.id());
        assertEquals(1,projectSettings.listProjectMembers(tester.id(),project.id()).size());
        assertThrows(ConflictException.class,()->projectSettings.addProjectMember(admin.id(),project.id(),tester.username(),ProjectRole.TESTER));
        assertThrows(ConflictException.class,()->projectSettings.appointManager(admin.id(),project.id(),tester.id()));
    }

    @Test void losingDeveloperRoleReassignsEveryUnclosedDefectAndPreservesClosedEvidence() {
        User admin = actor("handoff-admin", SystemRole.ADMIN, UserStatus.ACTIVE);
        User manager = actor("handoff-manager", SystemRole.USER, UserStatus.ACTIVE);
        User developer = actor("handoff-developer", SystemRole.USER, UserStatus.ACTIVE);
        User replacement = actor("handoff-replacement", SystemRole.USER, UserStatus.ACTIVE);
        User outsider = actor("handoff-outsider", SystemRole.USER, UserStatus.ACTIVE);
        Project project = createProject(admin, "HANDOFF", manager, ProjectRole.TESTER);
        projectSettings.appointManager(admin.id(), project.id(), manager.id());
        MemberView original = projectSettings.addProjectMember(manager.id(), project.id(), developer.username(), ProjectRole.DEVELOPER);
        projectSettings.addProjectMember(manager.id(), project.id(), replacement.username(), ProjectRole.DEVELOPER);
        TestRun run = run(manager, project);
        TestAttempt failure = attempt(manager, run, TestAttemptStatus.FAIL);
        Defect open = report(manager, project, developer, failure, "Still open");
        Defect resolved = resolve(manager, report(manager, project, developer, failure, "Awaiting verification"));
        Defect resolvedBeforeClosing = resolve(manager, report(manager, project, developer, failure, "Already verified"));
        attempt(manager, run, TestAttemptStatus.PASS);
        Defect closed = defects.transition(manager.id(), new TransitionDefectCommand(resolvedBeforeClosing.id(),
                DefectStatus.CLOSED, null, resolvedBeforeClosing.lockVersion()));

        assertConflict("MEMBER_DEFECT_HANDOFF_REQUIRED", () -> projectSettings.updateProjectMember(manager.id(), project.id(), developer.id(),
                new MemberChange(ProjectRole.TESTER, MembershipStatus.ACTIVE, null, original.version())));
        assertConflict("MEMBER_REPLACEMENT_INELIGIBLE", () -> projectSettings.updateProjectMember(manager.id(), project.id(), developer.id(),
                new MemberChange(ProjectRole.TESTER, MembershipStatus.ACTIVE, outsider.id(), original.version())));
        assertEquals(open, defects.get(manager.id(), open.id()));

        var changed = projectSettings.updateProjectMember(manager.id(), project.id(), developer.id(),
                new MemberChange(ProjectRole.TESTER, MembershipStatus.ACTIVE, replacement.id(), original.version()));
        assertEquals(ProjectRole.TESTER, changed.projectRole());
        assertEquals(original.version() + 1, changed.version());
        for (Defect before : List.of(open, resolved)) {
            Defect after = defects.get(manager.id(), before.id());
            assertEquals(replacement.id(), after.assigneeId());
            assertEquals(before.lockVersion() + 1, after.lockVersion());
            assertEquals(before.status(), after.status());
            assertEquals(before.resolutionNote(), after.resolutionNote());
            assertEquals(failure.id(), defects.listEvidence(manager.id(), before.id()).getFirst().attemptId());
        }
        assertEquals(closed, defects.get(manager.id(), closed.id()));
        assertConflict("MEMBER_VERSION_CHANGED", () -> projectSettings.updateProjectMember(manager.id(), project.id(), developer.id(),
                new MemberChange(ProjectRole.TESTER, MembershipStatus.INACTIVE, null, original.version())));
    }

    @Test void failedDefectHandoffRollsBackReassignmentAndMembershipChange() {
        User admin = actor("rollback-admin", SystemRole.ADMIN, UserStatus.ACTIVE);
        User developer = actor("rollback-developer", SystemRole.USER, UserStatus.ACTIVE);
        User replacement = actor("rollback-replacement", SystemRole.USER, UserStatus.ACTIVE);
        Project project = createProject(admin, "MEMROLLBACK", null, null);
        var original = projectSettings.addProjectMember(admin.id(), project.id(), developer.username(), ProjectRole.DEVELOPER);
        projectSettings.addProjectMember(admin.id(), project.id(), replacement.username(), ProjectRole.DEVELOPER);
        var failure = attempt(admin, run(admin, project), TestAttemptStatus.FAIL);
        Defect first = report(admin, project, developer, failure, "First assigned defect");
        Defect second = report(admin, project, developer, failure, "Second assigned defect");
        var failing = new DefaultProjectSettingsService(serviceTx, connection -> {
            var d = jdbcDaos.create(connection);
            return ServiceDaoDelegates.defects(d, new ServiceDaoDelegates.DefectDelegate(d.defects()) {
                @Override public Defect update(Defect value) {
                    Defect changed = target.update(value);
                    if (changed.id().equals(second.id())) throw new DataAccessException("Injected handoff failure");
                    return changed;
                }
            });
        }, access);
        var exit = new MemberChange(ProjectRole.DEVELOPER, MembershipStatus.INACTIVE, replacement.id(), original.version());
        assertThrows(DataAccessException.class, () -> failing.updateProjectMember(admin.id(), project.id(), developer.id(), exit));
        assertEquals(first, defects.get(admin.id(), first.id()));
        assertEquals(second, defects.get(admin.id(), second.id()));
        assertTrue(projectSettings.listProjectMembers(admin.id(), project.id()).contains(original));

        var inactive = projectSettings.updateProjectMember(admin.id(), project.id(), developer.id(), exit);
        assertEquals(MembershipStatus.INACTIVE, inactive.status());
        assertEquals(ProjectRole.DEVELOPER, inactive.projectRole());
        assertTrue(projectSettings.listProjectMembers(admin.id(), project.id()).contains(inactive));
        assertThrows(ForbiddenException.class, () -> projectSettings.listProjectMembers(developer.id(), project.id()));
    }

    @Test void membershipMaintenanceProtectsManagersAndUnfinishedRunOwners() {
        User admin = actor("guard-admin", SystemRole.ADMIN, UserStatus.ACTIVE);
        User manager = actor("guard-manager", SystemRole.USER, UserStatus.ACTIVE);
        User tester = actor("guard-tester", SystemRole.USER, UserStatus.ACTIVE);
        User disabled = actor("guard-disabled", SystemRole.USER, UserStatus.DISABLED);
        Project project = createProject(admin, "MEMGUARD", manager, ProjectRole.TESTER);
        projectSettings.appointManager(admin.id(), project.id(), manager.id());
        var testerRow = projectSettings.addProjectMember(admin.id(), project.id(), tester.username(), ProjectRole.TESTER);
        var managerRow = projectSettings.listProjectMembers(admin.id(), project.id()).stream()
                .filter(row -> row.userId().equals(manager.id())).findFirst().orElseThrow();
        addMember(project, disabled, ProjectRole.DEVELOPER, MembershipStatus.ACTIVE);
        var disabledRow = projectSettings.listProjectMembers(admin.id(), project.id()).stream()
                .filter(row -> row.userId().equals(disabled.id())).findFirst().orElseThrow();
        var managerRoleChange = new MemberChange(ProjectRole.DEVELOPER, MembershipStatus.ACTIVE, null, managerRow.version());
        assertThrows(ForbiddenException.class, () -> projectSettings.updateProjectMember(tester.id(), project.id(), manager.id(), managerRoleChange));
        assertConflict("MEMBER_SELF_ROLE_CHANGE", () -> projectSettings.updateProjectMember(manager.id(), project.id(), manager.id(), managerRoleChange));
        assertConflict("MEMBER_MANAGER_APPOINTMENT_ACTIVE", () -> projectSettings.updateProjectMember(admin.id(), project.id(), manager.id(),
                new MemberChange(ProjectRole.TESTER, MembershipStatus.INACTIVE, null, managerRow.version())));
        assertConflict("MEMBER_ACCOUNT_DISABLED", () -> projectSettings.updateProjectMember(manager.id(), project.id(), disabled.id(),
                new MemberChange(ProjectRole.TESTER, MembershipStatus.ACTIVE, null, disabledRow.version())));
        assertEquals(MembershipStatus.INACTIVE, projectSettings.updateProjectMember(manager.id(), project.id(), disabled.id(),
                new MemberChange(ProjectRole.DEVELOPER, MembershipStatus.INACTIVE, null, disabledRow.version())).status());

        TestRun run = run(manager, project);
        TestRun assigned = testRuns.assign(admin.id(), project.id(), run.id(), run.lockVersion(), tester.id());
        var leave = new MemberChange(ProjectRole.TESTER, MembershipStatus.INACTIVE, null, testerRow.version());
        assertConflict("RUN_ASSIGNMENTS_EXIST", () -> projectSettings.updateProjectMember(manager.id(), project.id(), tester.id(), leave));
        testRuns.assign(admin.id(), project.id(), assigned.id(), assigned.lockVersion(), manager.id());
        assertEquals(MembershipStatus.INACTIVE, projectSettings.updateProjectMember(manager.id(), project.id(), tester.id(), leave).status());
    }

    private TestRun run(User owner, Project project) {
        TestCase testCase = readyCase(owner, project, "Membership handoff fixture", 1);
        return testRuns.createAdHoc(owner.id(), new CreateAdHocRunCommand(project.id(), "Membership fixture run", null, null, List.of(testCase.id())));
    }

    private TestAttempt attempt(User actor, TestRun run, TestAttemptStatus outcome) {
        Long runCaseId = testRuns.listRunCases(actor.id(), run.id()).getFirst().id();
        return execution.recordAttempt(actor.id(), new RecordAttemptCommand(runCaseId, outcome, null, null,
                outcome == TestAttemptStatus.FAIL ? "Fixture failure" : null, UUID.randomUUID()));
    }

    private Defect report(User reporter, Project project, User assignee, TestAttempt failure, String title) {
        return defects.create(reporter.id(), new CreateDefectCommand(project.id(), failure.id(), title, null,
                DefectSeverity.HIGH, Priority.HIGH, assignee.id()));
    }

    private Defect resolve(User actor, Defect open) {
        Defect started = defects.transition(actor.id(), new TransitionDefectCommand(open.id(), DefectStatus.IN_PROGRESS, null, open.lockVersion()));
        return defects.transition(actor.id(), new TransitionDefectCommand(started.id(), DefectStatus.RESOLVED, "Fixed in fixture", started.lockVersion()));
    }

    private static void assertConflict(String code, org.junit.jupiter.api.function.Executable operation) {
        assertEquals(code, assertThrows(MembershipConflictException.class, operation).code());
    }
}
