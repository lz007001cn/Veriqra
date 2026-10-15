package io.github.lz007001cn.veriqra.dao.jdbc;

import io.github.lz007001cn.veriqra.dao.TestRunDao;
import io.github.lz007001cn.veriqra.exception.*;
import io.github.lz007001cn.veriqra.model.*;
import java.sql.*;
import java.time.LocalDateTime;
import java.util.*;

/** Non-owning, connection-scoped DAO. Caller owns all transaction boundaries. */
public final class JdbcTestRunDao implements TestRunDao {
    private static final String SELECT = "SELECT id, project_id, test_plan_id, name, environment, build_version, status, ended_at, created_by, created_at, updated_at, lock_version FROM test_runs";
    private final Connection connection;
    public JdbcTestRunDao(Connection connection) { this.connection = Objects.requireNonNull(connection); }

    @Override public Optional<TestRun> findById(Long id) {
        return query(SELECT + " WHERE id=?", id).stream().findFirst();
    }

    @Override public Optional<TestRun> findByIdForUpdate(Long id) {
        requireTransaction();
        return query(SELECT + " WHERE id=? FOR UPDATE", id).stream().findFirst();
    }

    @Override public List<TestRun> listByProject(Long projectId) {
        return query(SELECT + " WHERE project_id=? ORDER BY created_at, id", projectId);
    }
    @Override public List<TestRun> listByProjectForUpdate(Long projectId) {
        requireTransaction();
        // Use the existing project range index instead of a whole PRIMARY scan for id ordering.
        return query(SELECT + " FORCE INDEX (ix_runs_project_created_id) WHERE project_id=? ORDER BY id FOR UPDATE", projectId);
    }

    @Override public List<TestRun> listByPlan(Long testPlanId) {
        return query(SELECT + " WHERE test_plan_id=? ORDER BY created_at, id", testPlanId);
    }

    private void requireTransaction() {
        try {
            if (connection.getAutoCommit()) throw new SQLException("Locking read requires an outer transaction", "25000");
        } catch (SQLException e) { throw new DataAccessException("Lock execution row", e); }
    }

    private List<TestRun> query(String sql, Long... values) {
        try (PreparedStatement s = connection.prepareStatement(sql)) {
            for (int i = 0; i < values.length; i++) s.setObject(i + 1, values[i], Types.BIGINT);
            try (ResultSet rs = s.executeQuery()) {
                List<TestRun> rows = new ArrayList<>();
                while (rs.next()) rows.add(map(rs));
                return List.copyOf(rows);
            }
        } catch (SQLException e) { throw new DataAccessException("Find TestRun", e); }
    }

    @Override public TestRun insert(TestRun value) {
        String sql = "INSERT INTO test_runs (project_id, test_plan_id, name, environment, build_version, status, ended_at, created_by) VALUES (?,?,?,?,?,?,?,?)";
        try (PreparedStatement s = connection.prepareStatement(sql, Statement.RETURN_GENERATED_KEYS)) {
            s.setObject(1, value.projectId(), Types.BIGINT);
            s.setObject(2, value.testPlanId(), Types.BIGINT);
            s.setString(3, value.name());
            s.setString(4, value.environment());
            s.setString(5, value.buildVersion());
            s.setString(6, value.status() == null ? null : value.status().name());
            s.setObject(7, value.endedAt(), Types.TIMESTAMP);
            s.setObject(8, value.createdBy(), Types.BIGINT);
            if (s.executeUpdate() != 1) throw new SQLException("Unexpected insert count");
            long id;
            try (ResultSet keys = s.getGeneratedKeys()) {
                if (!keys.next()) throw new SQLException("Missing generated key");
                id = keys.getLong(1);
            }
            return findById(id).orElseThrow(() -> new DataAccessException("Inserted TestRun could not be read"));
        } catch (SQLException e) { throw new DataAccessException("Insert TestRun", e); }
    }

    @Override public TestRun update(TestRun value) {
        JdbcValues.writableVersion(value.lockVersion());
        String sql = "UPDATE test_runs SET name=?, environment=?, build_version=?, status=?, ended_at=?, updated_at=CURRENT_TIMESTAMP(6), "
                + "lock_version=lock_version+1 WHERE id=? AND lock_version=?";
        try (PreparedStatement s = connection.prepareStatement(sql)) {
            s.setString(1, value.name());
            s.setString(2, value.environment());
            s.setString(3, value.buildVersion());
            s.setString(4, value.status() == null ? null : value.status().name());
            s.setObject(5, value.endedAt(), Types.TIMESTAMP);
            s.setObject(6, value.id(), Types.BIGINT);
            s.setObject(7, value.lockVersion(), Types.INTEGER);
            if (s.executeUpdate() != 1) throw new OptimisticLockException();
            return findById(value.id()).orElseThrow(() -> new DataAccessException("Updated TestRun could not be read"));
        } catch (SQLException e) { throw new DataAccessException("Update TestRun", e); }
    }

    private static TestRun map(ResultSet rs) throws SQLException {
        try {
            return new TestRun(rs.getObject("id", Long.class),
                    rs.getObject("project_id", Long.class),
                    rs.getObject("test_plan_id", Long.class),
                    rs.getString("name"),
                    rs.getString("environment"),
                    rs.getString("build_version"),
                    TestRunStatus.valueOf(rs.getString("status")),
                    rs.getObject("ended_at", LocalDateTime.class),
                    rs.getObject("created_by", Long.class),
                    rs.getObject("created_at", LocalDateTime.class),
                    rs.getObject("updated_at", LocalDateTime.class),
                    JdbcValues.version(rs));
        } catch (IllegalArgumentException e) { throw new SQLException("Unsupported TestRun enum", "22000", e); }
    }
}
