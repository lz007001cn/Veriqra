package io.github.lz007001cn.veriqra.service.ai;

import com.fasterxml.jackson.annotation.JsonIgnore;
import java.util.List;

/** Model output. Failure suggestions are internal until matched to server-owned action records. */
public record AiRunSummaryAnalysis(String overview, List<String> findings, List<String> recommendations,
        @JsonIgnore List<FailureSuggestion> failureSuggestions) {
    public AiRunSummaryAnalysis(String overview, List<String> findings, List<String> recommendations) {
        this(overview, findings, recommendations, List.of());
    }
    public AiRunSummaryAnalysis {
        findings = findings == null ? null : List.copyOf(findings);
        recommendations = recommendations == null ? null : List.copyOf(recommendations);
        failureSuggestions = failureSuggestions == null ? List.of() : List.copyOf(failureSuggestions);
    }
    public record FailureSuggestion(Long runCaseId, String draftTitle, String suggestion) {
        public FailureSuggestion {
            draftTitle = optionalText(draftTitle, 240);
            suggestion = optionalText(suggestion, 2000);
        }
        private static String optionalText(String text, int max) {
            if (text == null || text.isBlank()) return null;
            String value = text.strip();
            return value.codePointCount(0, value.length()) <= max ? value : null;
        }
    }
}
