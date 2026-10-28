package io.github.lz007001cn.veriqra.dao.jdbc;

import io.github.lz007001cn.veriqra.dao.TestCaseRequirementDao;
import io.github.lz007001cn.veriqra.exception.DataAccessException;
import io.github.lz007001cn.veriqra.model.*;
import java.sql.*;
import java.time.LocalDateTime;
import java.util.*;

/** Non-owning row access. No workflow triggers or fabricated lock_version. */
public final class JdbcTestCaseRequirementDao implements TestCaseRequirementDao {
    private static final String SELECT = "SELECT requirement_id, test_case_id, status, linked_by, linked_at, reviewed_by, reviewed_at, updated_at FROM test_case_requirements";
    private final Connection connection;
    public JdbcTestCaseRequirementDao(Connection connection) { this.connection = Objects.requireNonNull(connection); }

    @Override public TestCaseRequirement add(TestCaseRequirement value) {
        try (PreparedStatement s = connection.prepareStatement(
                "INSERT INTO test_case_requirements (requirement_id, test_case_id, status, linked_by, reviewed_by, reviewed_at) VALUES (?,?,?,?,?,?)")) {
            s.setObject(1, value.requirementId(), Types.BIGINT);
            s.setObject(2, value.testCaseId(), Types.BIGINT);
            s.setString(3, value.status() == null ? null : value.status().name());
            s.setObject(4, value.linkedBy(), Types.BIGINT);
            s.setObject(5, value.reviewedBy(), Types.BIGINT);
            s.setObject(6, value.reviewedAt(), Types.TIMESTAMP);
            if (s.executeUpdate() != 1) throw new SQLException("Unexpected traceability insert count");
            return find(value.requirementId(), value.testCaseId()).orElseThrow(() -> new DataAccessException("Added traceability link could not be read"));
        } catch (SQLException e) { throw new DataAccessException("Add TestCaseRequirement", e); }
    }

    @Override public Optional<TestCaseRequirement> find(Long requirementId, Long testCaseId) {
        return query(SELECT + " WHERE requirement_id=? AND test_case_id=?", requirementId, testCaseId).stream().findFirst();
    }
    @Override public boolean existsRecord(Long requirementId, Long testCaseId) { return find(requirementId, testCaseId).isPresent(); }
    @Override public List<TestCaseRequirement> listByRequirement(Long requirementId) {
        return query(SELECT + " WHERE requirement_id=? ORDER BY test_case_id", requirementId);
    }
    @Override public List<TestCaseRequirement> listByTestCase(Long testCaseId) {
        return query(SELECT + " WHERE test_case_id=? ORDER BY requirement_id", testCaseId);
    }

    @Override public List<RequirementCoverage> listCoverageByProject(Long projectId) {
        // Semantic edits invalidate CONFIRMED in the asset services' write transaction. updated_at
        // is not a review version: priority/status-only changes intentionally preserve a review.
        String sql = "SELECT r.id AS requirement_id,COUNT(tc.id) AS confirmed_case_count FROM requirements r "
                + "LEFT JOIN test_case_requirements tr ON tr.requirement_id=r.id AND tr.status='CONFIRMED' "
                + "AND tr.reviewed_by IS NOT NULL AND tr.reviewed_at IS NOT NULL "
                + "LEFT JOIN test_cases tc ON tc.id=tr.test_case_id AND tc.project_id=r.project_id "
                + "AND tc.status='READY' AND r.status='ACTIVE' "
                + "WHERE r.project_id=? GROUP BY r.id,r.key_no ORDER BY r.key_no,r.id";
        try (PreparedStatement s = connection.prepareStatement(sql)) {
            s.setObject(1, projectId, Types.BIGINT);
            try (ResultSet rs = s.executeQuery()) {
                List<RequirementCoverage> rows = new ArrayList<>();
                while (rs.next()) rows.add(new RequirementCoverage(rs.getLong("requirement_id"), rs.getLong("confirmed_case_count")));
                return List.copyOf(rows);
            }
        } catch (SQLException e) { throw new DataAccessException("List requirement coverage", e); }
    }

    private List<TestCaseRequirement> query(String sql, Long... values) {
        try (PreparedStatement s = connection.prepareStatement(sql)) {
            for (int i = 0; i < values.length; i++) s.setObject(i + 1, values[i], Types.BIGINT);
            try (ResultSet rs = s.executeQuery()) {
                List<TestCaseRequirement> rows = new ArrayList<>();
                while (rs.next()) rows.add(map(rs));
                return List.copyOf(rows);
            }
        } catch (SQLException e) { throw new DataAccessException("Find TestCaseRequirement", e); }
    }

    @Override public boolean updateReviewState(Long requirementId, Long testCaseId, TraceabilityStatus status,
                                               Long reviewedBy, LocalDateTime reviewedAt) {
        try (PreparedStatement s = connection.prepareStatement(
                "UPDATE test_case_requirements SET status=?, reviewed_by=?, reviewed_at=?, updated_at=CURRENT_TIMESTAMP(6) "
                        + "WHERE requirement_id=? AND test_case_id=?")) {
            s.setString(1, status == null ? null : status.name());
            s.setObject(2, reviewedBy, Types.BIGINT);
            s.setObject(3, reviewedAt, Types.TIMESTAMP);
            s.setObject(4, requirementId, Types.BIGINT);
            s.setObject(5, testCaseId, Types.BIGINT);
            return s.executeUpdate() > 0;
        } catch (SQLException e) { throw new DataAccessException("Update traceability review state", e); }
    }

    @Override public boolean markRemoved(Long requirementId, Long testCaseId) {
        return updateReviewState(requirementId, testCaseId, TraceabilityStatus.REMOVED, null, null);
    }

    @Override public int markConfirmedNeedsReviewByRequirement(Long requirementId) {
        return invalidateConfirmed("UPDATE test_case_requirements SET status='NEEDS_REVIEW', reviewed_by=NULL, "
                + "reviewed_at=NULL, updated_at=CURRENT_TIMESTAMP(6) WHERE requirement_id=? AND status='CONFIRMED'",
                requirementId);
    }

    @Override public int markConfirmedNeedsReviewByTestCase(Long testCaseId) {
        return invalidateConfirmed("UPDATE test_case_requirements SET status='NEEDS_REVIEW', reviewed_by=NULL, "
                + "reviewed_at=NULL, updated_at=CURRENT_TIMESTAMP(6) WHERE test_case_id=? AND status='CONFIRMED'",
                testCaseId);
    }

    private int invalidateConfirmed(String sql, Long id) {
        try (PreparedStatement s = connection.prepareStatement(sql)) {
            s.setObject(1, id, Types.BIGINT);
            return s.executeUpdate();
        } catch (SQLException e) { throw new DataAccessException("Invalidate confirmed traceability", e); }
    }

    private static TestCaseRequirement map(ResultSet rs) throws SQLException {
        try {
            return new TestCaseRequirement(rs.getObject("requirement_id", Long.class), rs.getObject("test_case_id", Long.class),
                    TraceabilityStatus.valueOf(rs.getString("status")), rs.getObject("linked_by", Long.class),
                    rs.getObject("linked_at", LocalDateTime.class), rs.getObject("reviewed_by", Long.class),
                    rs.getObject("reviewed_at", LocalDateTime.class), rs.getObject("updated_at", LocalDateTime.class));
        } catch (IllegalArgumentException e) { throw new SQLException("Unsupported traceability status", "22000", e); }
    }
}
