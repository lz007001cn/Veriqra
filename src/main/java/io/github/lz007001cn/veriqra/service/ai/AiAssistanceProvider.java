package io.github.lz007001cn.veriqra.service.ai;

public interface AiAssistanceProvider {
    AiAssistance.ReviewAnalysis review(AiAssistance.RequirementInput input, String language);
    AiAssistance.CoverageAnalysis coverage(AiAssistance.CoverageInput input, String language);
    AiAssistance.DefectAnalysis analyzeDefect(AiAssistance.DefectInput input, String language);
}
