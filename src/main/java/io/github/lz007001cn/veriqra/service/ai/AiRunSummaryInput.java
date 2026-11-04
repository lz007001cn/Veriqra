package io.github.lz007001cn.veriqra.service.ai;

import java.time.LocalDateTime;
import java.util.List;

/** Bounded evidence from one transaction. Counts cover the complete selected run. */
public record AiRunSummaryInput(Long projectId, Long runId, String runName, String runStatus,
        String environment, String buildVersion, LocalDateTime runCreatedAt, LocalDateTime runEndedAt,
        LocalDateTime capturedAt, Counts counts,
        List<CaseEvidence> cases, int omittedCaseCount, int linkedDefectCount,
        List<DefectEvidence> defects, int omittedDefectCount, boolean detailsTruncated) {
    public AiRunSummaryInput { cases = List.copyOf(cases); defects = List.copyOf(defects); }
    public record Counts(int total, int recorded, int passed, int failed, int blocked, int skipped, int notRun) { }
    public record StepEvidence(Integer stepOrder, String action, String expectedResult) { }
    public record CaseEvidence(Long runCaseId, Long testCaseId, String title, String outcome,
            Integer attemptNo, String description, String preconditions, List<StepEvidence> steps,
            String actualResult, String failureMessage) {
        public CaseEvidence { steps = List.copyOf(steps); }
    }
    public record DefectEvidence(Long defectId, Long keyNo, String title, String status,
            String severity, String resolutionNote, LocalDateTime updatedAt) { }
}
