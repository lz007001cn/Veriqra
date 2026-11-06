package io.github.lz007001cn.veriqra.service;

import io.github.lz007001cn.veriqra.dao.*;
import io.github.lz007001cn.veriqra.model.*;
import io.github.lz007001cn.veriqra.service.exception.ForbiddenException;
import io.github.lz007001cn.veriqra.service.support.ProjectAccessPolicy;
import org.junit.jupiter.api.Test;
import java.util.*;
import static org.junit.jupiter.api.Assertions.*;

class ProjectAccessPolicyTest {
    private final ProjectAccessPolicy policy = new ProjectAccessPolicy();

    @Test void activeAdminBypassesMembershipButDisabledAdminDoesNot() {
        assertDoesNotThrow(() -> policy.requireAssetWrite(users(user(1L, SystemRole.ADMIN, UserStatus.ACTIVE)),
                members(null), 1L, 9L));
        assertThrows(ForbiddenException.class, () -> policy.requireAssetWrite(
                users(user(1L, SystemRole.ADMIN, UserStatus.DISABLED)), members(null), 1L, 9L));
    }

    @Test void onlyActiveTesterCanWriteAssetsWhileDeveloperCanRead() {
        UserDao users = users(user(2L, SystemRole.USER, UserStatus.ACTIVE));
        ProjectMember developer = member(2L, ProjectRole.DEVELOPER, MembershipStatus.ACTIVE);
        assertDoesNotThrow(() -> policy.requireProjectRead(users, members(developer), 2L, 9L));
        assertThrows(ForbiddenException.class, () -> policy.requireAssetWrite(users, members(developer), 2L, 9L));
        assertDoesNotThrow(() -> policy.requireAssetWrite(users,
                members(member(2L, ProjectRole.TESTER, MembershipStatus.ACTIVE)), 2L, 9L));
        assertThrows(ForbiddenException.class, () -> policy.requireProjectRead(users,
                members(member(2L, ProjectRole.TESTER, MembershipStatus.INACTIVE)), 2L, 9L));
    }

    private static User user(Long id, SystemRole role, UserStatus status) {
        return new User(id, "user" + id, "User", "hash", role, status, null, null, 0);
    }
    private static ProjectMember member(Long userId, ProjectRole role, MembershipStatus status) {
        return new ProjectMember(9L, userId, role, status, null, null, 0);
    }
    private static UserDao users(User value) {
        return new UserDao() {
            public Optional<User> findById(Long id) { return Objects.equals(id, value.id()) ? Optional.of(value) : Optional.empty(); }
            public Optional<User> findByIdForShare(Long id) { return findById(id); }
            public Optional<User> findByUsername(String username) { return Optional.empty(); }
            public User insert(User user) { throw new UnsupportedOperationException(); }
            public User update(User user) { throw new UnsupportedOperationException(); }
        };
    }
    private static ProjectMemberDao members(ProjectMember value) {
        return new ProjectMemberDao() {
            public ProjectMember add(ProjectMember v) { throw new UnsupportedOperationException(); }
            public Optional<ProjectMember> find(Long projectId, Long userId) {
                return value != null && Objects.equals(projectId, value.projectId()) && Objects.equals(userId, value.userId())
                        ? Optional.of(value) : Optional.empty();
            }
            public Optional<ProjectMember> findForShare(Long projectId, Long userId) { return find(projectId, userId); }
            public Optional<ProjectMember> findForUpdate(Long projectId, Long userId) { return find(projectId, userId); }
            public boolean existsRecord(Long projectId, Long userId) { return find(projectId, userId).isPresent(); }
            public List<ProjectMember> listByProject(Long projectId) { return List.of(); }
            public List<ProjectMember> listByUser(Long userId, MembershipStatus status) { return List.of(); }
            public ProjectMember update(ProjectMember v) { throw new UnsupportedOperationException(); }
        };
    }
}
