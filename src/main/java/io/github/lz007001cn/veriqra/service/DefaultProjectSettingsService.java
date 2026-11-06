package io.github.lz007001cn.veriqra.service;

import io.github.lz007001cn.veriqra.exception.DataAccessException;
import io.github.lz007001cn.veriqra.exception.OptimisticLockException;
import io.github.lz007001cn.veriqra.model.*;
import io.github.lz007001cn.veriqra.service.exception.*;
import io.github.lz007001cn.veriqra.service.support.*;
import java.util.*;

/** Basic project membership and manager maintenance. */
public final class DefaultProjectSettingsService implements ProjectSettingsService {
    private final ServiceTransaction transactions;
    private final ServiceDaoFactory factory;
    private final ProjectAccessPolicy access;
    public DefaultProjectSettingsService(ServiceTransaction transactions, ServiceDaoFactory factory, ProjectAccessPolicy access) {
        this.transactions=Objects.requireNonNull(transactions);
        this.factory=Objects.requireNonNull(factory);
        this.access=Objects.requireNonNull(access);
    }
    private static long id(Long value, String field) {
        if (value == null || value <= 0) throw new ValidationException(field + " must be a positive ID");
        return value;
    }
    @Override public List<ProjectManager> listManagers(Long actorId, Long projectId) {
        long project = id(projectId, "projectId");
        return transactions.execute(c -> {
            var d = factory.create(c);
            readableProject(d, actorId, project);
            return d.projectSettings().listManagers(project);
        });
    }
    @Override public ProjectManager appointManager(Long actorId, Long projectId, Long memberId) {
        long project = id(projectId, "projectId"), member = id(memberId, "memberId");
        return transactions.execute(c -> {
            var d = factory.create(c);
            activeProjectForUpdate(d, project);
            access.requireAdminForWrite(d.users(), actorId);
            activeMember(d, project, member);
            if (activeManager(d, project, member)) throw new ConflictException("User is already a project manager");
            return d.projectSettings().appointManager(project, member, actorId);
        });
    }
    @Override public void revokeManager(Long actorId, Long projectId, Long memberId) {
        long project = id(projectId, "projectId"), member = id(memberId, "memberId");
        transactions.execute(c -> {
            var d = factory.create(c);
            activeProjectForUpdate(d, project);
            access.requireAdminForWrite(d.users(), actorId);
            var current = d.projectSettings().findManager(project, member)
                    .orElseThrow(() -> new NotFoundException("Project manager does not exist"));
            if (current.status() != MembershipStatus.ACTIVE) throw new ConflictException("Manager is already inactive");
            d.projectSettings().revokeManager(project, member);
            return null;
        });
    }
    @Override public List<MemberView> listProjectMembers(Long actorId, Long projectId) {
        long project = id(projectId, "projectId");
        return transactions.execute(c -> {
            var d = factory.create(c);
            readableProject(d, actorId, project);
            return d.members().listByProject(project).stream().map(m -> view(d, m)).toList();
        });
    }
    @Override public MemberView addProjectMember(Long actorId, Long projectId, String username, ProjectRole role) {
        long project = id(projectId, "projectId");
        String name = ServiceValidation.requiredText(username, 64, "username").trim();
        ServiceValidation.required(role, "projectRole");
        return transactions.execute(c -> {
            var d = factory.create(c);
            activeProject(d, project);
            User actor = access.requireActiveUser(d.users(), actorId);
            if (actor.systemRole() == SystemRole.ADMIN) access.requireAdminForWrite(d.users(), actorId);
            else requireManager(d, project, actorId);
            User target = d.users().findByUsername(name).orElseThrow(() -> new NotFoundException("User does not exist"));
            target = d.users().findByIdForShare(target.id()).orElseThrow(() -> new NotFoundException("User does not exist"));
            if (target.status() != UserStatus.ACTIVE) throw new ConflictException("User is disabled");
            ProjectMember current = d.members().find(project, target.id()).orElse(null);
            ProjectMember member;
            if (current == null) {
                try {
                    member = d.members().add(new ProjectMember(project, target.id(), role, MembershipStatus.ACTIVE,
                            null, null, null));
                } catch (DataAccessException failure) {
                    if (failure.getVendorCode() == 1062) throw new ConflictException("Project membership already exists", failure);
                    throw failure;
                }
            } else {
                if (current.status() == MembershipStatus.ACTIVE) throw new ConflictException("User is already a project member");
                member = d.members().update(new ProjectMember(project, target.id(), role, MembershipStatus.ACTIVE,
                        current.joinedAt(), current.updatedAt(), current.lockVersion()));
            }
            return view(d, member);
        });
    }

