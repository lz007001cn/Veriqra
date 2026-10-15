package io.github.lz007001cn.veriqra.service.command;
import io.github.lz007001cn.veriqra.model.DefectRetestTimingBasis;
import java.util.UUID;
public record LinkRetestCommand(Long defectId, Long failureAttemptId, Long passAttemptId,
        Integer expectedVersion, UUID requestKey, String reviewNote, DefectRetestTimingBasis timingBasis,
        Long oldLinkId, String revokeReason) { }
