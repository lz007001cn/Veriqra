package io.github.lz007001cn.veriqra.integration;

import io.github.lz007001cn.veriqra.model.*;
import io.github.lz007001cn.veriqra.service.exception.*;
import org.junit.jupiter.api.Test;
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
}
