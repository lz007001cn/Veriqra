package io.github.lz007001cn.veriqra.service;

import io.github.lz007001cn.veriqra.model.*;
import java.util.List;

public interface ProjectSettingsService {
    record MemberView(Long userId, String username, String displayName, ProjectRole projectRole,
                      MembershipStatus status, UserStatus userStatus) { }
    List<ProjectManager> listManagers(Long actorId, Long projectId);
    ProjectManager appointManager(Long actorId, Long projectId, Long memberId);
    void revokeManager(Long actorId, Long projectId, Long memberId);
    List<MemberView> listProjectMembers(Long actorId, Long projectId);
    MemberView addProjectMember(Long actorId, Long projectId, String username, ProjectRole role);
}
