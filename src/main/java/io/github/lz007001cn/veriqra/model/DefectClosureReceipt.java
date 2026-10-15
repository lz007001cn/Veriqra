package io.github.lz007001cn.veriqra.model;
import java.time.LocalDateTime;

/** Immutable close-time fact. Never recomputed from today's execution history. */
public record DefectClosureReceipt(Long id, Long defectId, Integer closedDefectVersion,
        Long closedBy, LocalDateTime closedAt, String policyVersion, String resolutionNote,
        Integer evidenceCount) {
    public static final String POLICY="R1_CLOSURE_V1";
}
