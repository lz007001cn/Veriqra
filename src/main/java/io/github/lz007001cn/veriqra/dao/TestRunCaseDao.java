package io.github.lz007001cn.veriqra.dao;

import io.github.lz007001cn.veriqra.model.TestRunCase;
import java.util.*;

/** Immutable execution snapshot, independent of the current editable TestCase. Caller owns connection/transaction. */
public interface TestRunCaseDao {
    Optional<TestRunCase> findById(Long id);
    /** Outer transaction required. Lock Run before RunCase; locks live until outer completion. */
    Optional<TestRunCase> findByIdForUpdate(Long id);
    Optional<TestRunCase> findByRunAndCase(Long testRunId, Long testCaseId);
    List<TestRunCase> listByRun(Long testRunId);
    List<TestRunCase> listByRunForUpdate(Long testRunId);
    List<TestRunCase> listByTestCase(Long testCaseId);
    /** Ignores generated fields; insert and readback belong in an outer transaction. */
    TestRunCase insert(TestRunCase value);
}
