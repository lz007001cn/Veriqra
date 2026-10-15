package io.github.lz007001cn.veriqra.model;

/** Immutable per-FAIL close-time selection; same-RunCase policy has no explicit link ID. */
public record DefectClosureItem(Long receiptId, Long failureAttemptId, Long defectId,
        Long passAttemptId, Long retestLinkId, DefectClosureEvidencePolicy evidencePolicy) { }
