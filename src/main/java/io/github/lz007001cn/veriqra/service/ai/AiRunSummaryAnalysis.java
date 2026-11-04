package io.github.lz007001cn.veriqra.service.ai;

import java.util.List;

/** Narrative only: authoritative result counts remain outside the model output. */
public record AiRunSummaryAnalysis(String overview, List<String> findings, List<String> recommendations) {
    public AiRunSummaryAnalysis {
        findings = findings == null ? null : List.copyOf(findings);
        recommendations = recommendations == null ? null : List.copyOf(recommendations);
    }
}
