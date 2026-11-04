package io.github.lz007001cn.veriqra.dao;

import io.github.lz007001cn.veriqra.model.TestAttemptDefect;
import java.util.*;

/** Evidence row access. Caller checks FAIL, same project, permissions and parent state. */
public interface TestAttemptDefectDao {
    TestAttemptDefect add(TestAttemptDefect value);
    Optional<TestAttemptDefect> find(Long attemptId, Long defectId);
    boolean existsRecord(Long attemptId, Long defectId);
    /** Returns association records, ordered by defect ID. */
    List<TestAttemptDefect> listDefectsByAttempt(Long attemptId);
    /** Distinct defects linked to any FAIL attempt in this run, including older attempts. */
    List<Long> listDefectIdsByRun(Long testRunId);
    /** Returns association records, ordered by attempt ID. */
    List<TestAttemptDefect> listAttemptsByDefect(Long defectId);
    /** Current locking read of the evidence set; caller locks Attempt hierarchy, then Defect first. */
    List<TestAttemptDefect> listAttemptsByDefectForUpdate(Long defectId);
    /** Correct an erroneous association only; never removes either endpoint. */
    boolean remove(Long attemptId, Long defectId);
}
