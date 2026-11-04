package io.github.lz007001cn.veriqra.service.ai;

import java.time.LocalDateTime;

public record AiRunSummaryPreview(AiRunSummaryInput input, AiRunSummaryAnalysis analysis,
        LocalDateTime generatedAt) { }
