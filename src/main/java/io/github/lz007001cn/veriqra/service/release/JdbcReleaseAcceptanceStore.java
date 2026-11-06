package io.github.lz007001cn.veriqra.service.release;

import com.fasterxml.jackson.core.JsonProcessingException;
import com.fasterxml.jackson.databind.ObjectMapper;
import com.fasterxml.jackson.databind.SerializationFeature;
import com.fasterxml.jackson.datatype.jsr310.JavaTimeModule;
import io.github.lz007001cn.veriqra.exception.DataAccessException;
import io.github.lz007001cn.veriqra.model.DefectSeverity;
import io.github.lz007001cn.veriqra.model.DefectStatus;
import io.github.lz007001cn.veriqra.model.Priority;
import io.github.lz007001cn.veriqra.model.TestRunStatus;
import io.github.lz007001cn.veriqra.service.release.ReleaseAcceptance.*;
import java.security.MessageDigest;
import java.security.NoSuchAlgorithmException;
import java.sql.*;
import java.time.LocalDateTime;
import java.util.*;

/** Reads evidence and writes immutable records over the service transaction's connection. */
final class JdbcReleaseAcceptanceStore {
    private static final String SUMMARY = "id, project_id, build_version, verdict, reviewer_id, reviewer_name, created_at, run_count, unclosed_defect_count, defect_scope";
    private static final String DETAIL = "SELECT " + SUMMARY + ", notes, evidence FROM release_acceptances";
    private static final ObjectMapper JSON = new ObjectMapper().registerModule(new JavaTimeModule())
            .disable(SerializationFeature.WRITE_DATES_AS_TIMESTAMPS);
    private final Connection connection;

    JdbcReleaseAcceptanceStore(Connection connection) { this.connection = Objects.requireNonNull(connection); }

    List<RunEvidence> runs(long projectId, List<Long> runIds) {
        String placeholders = String.join(",", Collections.nCopies(runIds.size(), "?"));
        String sql = """
                SELECT r.id, r.name, r.build_version, r.environment, r.status, r.ended_at,
                       COUNT(rc.id) AS total, COUNT(a.id) AS recorded,
                       COALESCE(SUM(a.status = 'PASS'), 0) AS passed,
                       COALESCE(SUM(a.status = 'FAIL'), 0) AS failed,
                       COALESCE(SUM(a.status = 'BLOCKED'), 0) AS blocked,
                       COALESCE(SUM(a.status = 'SKIPPED'), 0) AS skipped
                FROM test_runs r
                LEFT JOIN test_run_cases rc ON rc.test_run_id = r.id
                LEFT JOIN test_attempts a ON a.test_run_case_id = rc.id AND a.attempt_no = (
                    SELECT MAX(latest.attempt_no) FROM test_attempts latest WHERE latest.test_run_case_id = rc.id
                )
                WHERE r.project_id = ? AND r.id IN (%s)
                GROUP BY r.id, r.name, r.build_version, r.environment, r.status, r.ended_at
                ORDER BY r.id
                """.formatted(placeholders);
        try (PreparedStatement query = connection.prepareStatement(sql)) {
            query.setLong(1, projectId);
            for (int i = 0; i < runIds.size(); i++) query.setLong(i + 2, runIds.get(i));
            try (ResultSet rows = query.executeQuery()) {
                List<RunEvidence> result = new ArrayList<>();
                while (rows.next()) {
                    long total = rows.getLong("total"), recorded = rows.getLong("recorded");
                    var counts = new Counts(total, recorded, rows.getLong("passed"), rows.getLong("failed"),
                            rows.getLong("blocked"), rows.getLong("skipped"), total - recorded);
                    result.add(new RunEvidence(rows.getLong("id"), rows.getString("name"), rows.getString("build_version"),
                            rows.getString("environment"), TestRunStatus.valueOf(rows.getString("status")),
                            rows.getObject("ended_at", LocalDateTime.class), counts.outcome(), counts));
                }
                return List.copyOf(result);
            }
        } catch (SQLException e) { throw new DataAccessException("Capture release run evidence", e); }
    }

    List<DefectEvidence> unclosedDefects(long projectId, int limit) {
        String sql = "SELECT id, key_no, title, severity, priority, status FROM defects "
                + "WHERE project_id = ? AND status <> 'CLOSED' ORDER BY key_no LIMIT ?";
        try (PreparedStatement query = connection.prepareStatement(sql)) {
            query.setLong(1, projectId);
            query.setInt(2, limit);
            try (ResultSet rows = query.executeQuery()) {
                List<DefectEvidence> result = new ArrayList<>();
                while (rows.next()) {
                    result.add(new DefectEvidence(rows.getLong("id"), rows.getLong("key_no"), rows.getString("title"),
                            DefectSeverity.valueOf(rows.getString("severity")), Priority.valueOf(rows.getString("priority")),
                            DefectStatus.valueOf(rows.getString("status"))));
                }
                return List.copyOf(result);
            }
        } catch (SQLException e) { throw new DataAccessException("Capture release defect evidence", e); }
    }

