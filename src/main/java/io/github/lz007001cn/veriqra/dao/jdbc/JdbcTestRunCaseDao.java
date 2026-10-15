package io.github.lz007001cn.veriqra.dao.jdbc;

import io.github.lz007001cn.veriqra.dao.TestRunCaseDao;
import io.github.lz007001cn.veriqra.exception.*;
import io.github.lz007001cn.veriqra.model.*;
import java.sql.*;
import java.time.LocalDateTime;
import java.util.*;

/** Non-owning, connection-scoped DAO. Caller owns all transaction boundaries. */
public final class JdbcTestRunCaseDao implements TestRunCaseDao {
    private static final String SELECT = "SELECT id, test_run_id, test_case_id, snapshot_title, snapshot_description, snapshot_preconditions, snapshot_priority, captured_at FROM test_run_cases";
    private final Connection connection;
    public JdbcTestRunCaseDao(Connection connection) { this.connection = Objects.requireNonNull(connection); }

    @Override public Optional<TestRunCase> findById(Long id) {
        return query(SELECT + " WHERE id=?", id).stream().findFirst();
    }

    @Override public Optional<TestRunCase> findByIdForUpdate(Long id) {
        requireTransaction();
        return query(SELECT + " WHERE id=? FOR UPDATE", id).stream().findFirst();
    }

    @Override public Optional<TestRunCase> findByRunAndCase(Long testRunId, Long testCaseId) {
        return query(SELECT + " WHERE test_run_id=? AND test_case_id=?", testRunId, testCaseId).stream().findFirst();
    }

    @Override public List<TestRunCase> listByRun(Long testRunId) {
        return query(SELECT + " WHERE test_run_id=? ORDER BY test_case_id", testRunId);
    }
    @Override public List<TestRunCase> listByRunForUpdate(Long testRunId) {
        requireTransaction();
        return query(SELECT + " WHERE test_run_id=? ORDER BY id FOR UPDATE", testRunId);
    }

    @Override public List<TestRunCase> listByTestCase(Long testCaseId) {
        return query(SELECT + " WHERE test_case_id=? ORDER BY test_run_id", testCaseId);
    }

    private void requireTransaction() {
        try {
            if (connection.getAutoCommit()) throw new SQLException("Locking read requires an outer transaction", "25000");
        } catch (SQLException e) { throw new DataAccessException("Lock execution row", e); }
    }

    private List<TestRunCase> query(String sql, Long... values) {
        try (PreparedStatement s = connection.prepareStatement(sql)) {
            for (int i = 0; i < values.length; i++) s.setObject(i + 1, values[i], Types.BIGINT);
            try (ResultSet rs = s.executeQuery()) {
                List<TestRunCase> rows = new ArrayList<>();
                while (rs.next()) rows.add(map(rs));
                return List.copyOf(rows);
            }
        } catch (SQLException e) { throw new DataAccessException("Find TestRunCase", e); }
    }

    @Override public TestRunCase insert(TestRunCase value) {
        String sql = "INSERT INTO test_run_cases (test_run_id, test_case_id, snapshot_title, snapshot_description, snapshot_preconditions, snapshot_priority) VALUES (?,?,?,?,?,?)";
        try (PreparedStatement s = connection.prepareStatement(sql, Statement.RETURN_GENERATED_KEYS)) {
            s.setObject(1, value.testRunId(), Types.BIGINT);
            s.setObject(2, value.testCaseId(), Types.BIGINT);
            s.setString(3, value.snapshotTitle());
            s.setString(4, value.snapshotDescription());
            s.setString(5, value.snapshotPreconditions());
            s.setString(6, value.snapshotPriority() == null ? null : value.snapshotPriority().name());
            if (s.executeUpdate() != 1) throw new SQLException("Unexpected insert count");
            long id;
            try (ResultSet keys = s.getGeneratedKeys()) {
                if (!keys.next()) throw new SQLException("Missing generated key");
                id = keys.getLong(1);
            }
            return findById(id).orElseThrow(() -> new DataAccessException("Inserted TestRunCase could not be read"));
        } catch (SQLException e) { throw new DataAccessException("Insert TestRunCase", e); }
    }

    private static TestRunCase map(ResultSet rs) throws SQLException {
        try {
            return new TestRunCase(rs.getObject("id", Long.class),
                    rs.getObject("test_run_id", Long.class),
                    rs.getObject("test_case_id", Long.class),
                    rs.getString("snapshot_title"),
                    rs.getString("snapshot_description"),
                    rs.getString("snapshot_preconditions"),
                    Priority.valueOf(rs.getString("snapshot_priority")),
                    rs.getObject("captured_at", LocalDateTime.class));
        } catch (IllegalArgumentException e) { throw new SQLException("Unsupported TestRunCase enum", "22000", e); }
    }
}
