package io.github.lz007001cn.veriqra.service.ai;

import java.time.LocalDateTime;
import java.util.List;

/** Read-only evidence and structured suggestions. None of these records declares business approval. */
public final class AiAssistance {
    private AiAssistance() { }
    public record RequirementInput(Long requirementId, Integer expectedVersion, String number, String title,
            String description, String priority, String status, LocalDateTime capturedAt, boolean truncated) { }
    public record ReviewAnalysis(String overview, List<String> issues, List<String> questions, List<String> acceptanceCriteria) { }
    public record ReviewPreview(Long requirementId, Integer expectedVersion, LocalDateTime capturedAt,
            LocalDateTime generatedAt, ReviewAnalysis analysis) { }
    public record SourceCase(Long id, Integer version, String status, String linkStatus) { }
    public record Step(Integer stepOrder, String action, String expectedResult) { }
    public record LinkedCase(Long id, Integer version, String number, String title, String description,
            String preconditions, String priority, String status, String linkStatus, boolean effectiveCoverage,
            List<Step> steps) { public LinkedCase { steps = List.copyOf(steps); } }
    public record CoverageInput(RequirementInput requirement, int totalLinkedCases, List<LinkedCase> cases,
            boolean truncated) { public CoverageInput { cases = List.copyOf(cases); } }
    public record CoverageAnalysis(String overview, List<String> gaps, List<String> duplicates, List<AiCandidate> candidates) { }
    public record CoveragePreview(Long requirementId, Integer expectedVersion, LocalDateTime capturedAt,
            LocalDateTime generatedAt, int totalLinkedCases, int includedCases, boolean truncated,
            List<SourceCase> sourceCases, CoverageAnalysis analysis) {
        public CoveragePreview { sourceCases = List.copyOf(sourceCases); }
    }
    public record FrozenExecution(Long attemptId, Integer attemptNo, String outcome, LocalDateTime executedAt,
            LocalDateTime recordedAt, Long runId, String runName, String runStatus, String buildVersion,
            String environment, Long runCaseId, Long testCaseId, String title, String description,
            String preconditions, List<Step> steps, String actualResult, String failureMessage) {
        public FrozenExecution { steps = List.copyOf(steps); }
    }
    public record RetestEvidence(Long linkId, boolean active, String reviewNote, String timingBasis,
            LocalDateTime linkedAt, FrozenExecution selectedPass, FrozenExecution latestForSelectedCase) { }
    public record FailureEvidence(FrozenExecution failure, FrozenExecution latestForOriginalCase,
            List<RetestEvidence> retests) { public FailureEvidence { retests = List.copyOf(retests); } }
    public record DefectInput(Long defectId, Integer expectedVersion, String number, String title,
            String description, String status, String severity, String priority, String resolutionNote,
            LocalDateTime updatedAt, LocalDateTime capturedAt, int evidenceCount,
            List<FailureEvidence> failures, boolean truncated) {
        public DefectInput { failures = List.copyOf(failures); }
    }
    public record DefectAnalysis(String overview, List<String> observations, List<String> possibleCauses,
            List<String> missingInformation, List<String> retestSuggestions) { }
    public record DefectPreview(Long defectId, Integer expectedVersion, LocalDateTime capturedAt,
            LocalDateTime generatedAt, int evidenceCount, int includedEvidenceCount, boolean truncated,
            DefectAnalysis analysis) { }
}