    List<Summary> list(long projectId, Long beforeId, int limit) {
        String sql = "SELECT " + SUMMARY + " FROM release_acceptances WHERE project_id = ?"
                + (beforeId == null ? "" : " AND id < ?") + " ORDER BY id DESC LIMIT ?";
        try (PreparedStatement query = connection.prepareStatement(sql)) {
            query.setLong(1, projectId);
            int limitIndex = 2;
            if (beforeId != null) query.setLong(limitIndex++, beforeId);
            query.setInt(limitIndex, limit);
            try (ResultSet rows = query.executeQuery()) {
                List<Summary> result = new ArrayList<>();
                while (rows.next()) result.add(summary(rows));
                return List.copyOf(result);
            }
        } catch (SQLException e) { throw new DataAccessException("List release acceptances", e); }
    }

    Optional<ReleaseAcceptance> find(long projectId, long id) {
        return one(DETAIL + " WHERE project_id = ? AND id = ?", projectId, id);
    }

    Optional<ReleaseAcceptance> findByRequest(long projectId, long reviewerId, UUID requestKey) {
        return one(DETAIL + " WHERE project_id = ? AND reviewer_id = ? AND request_key = UUID_TO_BIN(?, 0)",
                projectId, reviewerId, requestKey.toString());
    }

    private Optional<ReleaseAcceptance> one(String sql, Object... values) {
        try (PreparedStatement query = connection.prepareStatement(sql)) {
            for (int i = 0; i < values.length; i++) query.setObject(i + 1, values[i]);
            try (ResultSet rows = query.executeQuery()) {
                if (!rows.next()) return Optional.empty();
                var header = summary(rows);
                Evidence evidence = JSON.readValue(rows.getString("evidence"), Evidence.class);
                if (evidence.runs().size() != header.runCount() || evidence.unclosedDefects().size() != header.unclosedDefectCount())
                    throw new DataAccessException("Stored release acceptance has inconsistent evidence counts");
                return Optional.of(new ReleaseAcceptance(header.id(), header.projectId(), header.buildVersion(),
                        header.verdict(), header.reviewerId(), header.reviewerName(), header.createdAt(), header.runCount(),
                        header.unclosedDefectCount(), header.defectScope(), rows.getString("notes"),
                        evidence.runs(), evidence.unclosedDefects()));
            }
        } catch (SQLException e) { throw new DataAccessException("Read release acceptance", e); }
        catch (JsonProcessingException e) { throw new DataAccessException("Read stored release acceptance evidence"); }
    }

    ReleaseAcceptance insert(ReleaseAcceptance record, UUID requestKey) {
        String sql = """
                INSERT INTO release_acceptances (project_id, build_version, verdict, reviewer_id, reviewer_name,
                    notes, created_at, request_key, run_count, unclosed_defect_count, defect_scope, evidence)
                VALUES (?, ?, ?, ?, ?, ?, ?, UUID_TO_BIN(?, 0), ?, ?, ?, ?)
                """;
        try (PreparedStatement statement = connection.prepareStatement(sql, Statement.RETURN_GENERATED_KEYS)) {
            statement.setLong(1, record.projectId());
            statement.setString(2, record.buildVersion());
            statement.setString(3, record.verdict().name());
            statement.setLong(4, record.reviewerId());
            statement.setString(5, record.reviewerName());
            statement.setString(6, record.notes());
            statement.setObject(7, record.createdAt());
            statement.setString(8, requestKey.toString());
            statement.setInt(9, record.runCount());
            statement.setInt(10, record.unclosedDefectCount());
            statement.setString(11, record.defectScope());
            statement.setString(12, JSON.writeValueAsString(new Evidence(record.runs(), record.unclosedDefects())));
            if (statement.executeUpdate() != 1) throw new SQLException("Unexpected release acceptance insert count");
            long id;
            try (ResultSet keys = statement.getGeneratedKeys()) {
                if (!keys.next()) throw new SQLException("Missing generated release acceptance key");
                id = keys.getLong(1);
            }
            return find(record.projectId(), id).orElseThrow(() -> new DataAccessException("Inserted release acceptance is unavailable"));
        } catch (SQLException e) { throw new DataAccessException("Insert release acceptance", e); }
        catch (JsonProcessingException e) { throw new DataAccessException("Encode release acceptance evidence"); }
    }

    static String reviewToken(long projectId, String buildVersion, List<RunEvidence> runs, List<DefectEvidence> defects) {
        try {
            byte[] bytes = JSON.writeValueAsBytes(new ReviewEvidence(projectId, buildVersion,
                    ReleaseAcceptance.ALL_PROJECT_UNCLOSED, new Evidence(runs, defects)));
            return HexFormat.of().formatHex(MessageDigest.getInstance("SHA-256").digest(bytes));
        } catch (JsonProcessingException | NoSuchAlgorithmException e) {
            throw new DataAccessException("Fingerprint release acceptance evidence");
        }
    }

    private static Summary summary(ResultSet row) throws SQLException {
        return new Summary(row.getLong("id"), row.getLong("project_id"), row.getString("build_version"),
                Verdict.valueOf(row.getString("verdict")), row.getLong("reviewer_id"), row.getString("reviewer_name"),
                row.getObject("created_at", LocalDateTime.class), row.getInt("run_count"),
                row.getInt("unclosed_defect_count"), row.getString("defect_scope"));
    }

    private record Evidence(List<RunEvidence> runs, List<DefectEvidence> unclosedDefects) { }
    private record ReviewEvidence(long projectId, String buildVersion, String defectScope, Evidence evidence) { }
}
