package io.github.lz007001cn.veriqra.dao.jdbc;

import io.github.lz007001cn.veriqra.dao.TestRunCaseStepDao;
import io.github.lz007001cn.veriqra.exception.DataAccessException;
import io.github.lz007001cn.veriqra.model.TestRunCaseStep;
import java.sql.*;
import java.util.*;

/** No synthetic step ID or version: identity is test_run_case_id + step_order. */
public final class JdbcTestRunCaseStepDao implements TestRunCaseStepDao {
    private final Connection connection;
    public JdbcTestRunCaseStepDao(Connection connection) { this.connection = Objects.requireNonNull(connection); }

    @Override public TestRunCaseStep insert(TestRunCaseStep value) {
        try (PreparedStatement s = connection.prepareStatement(
                "INSERT INTO test_run_case_steps (test_run_case_id, step_order, action, expected_result) VALUES (?,?,?,?)")) {
            s.setObject(1, value.testRunCaseId(), Types.BIGINT);
            s.setObject(2, value.stepOrder(), Types.INTEGER);
            s.setString(3, value.action());
            s.setString(4, value.expectedResult());
            if (s.executeUpdate() != 1) throw new SQLException("Unexpected step insert count");
            return find(value.testRunCaseId(), value.stepOrder()).orElseThrow(() -> new DataAccessException("Added step could not be read"));
        } catch (SQLException e) { throw new DataAccessException("Add TestRunCaseStep", e); }
    }

    @Override public Optional<TestRunCaseStep> find(Long testRunCaseId, Integer order) {
        try (PreparedStatement s = connection.prepareStatement(
                "SELECT test_run_case_id, step_order, action, expected_result FROM test_run_case_steps WHERE test_run_case_id=? AND step_order=?")) {
            s.setObject(1, testRunCaseId, Types.BIGINT);
            s.setObject(2, order, Types.INTEGER);
            try (ResultSet rs = s.executeQuery()) { return rs.next() ? Optional.of(map(rs)) : Optional.empty(); }
        } catch (SQLException e) { throw new DataAccessException("Find TestRunCaseStep", e); }
    }

    @Override public List<TestRunCaseStep> listByRunCase(Long testRunCaseId) {
        return list(testRunCaseId, false);
    }
    @Override public List<TestRunCaseStep> listByRunCaseForShare(Long testRunCaseId) {
        R1Jdbc.transaction(connection);
        return list(testRunCaseId, true);
    }
    private List<TestRunCaseStep> list(Long testRunCaseId, boolean locked) {
        try (PreparedStatement s = connection.prepareStatement(
                "SELECT test_run_case_id, step_order, action, expected_result FROM test_run_case_steps WHERE test_run_case_id=? ORDER BY step_order"+(locked?" FOR SHARE":""))) {
            s.setObject(1, testRunCaseId, Types.BIGINT);
            try (ResultSet rs = s.executeQuery()) {
                List<TestRunCaseStep> rows = new ArrayList<>();
                while (rs.next()) rows.add(map(rs));
                return List.copyOf(rows);
            }
        } catch (SQLException e) { throw new DataAccessException("List TestRunCaseStep", e); }
    }

    private static TestRunCaseStep map(ResultSet rs) throws SQLException {
        // SMALLINT UNSIGNED (1..65535) fits Integer, not Java Short.
        return new TestRunCaseStep(rs.getObject("test_run_case_id", Long.class), rs.getObject("step_order", Integer.class),
                rs.getString("action"), rs.getString("expected_result"));
    }
}
