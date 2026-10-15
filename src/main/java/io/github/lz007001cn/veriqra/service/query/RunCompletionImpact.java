package io.github.lz007001cn.veriqra.service.query;
import io.github.lz007001cn.veriqra.model.TestRunStatus;
import java.util.Map;
public record RunCompletionImpact(Long runId, TestRunStatus status, Map<String,Long> outcomes,
        long openDefectCount, long pendingRetestDefectCount) {public RunCompletionImpact{outcomes=Map.copyOf(outcomes);}}
