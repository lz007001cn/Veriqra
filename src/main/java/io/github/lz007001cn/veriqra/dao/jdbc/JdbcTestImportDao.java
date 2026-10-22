package io.github.lz007001cn.veriqra.dao.jdbc;

import io.github.lz007001cn.veriqra.dao.TestImportDao;
import io.github.lz007001cn.veriqra.exception.DataAccessException;
import io.github.lz007001cn.veriqra.model.TestImport;
import java.nio.ByteBuffer;
import java.sql.*;
import java.time.LocalDateTime;
import java.util.*;

/** Non-owning append-only batch DAO. No implicit creation of Run, Mapping or Attempt. */
public final class JdbcTestImportDao implements TestImportDao {
    private static final String SELECT = "SELECT id, test_run_id, request_key, report_sha256, source_namespace, original_filename, imported_by, imported_at FROM test_imports";
    private final Connection connection;
    public JdbcTestImportDao(Connection connection) { this.connection = Objects.requireNonNull(connection); }
    @Override public Optional<TestImport> findById(Long id) {
        return query(SELECT + " WHERE id=?", id).stream().findFirst();
    }
    @Override public List<TestImport> listByRun(Long runId) {
        return query(SELECT + " WHERE test_run_id=? ORDER BY imported_at, id", runId);
    }
    @Override public List<TestImport> listByProject(Long projectId) {
        return query(SELECT + " WHERE test_run_id IN (SELECT id FROM test_runs WHERE project_id=?) ORDER BY imported_at DESC, id DESC", projectId);
    }
    private List<TestImport> query(String sql, Long id) {
        try (PreparedStatement s = connection.prepareStatement(sql)) {
            s.setObject(1, id, Types.BIGINT);
            try (ResultSet rs = s.executeQuery()) {
                List<TestImport> rows = new ArrayList<>();
                while (rs.next()) rows.add(map(rs));
                return List.copyOf(rows);
            }
        } catch (SQLException e) { throw new DataAccessException("Find TestImport", e); }
    }
    @Override public Optional<TestImport> findByRequestKey(UUID key) {
        try (PreparedStatement s = connection.prepareStatement(SELECT + " WHERE request_key=?")) {
            s.setBytes(1, uuidBytes(key));
            try (ResultSet rs = s.executeQuery()) { return rs.next() ? Optional.of(map(rs)) : Optional.empty(); }
        } catch (SQLException e) { throw new DataAccessException("Find import request", e); }
    }
    @Override public TestImport insert(TestImport value) {
        byte[] hash = value.reportSha256();
        // BINARY pads short inputs; reject malformed SHA-256 lengths before any write.
        if (hash != null && hash.length != 32) throw new DataAccessException("reportSha256 must contain exactly 32 bytes");
        try (PreparedStatement s = connection.prepareStatement(
                "INSERT INTO test_imports (test_run_id, request_key, report_sha256, source_namespace, original_filename, imported_by) VALUES (?,?,?,?,?,?)", Statement.RETURN_GENERATED_KEYS)) {
            s.setObject(1, value.testRunId(), Types.BIGINT); s.setBytes(2, uuidBytes(value.requestKey()));
            s.setBytes(3, hash); s.setString(4, value.sourceNamespace()); s.setString(5, value.originalFilename());
            s.setObject(6, value.importedBy(), Types.BIGINT);
            if (s.executeUpdate() != 1) throw new SQLException("Unexpected import insert count");
            long id;
            try (ResultSet keys = s.getGeneratedKeys()) {
                if (!keys.next()) throw new SQLException("Missing generated key");
                id = keys.getLong(1);
            }
            return findById(id).orElseThrow(() -> new DataAccessException("Inserted import could not be read"));
        } catch (SQLException e) { throw new DataAccessException("Insert TestImport", e); }
    }
    private static byte[] uuidBytes(UUID key) {
        return key == null ? null : ByteBuffer.allocate(16).putLong(key.getMostSignificantBits()).putLong(key.getLeastSignificantBits()).array();
    }
    private static TestImport map(ResultSet rs) throws SQLException {
        byte[] key = rs.getBytes("request_key"); byte[] hash = rs.getBytes("report_sha256");
        if (key == null || key.length != 16 || hash == null || hash.length != 32) throw new SQLException("Invalid import binary width", "22000");
        ByteBuffer buffer = ByteBuffer.wrap(key); // Canonical UUID byte order, same as Attempt, no swap flag.
        return new TestImport(rs.getObject("id", Long.class), rs.getObject("test_run_id", Long.class),
                new UUID(buffer.getLong(), buffer.getLong()), hash, rs.getString("source_namespace"),
                rs.getString("original_filename"), rs.getObject("imported_by", Long.class), rs.getObject("imported_at", LocalDateTime.class));
    }
}
