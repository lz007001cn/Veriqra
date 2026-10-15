package io.github.lz007001cn.veriqra.dao;

import io.github.lz007001cn.veriqra.model.TestAttempt;
import java.util.*;

/** Append-only result fact. Import/mapping IDs are references only; no import behavior. Caller owns connection/transaction. */
public interface TestAttemptDao {
    Optional<TestAttempt> findById(Long id);
    /** Current locking read after the caller has locked Run then RunCase. */
    Optional<TestAttempt> findByIdForUpdate(Long id);
    List<TestAttempt> listByRunCase(Long testRunCaseId);
    List<TestAttempt> listByRunCaseForUpdate(Long testRunCaseId);
    List<TestAttempt> listByImport(Long importId);
    Optional<TestAttempt> findLatestByRunCase(Long testRunCaseId);
    /** Current locking read, even after an earlier repeatable-read snapshot.
     * Caller must first lock Run then RunCase, including when no Attempt exists.
     * Caller supplies the next positive sequence within Integer range; no automatic allocation/retry. */
    Optional<TestAttempt> findLatestByRunCaseForUpdate(Long testRunCaseId);
    Optional<TestAttempt> findBySubmissionKey(UUID submissionKey);
    /** Current locking history probe. Caller first locks the Identity and Mapping. */
    boolean hasAutomationMappingReferenceForUpdate(Long automationMappingId);
    /** Ignores generated fields; insert and readback belong in an outer transaction. */
    TestAttempt insert(TestAttempt value);
}
