package io.github.lz007001cn.veriqra.service;

import io.github.lz007001cn.veriqra.config.AiConfig;
import io.github.lz007001cn.veriqra.service.ai.*;
import org.junit.jupiter.api.Test;
import static org.junit.jupiter.api.Assertions.*;

class VertexAiRunSummaryTest {
    @Test void parsesQualitativeSummaryAndAllowsNoFindings() {
        try (var provider = new VertexAiProvider(new AiConfig(null, "global", "gemini-2.5-flash", null))) {
            var result = provider.parseSummary("{\"overview\":\"该轮尚未完成。\",\"findings\":[],\"recommendations\":[\"继续执行未运行用例。\"]}");
            assertEquals("该轮尚未完成。", result.overview());
            assertTrue(result.findings().isEmpty());
            assertEquals(1, result.recommendations().size());
        }
    }
    @Test void rejectsMalformedUnstructuredOrExcessiveOutput() {
        try (var provider = new VertexAiProvider(new AiConfig(null, "global", "gemini-2.5-flash", null))) {
            for (String text : new String[]{"plain text", "[]", "null", "{}",
                    "{\"overview\":\" \",\"findings\":[],\"recommendations\":[]}",
                    "{\"overview\":\"ok\",\"findings\":[3],\"recommendations\":[]}",
                    "{\"overview\":\"ok\",\"findings\":[],\"recommendations\":[\"\"]}",
                    "{\"overview\":\"ok\",\"findings\":[" + String.join(",", java.util.Collections.nCopies(9,"\"item\"")) + "],\"recommendations\":[]}"}) {
                assertEquals("AI_INVALID_RESPONSE", assertThrows(AiUnavailableException.class, () -> provider.parseSummary(text)).code());
            }
        }
    }
    @Test void missingConfigurationFailsWithoutAnUpstreamCall() {
        try (var provider = new VertexAiProvider(new AiConfig(null, "global", "gemini-2.5-flash", null))) {
            assertEquals("AI_NOT_CONFIGURED", assertThrows(AiUnavailableException.class, () -> provider.summarize(null,"zh-CN")).code());
        }
    }
}
