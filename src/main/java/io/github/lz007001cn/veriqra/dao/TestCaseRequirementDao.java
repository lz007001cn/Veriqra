package io.github.lz007001cn.veriqra.dao;

import io.github.lz007001cn.veriqra.model.*;
import java.time.LocalDateTime;
import java.util.*;

/** Current traceability association. Caller locks parents and checks project/permissions/content. */
public interface TestCaseRequirementDao {
    TestCaseRequirement add(TestCaseRequirement value);
    Optional<TestCaseRequirement> find(Long requirementId, Long testCaseId);
    /** Row existence including REMOVED; not a current-link or effective-coverage check. */
    boolean existsRecord(Long requirementId, Long testCaseId);
    /** Includes all states, ordered by opposite endpoint ID. */
    List<TestCaseRequirement> listByRequirement(Long requirementId);
    List<TestCaseRequirement> listByTestCase(Long testCaseId);
    /** One row for every project requirement, including zero coverage. Only ACTIVE requirements
     * with same-project READY cases and current CONFIRMED reviews contribute to the count. */
    List<RequirementCoverage> listCoverageByProject(Long projectId);
    /** Writes supplied review fields as-is; CHECK enforces their shape. No automatic invalidation.
     * Re-link by writing NEEDS_REVIEW with null review fields; retains original linkedBy/linkedAt. */
    boolean updateReviewState(Long requirementId, Long testCaseId, TraceabilityStatus status,
                              Long reviewedBy, LocalDateTime reviewedAt);
    /** Logical removal, retaining the association and first-link metadata. */
    boolean markRemoved(Long requirementId, Long testCaseId);
    /** Invalidates only currently CONFIRMED links; REMOVED rows remain REMOVED. */
    int markConfirmedNeedsReviewByRequirement(Long requirementId);
    /** Invalidates only currently CONFIRMED links; REMOVED rows remain REMOVED. */
    int markConfirmedNeedsReviewByTestCase(Long testCaseId);
}
