package io.github.lz007001cn.veriqra.service.ai;

import io.github.lz007001cn.veriqra.config.AiConfig;
import java.util.*;
import org.junit.jupiter.api.Test;
import static org.junit.jupiter.api.Assertions.*;

class VertexAiAssistanceTest {
    VertexAiProvider provider() { return new VertexAiProvider(new AiConfig(null, "global", "gemini-2.5-flash", null)); }
    @Test void parsesIndependentReviewListsAndAllowsNoIssuesWithoutInventingThem() {
        try (var p = provider()) {
            var result = p.parseReview("{\"overview\":\"清晰但缺少错误场景。\",\"issues\":[],\"questions\":[\"错误提示是什么？\"],\"acceptanceCriteria\":[\"无效输入显示提示。\"]}");
            assertTrue(result.issues().isEmpty()); assertEquals(1, result.acceptanceCriteria().size());
        }
    }
    @Test void coverageAllowsZeroOrOneSupplementalCandidateUnlikeTheOriginalGenerationMinimumOfThree() {
        try (var p = provider()) {
            assertTrue(p.parseCoverage("{\"overview\":\"No grounded addition\",\"gaps\":[],\"duplicates\":[],\"candidates\":[]}").candidates().isEmpty());
            String row = "{\"title\":\"Empty cache\",\"description\":\"Boundary\",\"preconditions\":\"Cache empty\",\"priority\":\"HIGH\",\"steps\":[{\"action\":\"Switch server\",\"expectedResult\":\"Switch completes\"}]}";
            var result = p.parseCoverage("{\"overview\":\"Missing boundary\",\"gaps\":[\"Empty cache\"],\"duplicates\":[],\"candidates\":[" + row + "]}");
            assertEquals(1, result.candidates().size()); assertEquals(1, result.candidates().getFirst().steps().getFirst().stepOrder());
            assertEquals("AI_INVALID_RESPONSE", assertThrows(AiUnavailableException.class, () -> p.parseCoverage("{\"overview\":\"x\",\"gaps\":[],\"duplicates\":[],\"candidates\":[" + String.join(",", Collections.nCopies(6, row)) + "]}")).code());
        }
    }
    @Test void rejectsMalformedMissingOversizedAndWrongTypeModelOutput() {
        try (var p = provider()) {
            for (String invalid : List.of("{}", "[]", "null", "not json", "{\"overview\":\"x\",\"issues\":[3],\"questions\":[],\"acceptanceCriteria\":[]}",
                    "{\"overview\":\"x\",\"issues\":[],\"questions\":[\"\"],\"acceptanceCriteria\":[]}",
                    "{\"overview\":\"" + "x".repeat(4001) + "\",\"issues\":[],\"questions\":[],\"acceptanceCriteria\":[]}"))
                assertEquals("AI_INVALID_RESPONSE", assertThrows(AiUnavailableException.class, () -> p.parseReview(invalid)).code());
            assertEquals("AI_INVALID_RESPONSE", assertThrows(AiUnavailableException.class, () -> p.parseCoverage("{\"overview\":\"x\",\"gaps\":[],\"duplicates\":[],\"candidates\":null}")).code());
            assertEquals("AI_INVALID_RESPONSE", assertThrows(AiUnavailableException.class, () -> p.parseDefectAnalysis("{\"overview\":\"x\",\"observations\":[],\"possibleCauses\":{},\"missingInformation\":[],\"retestSuggestions\":[]}")).code());
        }
    }
    @Test void defectAnalysisSeparatesObservedFactsFromHypothesesAndNoMissingDataCanBeAnEmptyList() {
        try (var p = provider()) {
            var value = p.parseDefectAnalysis("{\"overview\":\"Historical FAIL; currently closed\",\"observations\":[\"Later PASS recorded\"],\"possibleCauses\":[],\"missingInformation\":[],\"retestSuggestions\":[\"Review existing evidence\"]}");
            assertEquals(1, value.observations().size()); assertTrue(value.possibleCauses().isEmpty());
        }
    }
    @Test void allThreeOperationsFailAsUnconfiguredWithoutTransport() {
        try (var p = provider()) {
            assertEquals("AI_NOT_CONFIGURED", assertThrows(AiUnavailableException.class, () -> p.review(null, "en")).code());
            assertEquals("AI_NOT_CONFIGURED", assertThrows(AiUnavailableException.class, () -> p.coverage(null, "en")).code());
            assertEquals("AI_NOT_CONFIGURED", assertThrows(AiUnavailableException.class, () -> p.analyzeDefect(null, "en")).code());
        }
    }
}
