package io.github.lz007001cn.veriqra.dao.jdbc;

import io.github.lz007001cn.veriqra.dao.ProjectSettingsDao;
import io.github.lz007001cn.veriqra.exception.DataAccessException;
import io.github.lz007001cn.veriqra.model.*;
import java.sql.*;
import java.time.LocalDateTime;
import java.util.*;

/** Uses the caller's transaction and retains historical manager rows. */
public final class JdbcProjectSettingsDao implements ProjectSettingsDao {
    private static final String MANAGER = "SELECT project_id,user_id,appointed_by,status,appointed_at,updated_at FROM project_managers";
    private final Connection connection;
    public JdbcProjectSettingsDao(Connection connection) { this.connection=Objects.requireNonNull(connection); }
    @FunctionalInterface private interface Bind { void accept(PreparedStatement s) throws SQLException; }
    @FunctionalInterface private interface MapRow<T> { T apply(ResultSet rs) throws SQLException; }
    private <T> List<T> query(String operation,String sql,Bind bind,MapRow<T> mapper) {
        try(var s=connection.prepareStatement(sql)) {
            bind.accept(s);
            try(var rs=s.executeQuery()) {
                var rows=new ArrayList<T>();
                while(rs.next()) {
                    try { rows.add(mapper.apply(rs)); }
                    catch(IllegalArgumentException e) { throw new SQLException("Unsupported membership status","22000",e); }
                }
                return List.copyOf(rows);
            }
        } catch(SQLException e) { throw new DataAccessException(operation,e); }
    }
    private <T> Optional<T> one(String operation,String sql,Bind bind,MapRow<T> mapper) {
        return query(operation,sql,bind,mapper).stream().findFirst();
    }
    private void write(String operation,String sql,Bind bind) {
        try(var s=connection.prepareStatement(sql)) { bind.accept(s);s.executeUpdate(); }
        catch(SQLException e) { throw new DataAccessException(operation,e); }
    }
    @Override public Optional<ProjectManager> findManager(long projectId, long userId) {
        return one("Find ProjectManager", MANAGER + " WHERE project_id=? AND user_id=?",
                s -> { s.setLong(1, projectId); s.setLong(2, userId); }, JdbcProjectSettingsDao::manager);
    }
    @Override public List<ProjectManager> listManagers(long projectId) {
        return query("List ProjectManager", MANAGER + " WHERE project_id=? ORDER BY user_id",
                s -> s.setLong(1, projectId), JdbcProjectSettingsDao::manager);
    }
    @Override public ProjectManager appointManager(long projectId, long userId, long actorId) {
        write("Appoint ProjectManager", "INSERT INTO project_managers(project_id,user_id,appointed_by,status) VALUES(?,?,?,'ACTIVE') "
                        + "ON DUPLICATE KEY UPDATE appointed_by=?,status='ACTIVE',appointed_at=CURRENT_TIMESTAMP(6),updated_at=CURRENT_TIMESTAMP(6)",
                s -> { s.setLong(1, projectId); s.setLong(2, userId); s.setLong(3, actorId); s.setLong(4, actorId); });
        return findManager(projectId, userId).orElseThrow(() -> new DataAccessException("Appointed manager could not be read"));
    }
    @Override public void revokeManager(long projectId, long userId) {
        write("Revoke ProjectManager", "UPDATE project_managers SET status='INACTIVE',updated_at=CURRENT_TIMESTAMP(6) WHERE project_id=? AND user_id=? AND status='ACTIVE'",
                s -> { s.setLong(1, projectId); s.setLong(2, userId); });
    }

    private static ProjectManager manager(ResultSet r) throws SQLException {
        return new ProjectManager(r.getLong("project_id"), r.getLong("user_id"), r.getLong("appointed_by"),
                MembershipStatus.valueOf(r.getString("status")), r.getObject("appointed_at", LocalDateTime.class), r.getObject("updated_at", LocalDateTime.class));
    }
}
