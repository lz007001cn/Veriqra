package io.github.lz007001cn.veriqra.web.dto;

import io.github.lz007001cn.veriqra.model.*;
import io.github.lz007001cn.veriqra.service.importing.ImportExecutionResult;
import java.time.LocalDateTime;
import java.util.*;
import java.util.HexFormat;

public record ImportExecutionResponse(ImportRecordResponse testImport, RunResponse run,
                                      List<ImportedRunCaseResponse> runCases,
                                      List<ImportedAttemptResponse> attempts, boolean replayed) {
    public static ImportExecutionResponse from(ImportExecutionResult value) {
        return new ImportExecutionResponse(ImportRecordResponse.from(value.testImport()),
                RunResponse.from(value.testRun()), value.runCases().stream().map(ImportedRunCaseResponse::from).toList(),
                value.attempts().stream().map(ImportedAttemptResponse::from).toList(), value.replayed());
    }

    public record ImportRecordResponse(Long id, Long testRunId, UUID requestKey, String reportSha256,
                                       String sourceNamespace, String originalFilename, Long importedBy,
                                       LocalDateTime importedAt) {
        public static ImportRecordResponse from(TestImport value) {
            return new ImportRecordResponse(value.id(), value.testRunId(), value.requestKey(),
                    HexFormat.of().formatHex(value.reportSha256()), value.sourceNamespace(), value.originalFilename(),
                    value.importedBy(), value.importedAt());
        }
    }

    public record ImportedRunCaseResponse(Long id, Long testRunId, Long testCaseId, String title,
                                          String description, String preconditions, Priority priority,
                                          LocalDateTime capturedAt) {
        static ImportedRunCaseResponse from(TestRunCase value) {
            return new ImportedRunCaseResponse(value.id(), value.testRunId(), value.testCaseId(),
                    value.snapshotTitle(), value.snapshotDescription(), value.snapshotPreconditions(),
                    value.snapshotPriority(), value.capturedAt());
        }
    }

    public record ImportedAttemptResponse(Long id, Long runCaseId, Integer attemptNo, TestAttemptStatus outcome,
                                          Long executedBy, Long importId, Long automationMappingId,
                                          LocalDateTime executedAt, LocalDateTime recordedAt, Long durationMs,
                                          String comment, String failureMessage, UUID submissionKey) {
        static ImportedAttemptResponse from(TestAttempt value) {
            return new ImportedAttemptResponse(value.id(), value.testRunCaseId(), value.attemptNo(), value.status(),
                    value.executedBy(), value.importId(), value.automationMappingId(), value.executedAt(),
                    value.recordedAt(), value.durationMs(), value.comment(), value.failureMessage(),
                    value.submissionKey());
        }
    }
}
