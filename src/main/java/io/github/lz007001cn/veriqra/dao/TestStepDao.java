package io.github.lz007001cn.veriqra.dao;

import io.github.lz007001cn.veriqra.model.TestStep;
import java.util.*;

/** Current definition only. Lock the parent TestCase and coordinate all edits in an outer transaction. */
public interface TestStepDao {
    TestStep add(TestStep value);
    Optional<TestStep> find(Long testCaseId, Integer stepOrder);
    List<TestStep> listByTestCase(Long testCaseId);
    List<TestStep> listByTestCaseForShare(Long testCaseId);
    /** Updates content at the composite key; does not move a step or version the parent. */
    boolean updateContent(TestStep value);
    boolean remove(Long testCaseId, Integer stepOrder);
    /** Reordering: caller locks/versions parent, deletes then adds ordered rows in the same transaction. */
    int deleteByTestCase(Long testCaseId);
}
