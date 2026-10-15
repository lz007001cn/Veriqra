package io.github.lz007001cn.veriqra.dao;

import io.github.lz007001cn.veriqra.model.TestRun;
import java.util.*;

/** Execution context; project and optional plan are immutable after creation. Caller owns connection/transaction. */
public interface TestRunDao {
    Optional<TestRun> findById(Long id);
    /** Outer transaction required. Lock Run before RunCase; locks live until outer completion. */
    Optional<TestRun> findByIdForUpdate(Long id);
    List<TestRun> listByProject(Long projectId);
    /** Current R1 discovery, sorted physical IDs; caller first locks relevant TestCases. */
    List<TestRun> listByProjectForUpdate(Long projectId);
    List<TestRun> listByPlan(Long testPlanId);
    /** Ignores generated fields; insert and readback belong in an outer transaction. */
    TestRun insert(TestRun value);
    /** Uses id + lockVersion; ownership, origin, business key and creation metadata stay unchanged. */
    TestRun update(TestRun value);
}
