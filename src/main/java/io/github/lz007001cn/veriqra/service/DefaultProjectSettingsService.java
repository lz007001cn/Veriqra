package io.github.lz007001cn.veriqra.service;

import io.github.lz007001cn.veriqra.exception.DataAccessException;
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
        return new MemberView(user.id(), user.username(), user.displayName(), member.projectRole(), member.status(), user.status());
    }
}
