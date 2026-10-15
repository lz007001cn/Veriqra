package io.github.lz007001cn.veriqra.web.dto;

import io.github.lz007001cn.veriqra.model.DefectRetestTimingBasis;
import java.util.Objects;
import java.util.UUID;

/** Caller-controlled review fields; source identity, policy and result version come from the Service. */
public record LinkRetestRequest(Long failureAttemptId, Long passAttemptId, Integer expectedVersion,
        String requestKey, String reviewNote, DefectRetestTimingBasis timingBasis,
        Long oldLinkId, String revokeReason) {
    public LinkRetestRequest {
        RetestRequestValidation.positiveId(failureAttemptId, "failureAttemptId");
        RetestRequestValidation.positiveId(passAttemptId, "passAttemptId");
        new ExpectedVersionRequest(expectedVersion);
        RetestRequestValidation.requestKey(requestKey);
        RetestRequestValidation.note(reviewNote, "reviewNote");
        Objects.requireNonNull(timingBasis, "timingBasis");
        if (oldLinkId != null) {
            RetestRequestValidation.positiveId(oldLinkId, "oldLinkId");
            RetestRequestValidation.note(revokeReason, "revokeReason");
        } else if (revokeReason != null) {
            throw new IllegalArgumentException("revokeReason requires oldLinkId");
        }
    }
    public UUID parsedRequestKey() { return RetestRequestValidation.requestKey(requestKey); }
}
