package io.github.lz007001cn.veriqra.dao;

import io.github.lz007001cn.veriqra.model.TestRunCaseStep;
import java.util.*;

/** Insert-only snapshot rows; caller creates the complete snapshot in one outer transaction. */
public interface TestRunCaseStepDao {
    TestRunCaseStep insert(TestRunCaseStep value);
    Optional<TestRunCaseStep> find(Long testRunCaseId, Integer stepOrder);
    List<TestRunCaseStep> listByRunCase(Long testRunCaseId);
    List<TestRunCaseStep> listByRunCaseForShare(Long testRunCaseId);
}
