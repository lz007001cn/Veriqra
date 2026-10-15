package io.github.lz007001cn.veriqra.model;
import java.time.LocalDateTime;
import java.util.UUID;

/** Explicit evidence selection, not a declaration that the referenced PASS is eligible. */
public record DefectRetestLink(Long id, Long defectId, Long failureAttemptId, Long passAttemptId,
        String policyVersion, Long linkedBy, LocalDateTime linkedAt, String reviewNote,
        DefectRetestTimingBasis timingBasis, UUID requestKey, Sha256Digest requestHash,
        Integer resultDefectVersion, DefectRetestRevocation revocation) {
    public static final String POLICY="EXACT_SEMANTIC_V1";
}
