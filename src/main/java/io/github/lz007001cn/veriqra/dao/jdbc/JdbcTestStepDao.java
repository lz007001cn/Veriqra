package io.github.lz007001cn.veriqra.dao.jdbc;

import io.github.lz007001cn.veriqra.dao.TestStepDao;
import io.github.lz007001cn.veriqra.exception.DataAccessException;
import io.github.lz007001cn.veriqra.model.TestStep;
import java.sql.*;
import java.util.*;

/** No synthetic step ID or version: identity is test_case_id + step_order. */
public final class JdbcTestStepDao implements TestStepDao {
    private final Connection connection;
    public JdbcTestStepDao(Connection connection) { this.connection = Objects.requireNonNull(connection); }

    @Override public TestStep add(TestStep value) {
        try (PreparedStatement s = connection.prepareStatement(
                "INSERT INTO test_steps (test_case_id, step_order, action, expected_result) VALUES (?,?,?,?)")) {
            s.setObject(1, value.testCaseId(), Types.BIGINT);
            s.setObject(2, value.stepOrder(), Types.INTEGER);
            s.setString(3, value.action());
            s.setString(4, value.expectedResult());
            if (s.executeUpdate() != 1) throw new SQLException("Unexpected step insert count");
            return find(value.testCaseId(), value.stepOrder()).orElseThrow(() -> new DataAccessException("Added step could not be read"));
        } catch (SQLException e) { throw new DataAccessException("Add TestStep", e); }
    }

    @Override public Optional<TestStep> find(Long testCaseId, Integer order) {
        try (PreparedStatement s = connection.prepareStatement(
                "SELECT test_case_id, step_order, action, expected_result FROM test_steps WHERE test_case_id=? AND step_order=?")) {
            s.setObject(1, testCaseId, Types.BIGINT);
            s.setObject(2, order, Types.INTEGER);
            try (ResultSet rs = s.executeQuery()) { return rs.next() ? Optional.of(map(rs)) : Optional.empty(); }
        } catch (SQLException e) { throw new DataAccessException("Find TestStep", e); }
    }

    @Override public List<TestStep> listByTestCase(Long testCaseId) {
        return list(testCaseId, false);
    }
    @Override public List<TestStep> listByTestCaseForShare(Long testCaseId) {
        R1Jdbc.transaction(connection);
        return list(testCaseId, true);
    }
    private List<TestStep> list(Long testCaseId, boolean locked) {
        try (PreparedStatement s = connection.prepareStatement(
                "SELECT test_case_id, step_order, action, expected_result FROM test_steps WHERE test_case_id=? ORDER BY step_order"+(locked?" FOR SHARE":""))) {
            s.setObject(1, testCaseId, Types.BIGINT);
            try (ResultSet rs = s.executeQuery()) {
                List<TestStep> rows = new ArrayList<>();
                while (rs.next()) rows.add(map(rs));
                return List.copyOf(rows);
            }
        } catch (SQLException e) { throw new DataAccessException("List TestStep", e); }
    }

    @Override public boolean updateContent(TestStep value) {
        try (PreparedStatement s = connection.prepareStatement(
                "UPDATE test_steps SET action=?, expected_result=? WHERE test_case_id=? AND step_order=?")) {
            s.setString(1, value.action());
            s.setString(2, value.expectedResult());
            s.setObject(3, value.testCaseId(), Types.BIGINT);
            s.setObject(4, value.stepOrder(), Types.INTEGER);
            return s.executeUpdate() > 0;
        } catch (SQLException e) { throw new DataAccessException("Update TestStep", e); }
    }

    @Override public boolean remove(Long testCaseId, Integer order) {
        try (PreparedStatement s = connection.prepareStatement("DELETE FROM test_steps WHERE test_case_id=? AND step_order=?")) {
            s.setObject(1, testCaseId, Types.BIGINT);
            s.setObject(2, order, Types.INTEGER);
            return s.executeUpdate() > 0;
        } catch (SQLException e) { throw new DataAccessException("Remove TestStep", e); }
    }
    @Override public int deleteByTestCase(Long testCaseId) {
        try (PreparedStatement s = connection.prepareStatement("DELETE FROM test_steps WHERE test_case_id=?")) {
            s.setObject(1, testCaseId, Types.BIGINT);
            return s.executeUpdate();
        } catch (SQLException e) { throw new DataAccessException("Delete current TestSteps", e); }
    }

    private static TestStep map(ResultSet rs) throws SQLException {
        // SMALLINT UNSIGNED (1..65535) fits Integer, not Java Short.
        return new TestStep(rs.getObject("test_case_id", Long.class), rs.getObject("step_order", Integer.class),
                rs.getString("action"), rs.getString("expected_result"));
    }
}