    @Override public MemberView updateProjectMember(Long actorId, Long projectId, Long memberId, MemberChange change) {
        long project = id(projectId, "projectId"), member = id(memberId, "memberId");
        if (actorId == null || actorId <= 0) throw new ForbiddenException("An authenticated actor is required");
        ServiceValidation.required(change, "membership change");
        ProjectRole role = ServiceValidation.required(change.projectRole(), "projectRole");
        MembershipStatus status = ServiceValidation.required(change.status(), "status");
        Long replacement = change.replacementAssigneeId();
        if (replacement != null) id(replacement, "replacementAssigneeId");
        if (change.expectedVersion() == null || change.expectedVersion() < 0) {
            throw new ValidationException("expectedVersion must be nonnegative");
        }

        return transactions.execute(c -> {
            var d = factory.create(c);
            // Assignment writers lock the project before membership and the affected work rows.
            // An exclusive project lock makes the set of assignments stable for the whole handoff.
            activeProjectForUpdate(d, project);
            var participants = new TreeSet<>(List.of(actorId, member));
            if (replacement != null) participants.add(replacement);
            var users = new HashMap<Long, User>();
            var members = new HashMap<Long, ProjectMember>();
            for (Long userId : participants) {
                d.users().findByIdForShare(userId).ifPresent(user -> users.put(userId, user));
            }
            for (Long userId : participants) {
                var row = userId == member ? d.members().findForUpdate(project, userId) : d.members().findForShare(project, userId);
                row.ifPresent(value -> members.put(userId, value));
            }

            User actor = users.get(actorId);
            if (actor == null || actor.status() != UserStatus.ACTIVE) throw new ForbiddenException("Active user is required");
            boolean admin = actor.systemRole() == SystemRole.ADMIN;
            if (!admin && !activeManager(d, project, actorId)) throw new ForbiddenException("Project manager access is required");
            ProjectMember current = members.get(member);
            if (current == null) throw new NotFoundException("Project member does not exist");
            User target = users.get(member);
            if (target == null) throw new NotFoundException("Member user does not exist");
            if (!Objects.equals(current.lockVersion(), change.expectedVersion())) throw staleMembership();
            if (current.status() != MembershipStatus.ACTIVE) {
                throw new MembershipConflictException("MEMBER_INACTIVE", "Only active project memberships can be edited");
            }

            boolean departing = status == MembershipStatus.INACTIVE;
            boolean roleChanged = current.projectRole() != role;
            if (departing && roleChanged) throw new ValidationException("Deactivation must preserve the existing project role");
            if (departing && activeManager(d, project, member)) {
                throw new MembershipConflictException("MEMBER_MANAGER_APPOINTMENT_ACTIVE", "Adjust this member's manager appointment before deactivation");
            }
            if (roleChanged && !admin && actorId == member) {
                throw new MembershipConflictException("MEMBER_SELF_ROLE_CHANGE", "A project manager cannot change their own project role");
            }
            if (!departing && target.status() != UserStatus.ACTIVE) {
                throw new MembershipConflictException("MEMBER_ACCOUNT_DISABLED", "A disabled account cannot change its project role");
            }
            boolean needsDefectHandoff = current.projectRole() == ProjectRole.DEVELOPER && (departing || roleChanged);
            if (!needsDefectHandoff && replacement != null) {
                throw new ValidationException("A replacement is only accepted when the member stops being a developer");
            }
            if (!departing && !roleChanged) return view(target, current);
            if (current.projectRole() == ProjectRole.TESTER && d.testRuns().hasActiveAssignment(project, member)) {
                throw new MembershipConflictException("RUN_ASSIGNMENTS_EXIST", "Reassign this member's unfinished test runs before changing their membership");
            }

            try {
                if (needsDefectHandoff) {
                    handoffDefects(d, project, member, replacement, users.get(replacement), members.get(replacement));
                }
                var updated = d.members().update(new ProjectMember(project, member, role, status,
                        current.joinedAt(), current.updatedAt(), change.expectedVersion()));
                return view(target, updated);
            } catch (OptimisticLockException stale) {
                throw staleMembership();
            }
        });
    }

