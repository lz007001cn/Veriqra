package io.github.lz007001cn.veriqra.web.dto;
import io.github.lz007001cn.veriqra.model.*;
import java.util.*;
public record ReopenDefectRequest(Integer expectedVersion, Long failureAttemptId, Long assigneeId) {
    public ReopenDefectRequest {
        new ExpectedVersionRequest(expectedVersion);
        RetestRequestValidation.positiveId(failureAttemptId, "failureAttemptId");
        RetestRequestValidation.positiveId(assigneeId, "assigneeId");
    }
}
