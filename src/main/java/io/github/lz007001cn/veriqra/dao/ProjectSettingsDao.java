package io.github.lz007001cn.veriqra.dao;

import io.github.lz007001cn.veriqra.model.ProjectManager;
import java.util.List;
import java.util.Optional;

public interface ProjectSettingsDao {
    Optional<ProjectManager> findManager(long projectId, long userId);
    List<ProjectManager> listManagers(long projectId);
    ProjectManager appointManager(long projectId, long userId, long actorId);
    void revokeManager(long projectId, long userId);
}