    private static void handoffDefects(ServiceDaos d, long project, long member, Long replacement,
                                       User replacementUser, ProjectMember replacementMember) {
        var openDefects = d.defects().listByProject(project).stream()
                .filter(defect -> Objects.equals(defect.assigneeId(), member) && defect.status() != DefectStatus.CLOSED)
                .sorted(Comparator.comparing(Defect::id)).toList();
        if (replacement == null) {
            if (openDefects.isEmpty()) return;
            throw new MembershipConflictException("MEMBER_DEFECT_HANDOFF_REQUIRED", "Choose a developer to receive this member's unclosed defects");
        }
        if (replacement == member || replacementUser == null || replacementUser.status() != UserStatus.ACTIVE
                || replacementMember == null || replacementMember.status() != MembershipStatus.ACTIVE
                || replacementMember.projectRole() != ProjectRole.DEVELOPER) {
            throw new MembershipConflictException("MEMBER_REPLACEMENT_INELIGIBLE", "Choose another active developer from this project");
        }
        for (Defect defect : openDefects) {
            d.defects().update(new Defect(defect.id(), defect.projectId(), defect.keyNo(), defect.title(),
                    defect.description(), defect.severity(), defect.priority(), defect.status(), defect.reporterId(),
                    replacement, defect.resolutionNote(), defect.createdAt(), defect.updatedAt(), defect.lockVersion()));
        }
    }

    private static MembershipConflictException staleMembership() {
        return new MembershipConflictException("MEMBER_VERSION_CHANGED", "Project membership changed. Reload it before saving");
    }

    private Project readableProject(ServiceDaos d, Long actorId, long projectId) {
        Project project = d.projects().findById(projectId).orElseThrow(() -> new NotFoundException("Project does not exist"));
        access.requireProjectRead(d.users(), d.members(), actorId, projectId);
        return project;
    }
    private Project activeProject(ServiceDaos d, long projectId) {
        Project project = d.projects().findByIdForShare(projectId).orElseThrow(() -> new NotFoundException("Project does not exist"));
        if (project.status() != ProjectStatus.ACTIVE) throw new ConflictException("Archived project is read-only");
        return project;
    }
    private Project activeProjectForUpdate(ServiceDaos d, long projectId) {
        Project project = d.projects().findByIdForUpdate(projectId)
                .orElseThrow(() -> new NotFoundException("Project does not exist"));
        if (project.status() != ProjectStatus.ACTIVE) throw new ConflictException("Archived project is read-only");
        return project;
    }
    private User activeMember(ServiceDaos d, long projectId, long userId) {
        User user = d.users().findByIdForShare(userId)
                .orElseThrow(() -> new ForbiddenException("Active user is required"));
        if (user.status() != UserStatus.ACTIVE) throw new ForbiddenException("Active user is required");
        ProjectMember member = d.members().findForShare(projectId, userId)
                .orElseThrow(() -> new ForbiddenException("Active project membership is required"));
        if (member.status() != MembershipStatus.ACTIVE) throw new ForbiddenException("Active project membership is required");
        return user;
    }
    private void requireManager(ServiceDaos d, long projectId, Long actorId) {
        activeMember(d, projectId, id(actorId, "actorId"));
        if (!activeManager(d, projectId, actorId)) throw new ForbiddenException("Project manager access is required");
    }
    private static boolean activeManager(ServiceDaos d, long projectId, Long actorId) {
        return d.members().find(projectId, actorId).map(m -> m.status() == MembershipStatus.ACTIVE).orElse(false)
                && d.projectSettings().findManager(projectId, actorId)
                        .map(m -> m.status() == MembershipStatus.ACTIVE).orElse(false);
    }
    private static MemberView view(ServiceDaos d, ProjectMember member) {
        User user = d.users().findById(member.userId()).orElseThrow(() -> new NotFoundException("Member user does not exist"));
        return view(user, member);
    }
    private static MemberView view(User user, ProjectMember member) {
        return new MemberView(user.id(), user.username(), user.displayName(), member.projectRole(), member.status(),
                user.status(), member.lockVersion());
    }
}
