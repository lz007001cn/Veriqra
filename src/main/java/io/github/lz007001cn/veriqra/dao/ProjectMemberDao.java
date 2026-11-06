package io.github.lz007001cn.veriqra.dao;

import io.github.lz007001cn.veriqra.model.*;
import java.util.*;

/** Membership identity is projectId + userId; leaving changes status, never deletes the row. */
public interface ProjectMemberDao {
    ProjectMember add(ProjectMember value);
    Optional<ProjectMember> find(Long projectId, Long userId);
    /** Requires an outer transaction; stabilizes membership status/role during a business write. */
    Optional<ProjectMember> findForShare(Long projectId, Long userId);
    /** Current exclusive read for role or status changes that affect assignments. */
    Optional<ProjectMember> findForUpdate(Long projectId, Long userId);
    /** Row existence including INACTIVE; not an active-membership or authorization check. */
    boolean existsRecord(Long projectId, Long userId);
    List<ProjectMember> listByProject(Long projectId);
    List<ProjectMember> listByUser(Long userId, MembershipStatus status);
    /** Updates role/status with lockVersion; preserves original joinedAt and composite identity. */
    ProjectMember update(ProjectMember value);
}
