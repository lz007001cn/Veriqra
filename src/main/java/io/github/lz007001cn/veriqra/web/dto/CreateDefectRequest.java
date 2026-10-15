package io.github.lz007001cn.veriqra.web.dto;
import io.github.lz007001cn.veriqra.model.*;
import java.util.*;
public record CreateDefectRequest(Long failureAttemptId, String title, String description, DefectSeverity severity, Priority priority, Long assigneeId) {
    public CreateDefectRequest {
        RetestRequestValidation.positiveId(failureAttemptId, "failureAttemptId");
        if (assigneeId != null) RetestRequestValidation.positiveId(assigneeId, "assigneeId");
        RetestRequestValidation.text(title, "title", 240);
        Objects.requireNonNull(severity, "severity");
        Objects.requireNonNull(priority, "priority");
    }
}
