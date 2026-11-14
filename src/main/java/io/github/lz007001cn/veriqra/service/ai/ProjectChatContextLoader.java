package io.github.lz007001cn.veriqra.service.ai;

import io.github.lz007001cn.veriqra.model.Project;
import io.github.lz007001cn.veriqra.service.exception.NotFoundException;
import io.github.lz007001cn.veriqra.service.exception.ValidationException;
import io.github.lz007001cn.veriqra.service.support.ProjectAccessPolicy;
import io.github.lz007001cn.veriqra.service.support.ServiceDaoFactory;
import io.github.lz007001cn.veriqra.service.support.ServiceDaos;
import io.github.lz007001cn.veriqra.service.support.ServiceTransaction;
import java.util.Objects;

/** Applies the project's existing read policy before collecting any evidence. */
public final class ProjectChatContextLoader {
    private final ServiceTransaction transactions;
    private final ServiceDaoFactory factory;
    private final ProjectAccessPolicy access;

    public ProjectChatContextLoader(ServiceTransaction transactions, ServiceDaoFactory factory, ProjectAccessPolicy access) {
        this.transactions = Objects.requireNonNull(transactions);
        this.factory = Objects.requireNonNull(factory);
        this.access = Objects.requireNonNull(access);
    }

    public ProjectChatContext load(Long actor, Long projectId, String question) {
        validateProjectId(projectId);
        return transactions.execute(connection -> {
            Project project = authorize(factory.create(connection), actor, projectId);
            return new JdbcProjectChatEvidence(connection, projectId, question).snapshot(project);
        });
    }

    /** Membership or account status may have changed while the provider was answering. */
    public void requireAccess(Long actor, Long projectId) {
        validateProjectId(projectId);
        transactions.execute(connection -> authorize(factory.create(connection), actor, projectId));
    }

    private Project authorize(ServiceDaos daos, Long actor, long projectId) {
        access.requireProjectRead(daos.users(), daos.members(), actor, projectId);
        return daos.projects().findById(projectId).orElseThrow(() -> new NotFoundException("Project does not exist"));
    }

    private static void validateProjectId(Long projectId) {
        if (projectId == null || projectId <= 0) throw new ValidationException("Project ID is required");
    }
}
