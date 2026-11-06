package io.github.lz007001cn.veriqra.dao.jdbc;

import io.github.lz007001cn.veriqra.dao.ProjectMemberDao;
import io.github.lz007001cn.veriqra.exception.*;
import io.github.lz007001cn.veriqra.model.*;
import java.sql.*;
import java.time.LocalDateTime;
import java.util.*;

/** Non-owning DAO. Platform permission and member-exit coordination belong to the caller. */
public final class JdbcProjectMemberDao implements ProjectMemberDao {
    private static final String SELECT = "SELECT project_id, user_id, project_role, status, joined_at, updated_at, lock_version FROM project_members";
    private final Connection connection;
    public JdbcProjectMemberDao(Connection connection) { this.connection = Objects.requireNonNull(connection); }

    @Override public ProjectMember add(ProjectMember value) {
        try (PreparedStatement s = connection.prepareStatement(
                "INSERT INTO project_members (project_id, user_id, project_role, status) VALUES (?,?,?,?)")) {
            s.setObject(1, value.projectId(), Types.BIGINT);
            s.setObject(2, value.userId(), Types.BIGINT);
            s.setString(3, value.projectRole() == null ? null : value.projectRole().name());
            s.setString(4, value.status() == null ? null : value.status().name());
            if (s.executeUpdate() != 1) throw new SQLException("Unexpected membership insert count");
            return find(value.projectId(), value.userId()).orElseThrow(() -> new DataAccessException("Added member could not be read"));
        } catch (SQLException e) { throw new DataAccessException("Add ProjectMember", e); }
    }

    @Override public Optional<ProjectMember> find(Long projectId, Long userId) {
        return query(SELECT + " WHERE project_id=? AND user_id=?", projectId, userId).stream().findFirst();
    }
    @Override public Optional<ProjectMember> findForShare(Long projectId, Long userId) {
        requireTransaction();
        return query(SELECT + " WHERE project_id=? AND user_id=? FOR SHARE", projectId, userId).stream().findFirst();
    }
    @Override public Optional<ProjectMember> findForUpdate(Long projectId, Long userId) {
        requireTransaction();
        return query(SELECT + " WHERE project_id=? AND user_id=? FOR UPDATE", projectId, userId).stream().findFirst();
    }
    @Override public boolean existsRecord(Long projectId, Long userId) { return find(projectId, userId).isPresent(); }
    @Override public List<ProjectMember> listByProject(Long projectId) {
        return query(SELECT + " WHERE project_id=? ORDER BY user_id", projectId);
    }
    @Override public List<ProjectMember> listByUser(Long userId, MembershipStatus status) {
        return query(SELECT + " WHERE user_id=? AND status=? ORDER BY project_id", userId, Objects.requireNonNull(status));
    }

    private List<ProjectMember> query(String sql, Object... values) {
        try (PreparedStatement s = connection.prepareStatement(sql)) {
            for (int i = 0; i < values.length; i++) {
                if (values[i] instanceof MembershipStatus status) s.setString(i + 1, status.name());
                else s.setObject(i + 1, values[i], Types.BIGINT);
            }
            try (ResultSet rs = s.executeQuery()) {
                List<ProjectMember> rows = new ArrayList<>();
                while (rs.next()) rows.add(map(rs));
                return List.copyOf(rows);
            }
        } catch (SQLException e) { throw new DataAccessException("Find ProjectMember", e); }
    }

    private void requireTransaction() {
        try {
            if (connection.getAutoCommit()) throw new SQLException("Membership locking requires an outer transaction", "25000");
        } catch (SQLException e) { throw new DataAccessException("Lock ProjectMember", e); }
    }

    @Override public ProjectMember update(ProjectMember value) {
        JdbcValues.writableVersion(value.lockVersion());
        try (PreparedStatement s = connection.prepareStatement(
                "UPDATE project_members SET project_role=?, status=?, updated_at=CURRENT_TIMESTAMP(6), "
                        + "lock_version=lock_version+1 WHERE project_id=? AND user_id=? AND lock_version=?")) {
            s.setString(1, value.projectRole() == null ? null : value.projectRole().name());
            s.setString(2, value.status() == null ? null : value.status().name());
            s.setObject(3, value.projectId(), Types.BIGINT);
            s.setObject(4, value.userId(), Types.BIGINT);
            s.setInt(5, value.lockVersion());
            if (s.executeUpdate() != 1) throw new OptimisticLockException();
            return find(value.projectId(), value.userId()).orElseThrow(() -> new DataAccessException("Updated member could not be read"));
        } catch (SQLException e) { throw new DataAccessException("Update ProjectMember", e); }
    }

    private static ProjectMember map(ResultSet rs) throws SQLException {
        try {
            return new ProjectMember(rs.getObject("project_id", Long.class), rs.getObject("user_id", Long.class),
                    ProjectRole.valueOf(rs.getString("project_role")), MembershipStatus.valueOf(rs.getString("status")),
                    rs.getObject("joined_at", LocalDateTime.class), rs.getObject("updated_at", LocalDateTime.class), JdbcValues.version(rs));
        } catch (IllegalArgumentException e) { throw new SQLException("Unsupported membership enum", "22000", e); }
    }
}
