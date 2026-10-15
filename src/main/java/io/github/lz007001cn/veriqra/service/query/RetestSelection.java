package io.github.lz007001cn.veriqra.service.query;
import io.github.lz007001cn.veriqra.model.*;
import java.time.LocalDateTime;
public record RetestSelection(Long id, Long failureAttemptId, Long passAttemptId, Long passRunId,
        Long passRunCaseId, Long linkedBy, LocalDateTime linkedAt, String reviewNote,
        DefectRetestTimingBasis timingBasis, Revocation revocation) {
    public record Revocation(Long revokedBy, LocalDateTime revokedAt, String reason,
                             DefectRetestRevocationOperation operation) { }
}
