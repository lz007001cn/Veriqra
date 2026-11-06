package io.github.lz007001cn.veriqra.service.ai;

import java.time.LocalDateTime;
import java.util.List;

public record AiRunSummaryPreview(AiRunSummaryInput input, AiRunSummaryAnalysis analysis,
        LocalDateTime generatedAt, List<FailureAction> failureActions) {
    public AiRunSummaryPreview { failureActions = List.copyOf(failureActions); }
    public record FailureAction(Long runCaseId, Long attemptId, String title, String draftTitle,
            String suggestion, List<LinkedDefect> linkedDefects) {
        public FailureAction { linkedDefects = List.copyOf(linkedDefects); }
    }
    public record LinkedDefect(Long id, Long keyNo, String title) { }
}
