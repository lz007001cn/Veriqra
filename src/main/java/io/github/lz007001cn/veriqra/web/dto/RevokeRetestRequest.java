package io.github.lz007001cn.veriqra.web.dto;

import java.util.UUID;

public record RevokeRetestRequest(Integer expectedVersion, String requestKey, String reason) {
    public RevokeRetestRequest {
        new ExpectedVersionRequest(expectedVersion);
        RetestRequestValidation.requestKey(requestKey);
        RetestRequestValidation.note(reason, "reason");
    }
    public UUID parsedRequestKey() { return RetestRequestValidation.requestKey(requestKey); }
}
