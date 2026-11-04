package io.github.lz007001cn.veriqra.dao.jdbc;

import io.github.lz007001cn.veriqra.dao.TestAttemptDefectDao;
import io.github.lz007001cn.veriqra.exception.DataAccessException;
import io.github.lz007001cn.veriqra.model.TestAttemptDefect;
import java.sql.*;
import java.time.LocalDateTime;
import java.util.*;

/** No sort_order/status/version columns are invented for this association. */
public final class JdbcTestAttemptDefectDao implements TestAttemptDefectDao {
    private static final String SELECT = "SELECT pc.attempt_id, pc.defect_id, pc.linked_by, pc.linked_at FROM test_attempt_defects pc";
    private final Connection connection;
    public JdbcTestAttemptDefectDao(Connection connection) { this.connection = Objects.requireNonNull(connection); }

    @Override public TestAttemptDefect add(TestAttemptDefect value) {
        try (PreparedStatement s = connection.prepareStatement(
                "INSERT INTO test_attempt_defects (attempt_id, defect_id, linked_by) VALUES (?,?,?)")) {
            s.setObject(1, value.attemptId(), Types.BIGINT);
            s.setObject(2, value.defectId(), Types.BIGINT);
            s.setObject(3, value.linkedBy(), Types.BIGINT);
            if (s.executeUpdate() != 1) throw new SQLException("Unexpected evidence association insert count");
            return find(value.attemptId(), value.defectId()).orElseThrow(() -> new DataAccessException("Added evidence link could not be read"));
        } catch (SQLException e) { throw new DataAccessException("Add TestAttemptDefect", e); }
    }

    @Override public Optional<TestAttemptDefect> find(Long attemptId, Long defectId) {
        return query(SELECT + " WHERE pc.attempt_id=? AND pc.defect_id=?", attemptId, defectId).stream().findFirst();
    }
    @Override public boolean existsRecord(Long attemptId, Long defectId) { return find(attemptId, defectId).isPresent(); }
    @Override public List<TestAttemptDefect> listDefectsByAttempt(Long attemptId) {
        return query(SELECT + " WHERE pc.attempt_id=? ORDER BY pc.defect_id", attemptId);
    }
    @Override public List<Long> listDefectIdsByRun(Long testRunId) {
        String sql = "SELECT DISTINCT ad.defect_id FROM test_attempt_defects ad "
                + "JOIN test_attempts a ON a.id=ad.attempt_id "
                + "JOIN test_run_cases rc ON rc.id=a.test_run_case_id "
                + "JOIN test_runs r ON r.id=rc.test_run_id JOIN defects d ON d.id=ad.defect_id "
                + "WHERE rc.test_run_id=? AND a.status='FAIL' AND d.project_id=r.project_id ORDER BY ad.defect_id";
        try (PreparedStatement s = connection.prepareStatement(sql)) {
            s.setObject(1, testRunId, Types.BIGINT);
            try (ResultSet rs = s.executeQuery()) {
                List<Long> rows = new ArrayList<>();
                while (rs.next()) rows.add(rs.getObject("defect_id", Long.class));
                return List.copyOf(rows);
            }
        } catch (SQLException e) { throw new DataAccessException("Find run defect IDs", e); }
    }
    @Override public List<TestAttemptDefect> listAttemptsByDefect(Long defectId) {
        return query(SELECT + " WHERE pc.defect_id=? ORDER BY pc.attempt_id", defectId);
    }
    @Override public List<TestAttemptDefect> listAttemptsByDefectForUpdate(Long defectId) {
        requireTransaction();
        return query(SELECT + " WHERE pc.defect_id=? ORDER BY pc.attempt_id FOR UPDATE", defectId);
    }
    private List<TestAttemptDefect> query(String sql, Long... values) {
        try (PreparedStatement s = connection.prepareStatement(sql)) {
            for (int i = 0; i < values.length; i++) s.setObject(i + 1, values[i], Types.BIGINT);
            try (ResultSet rs = s.executeQuery()) {
                List<TestAttemptDefect> rows = new ArrayList<>();
                while (rs.next()) rows.add(new TestAttemptDefect(rs.getObject("attempt_id", Long.class),
                        rs.getObject("defect_id", Long.class), rs.getObject("linked_by", Long.class), rs.getObject("linked_at", LocalDateTime.class)));
                return List.copyOf(rows);
            }
        } catch (SQLException e) { throw new DataAccessException("Find TestAttemptDefect", e); }
    }
    private void requireTransaction() {
        try {
            if (connection.getAutoCommit()) throw new SQLException("Evidence locking requires an outer transaction", "25000");
        } catch (SQLException e) { throw new DataAccessException("Lock TestAttemptDefect", e); }
    }
    @Override public boolean remove(Long attemptId, Long defectId) {
        try (PreparedStatement s = connection.prepareStatement("DELETE FROM test_attempt_defects WHERE attempt_id=? AND defect_id=?")) {
            s.setObject(1, attemptId, Types.BIGINT);
            s.setObject(2, defectId, Types.BIGINT);
            return s.executeUpdate() > 0;
        } catch (SQLException e) { throw new DataAccessException("Remove TestAttemptDefect", e); }
    }
}
