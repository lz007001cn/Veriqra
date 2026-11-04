package io.github.lz007001cn.veriqra.service.ai;

@FunctionalInterface
public interface AiRunSummaryProvider {
    AiRunSummaryAnalysis summarize(AiRunSummaryInput input, String language);
}
