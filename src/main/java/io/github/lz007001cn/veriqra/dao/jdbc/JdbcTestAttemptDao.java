package io.github.lz007001cn.veriqra.dao.jdbc;

import io.github.lz007001cn.veriqra.dao.TestAttemptDao;
import io.github.lz007001cn.veriqra.exception.*;
import io.github.lz007001cn.veriqra.model.*;
import java.sql.*;
import java.time.LocalDateTime;
import java.util.*;
import java.nio.ByteBuffer;

/** Non-owning, connection-scoped DAO. Caller owns all transaction boundaries. */
public final class JdbcTestAttemptDao implements TestAttemptDao {
    private static final String SELECT = "SELECT id, test_run_case_id, attempt_no, status, executed_by, import_id, automation_mapping_id, executed_at, recorded_at, duration_ms, comment, failure_message, submission_key FROM test_attempts";
    private final Connection connection;
    public JdbcTestAttemptDao(Connection connection) { this.connection = Objects.requireNonNull(connection); }

    @Override public Optional<TestAttempt> findById(Long id) {
        return query(SELECT + " WHERE id=?", id).stream().findFirst();
    }

    @Override public Optional<TestAttempt> findByIdForUpdate(Long id) {
        requireTransaction();
        return query(SELECT + " WHERE id=? FOR UPDATE", id).stream().findFirst();
    }

    @Override public List<TestAttempt> listByRunCase(Long testRunCaseId) {
        return query(SELECT + " WHERE test_run_case_id=? ORDER BY attempt_no", testRunCaseId);
    }
    @Override public List<TestAttempt> listByRunCaseForUpdate(Long testRunCaseId) {
        requireTransaction();
        return query(SELECT + " WHERE test_run_case_id=? ORDER BY attempt_no FOR UPDATE", testRunCaseId);
    }

    @Override public List<TestAttempt> listByImport(Long importId) {
        return query(SELECT + " WHERE import_id=? ORDER BY test_run_case_id, attempt_no", importId);
    }

    @Override public Optional<TestAttempt> findLatestByRunCase(Long testRunCaseId) {
        return query(SELECT + " WHERE test_run_case_id=? ORDER BY attempt_no DESC LIMIT 1", testRunCaseId).stream().findFirst();
    }

    @Override public Optional<TestAttempt> findLatestByRunCaseForUpdate(Long testRunCaseId) {
        requireTransaction();
        return query(SELECT + " WHERE test_run_case_id=? ORDER BY attempt_no DESC LIMIT 1 FOR UPDATE", testRunCaseId).stream().findFirst();
    }

    @Override public Optional<TestAttempt> findBySubmissionKey(UUID submissionKey) {
        try (PreparedStatement s = connection.prepareStatement(SELECT + " WHERE submission_key=?")) {
            s.setBytes(1, uuidBytes(submissionKey));
            try (ResultSet rs = s.executeQuery()) { return rs.next() ? Optional.of(map(rs)) : Optional.empty(); }
        } catch (SQLException e) { throw new DataAccessException("Find TestAttempt by submission key", e); }
    }

    @Override public boolean hasAutomationMappingReferenceForUpdate(Long automationMappingId) {
        requireTransaction();
        return !query(SELECT + " WHERE automation_mapping_id=? ORDER BY id LIMIT 1 FOR UPDATE",
                automationMappingId).isEmpty();
    }

    private void requireTransaction() {
        try {
            if (connection.getAutoCommit()) throw new SQLException("Locking read requires an outer transaction", "25000");
        } catch (SQLException e) { throw new DataAccessException("Lock execution row", e); }
    }

    private List<TestAttempt> query(String sql, Long... values) {
        try (PreparedStatement s = connection.prepareStatement(sql)) {
            for (int i = 0; i < values.length; i++) s.setObject(i + 1, values[i], Types.BIGINT);
            try (ResultSet rs = s.executeQuery()) {
                List<TestAttempt> rows = new ArrayList<>();
                while (rs.next()) rows.add(map(rs));
                return List.copyOf(rows);
            }
        } catch (SQLException e) { throw new DataAccessException("Find TestAttempt", e); }
    }

    @Override public TestAttempt insert(TestAttempt value) {
        String sql = "INSERT INTO test_attempts (test_run_case_id, attempt_no, status, executed_by, import_id, automation_mapping_id, executed_at, duration_ms, comment, failure_message, submission_key) VALUES (?,?,?,?,?,?,?,?,?,?,?)";
        try (PreparedStatement s = connection.prepareStatement(sql, Statement.RETURN_GENERATED_KEYS)) {
            s.setObject(1, value.testRunCaseId(), Types.BIGINT);
            s.setObject(2, value.attemptNo(), Types.INTEGER);
            s.setString(3, value.status() == null ? null : value.status().name());
            s.setObject(4, value.executedBy(), Types.BIGINT);
            s.setObject(5, value.importId(), Types.BIGINT);
            s.setObject(6, value.automationMappingId(), Types.BIGINT);
            s.setObject(7, value.executedAt(), Types.TIMESTAMP);
            s.setObject(8, value.durationMs(), Types.BIGINT);
            s.setString(9, value.comment());
            s.setString(10, value.failureMessage());
            s.setBytes(11, uuidBytes(value.submissionKey()));
            if (s.executeUpdate() != 1) throw new SQLException("Unexpected insert count");
            long id;
            try (ResultSet keys = s.getGeneratedKeys()) {
                if (!keys.next()) throw new SQLException("Missing generated key");
                id = keys.getLong(1);
            }
            return findById(id).orElseThrow(() -> new DataAccessException("Inserted TestAttempt could not be read"));
        } catch (SQLException e) { throw new DataAccessException("Insert TestAttempt", e); }
    }

    private static TestAttempt map(ResultSet rs) throws SQLException {
        try {
            return new TestAttempt(rs.getObject("id", Long.class),
                    rs.getObject("test_run_case_id", Long.class),
                    attemptNumber(rs),
                    TestAttemptStatus.valueOf(rs.getString("status")),
                    rs.getObject("executed_by", Long.class),
                    rs.getObject("import_id", Long.class),
                    rs.getObject("automation_mapping_id", Long.class),
                    rs.getObject("executed_at", LocalDateTime.class),
                    rs.getObject("recorded_at", LocalDateTime.class),
                    rs.getObject("duration_ms", Long.class),
                    rs.getString("comment"),
                    rs.getString("failure_message"),
                    readUuid(rs));
        } catch (IllegalArgumentException e) { throw new SQLException("Unsupported TestAttempt enum", "22000", e); }
    }

    private static int attemptNumber(ResultSet rs) throws SQLException {
        long value = rs.getLong("attempt_no");
        if (value <= 0 || value > Integer.MAX_VALUE) throw new SQLException("attempt_no exceeds positive Java Integer range", "22003");
        return (int) value;
    }

    // Canonical UUID byte order (most-significant long first), equivalent to UUID_TO_BIN(uuid, 0).
    private static byte[] uuidBytes(UUID value) {
        return value == null ? null : ByteBuffer.allocate(16).putLong(value.getMostSignificantBits())
                .putLong(value.getLeastSignificantBits()).array();
    }
    private static UUID readUuid(ResultSet rs) throws SQLException {
        byte[] bytes = rs.getBytes("submission_key");
        if (bytes == null || bytes.length != 16) throw new SQLException("Invalid submission key width", "22000");
        ByteBuffer buffer = ByteBuffer.wrap(bytes);
        return new UUID(buffer.getLong(), buffer.getLong());
    }
}
