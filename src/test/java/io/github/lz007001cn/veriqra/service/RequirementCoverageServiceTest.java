package io.github.lz007001cn.veriqra.service;

import io.github.lz007001cn.veriqra.model.*;
import io.github.lz007001cn.veriqra.service.exception.*;
import io.github.lz007001cn.veriqra.service.support.*;
import org.junit.jupiter.api.Test;
import java.lang.reflect.Proxy;
import java.time.Clock;
import java.util.*;
import static org.junit.jupiter.api.Assertions.*;

/** Any locking or write DAO call fails; coverage is available to both existing project roles. */
class RequirementCoverageServiceTest {
    SystemRole role = SystemRole.USER;
    ProjectRole projectRole = ProjectRole.DEVELOPER;
    UserStatus userStatus = UserStatus.ACTIVE;
    MembershipStatus membership = MembershipStatus.ACTIVE;
    boolean projectExists = true, memberExists = true;
    int coverageReads;
    final List<RequirementCoverage> rows = List.of(new RequirementCoverage(10L, 2), new RequirementCoverage(11L, 0));
    final ServiceTransaction tx = new ServiceTransaction() {
        public <T> T execute(Work<T> work) { return work.execute(null); }
    };
    Object answer(String dao, String method, Object[] args) {
        return switch (dao + "." + method) {
            case "projects.findById" -> projectExists ? Optional.of(new Project(7L, "QA", "Project", null,
                    ProjectStatus.ACTIVE, 1L, null, null, 0)) : Optional.empty();
            case "users.findById" -> Optional.of(new User(1L, "member", "Member", "unused", role, userStatus, null, null, 0));
            case "members.find" -> memberExists ? Optional.of(new ProjectMember(7L, 1L, projectRole, membership, null, null, 0)) : Optional.empty();
            case "traceability.listCoverageByProject" -> { assertEquals(7L, args[0]); coverageReads++; yield rows; }
            default -> throw new AssertionError("Unexpected DAO call: " + dao + "." + method);
        };
    }
    ServiceDaos daos() {
        try {
            var parts = ServiceDaos.class.getRecordComponents();
            var types = Arrays.stream(parts).map(c -> c.getType()).toArray(Class<?>[]::new);
            Object[] values = new Object[parts.length];
            for (int i = 0; i < parts.length; i++) {
                String name = parts[i].getName();
                values[i] = Proxy.newProxyInstance(getClass().getClassLoader(), new Class<?>[]{types[i]},
                        (proxy, method, args) -> answer(name, method.getName(), args));
            }
            return ServiceDaos.class.getDeclaredConstructor(types).newInstance(values);
        } catch (ReflectiveOperationException failure) { throw new AssertionError(failure); }
    }
    TraceabilityService service() { return new DefaultTraceabilityService(tx, ignored -> daos(), new ProjectAccessPolicy(), Clock.systemUTC()); }

    @Test void bothActiveProjectRolesCanReadOneProjectWideResultIncludingZeroRows() {
        for (ProjectRole value : ProjectRole.values()) {
            projectRole = value;
            assertEquals(rows, service().listCoverageByProject(1L, 7L));
        }
        assertEquals(ProjectRole.values().length, coverageReads);
    }
    @Test void adminCanReadWithoutMembershipButMissingProjectsStillFail() {
        role = SystemRole.ADMIN; memberExists = false;
        assertEquals(rows, service().listCoverageByProject(1L, 7L));
        projectExists = false;
        assertThrows(NotFoundException.class, () -> service().listCoverageByProject(1L, 7L));
        assertEquals(1, coverageReads);
    }
    @Test void inactiveMissingOrDisabledMembersCannotReadCoverage() {
        membership = MembershipStatus.INACTIVE;
        assertThrows(ForbiddenException.class, () -> service().listCoverageByProject(1L, 7L));
        membership = MembershipStatus.ACTIVE; memberExists = false;
        assertThrows(ForbiddenException.class, () -> service().listCoverageByProject(1L, 7L));
        memberExists = true; userStatus = UserStatus.DISABLED;
        assertThrows(ForbiddenException.class, () -> service().listCoverageByProject(1L, 7L));
        assertEquals(0, coverageReads);
    }
}
