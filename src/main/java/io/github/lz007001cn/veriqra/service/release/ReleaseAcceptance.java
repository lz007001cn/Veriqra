package io.github.lz007001cn.veriqra.service.release;

import io.github.lz007001cn.veriqra.model.DefectSeverity;
import io.github.lz007001cn.veriqra.model.DefectStatus;
import io.github.lz007001cn.veriqra.model.Priority;
import io.github.lz007001cn.veriqra.model.TestRunStatus;
import java.time.LocalDateTime;
import java.util.List;

/** A human verdict and the project evidence saved alongside it. */
public record ReleaseAcceptance(long id, long projectId, String buildVersion, Verdict verdict,
        long reviewerId, String reviewerName, LocalDateTime createdAt, int runCount, int unclosedDefectCount,
        String defectScope, String notes, List<RunEvidence> runs, List<DefectEvidence> unclosedDefects) {
    public static final String ALL_PROJECT_UNCLOSED = "ALL_PROJECT_UNCLOSED_AT_CAPTURE";

    public ReleaseAcceptance {
        runs = List.copyOf(runs);
        unclosedDefects = List.copyOf(unclosedDefects);
    }

    public enum Verdict { APPROVED, REJECTED }
    public enum Outcome { PASS, FAIL, BLOCKED, SKIPPED, NOT_RUN, INCOMPLETE }

    public record Summary(long id, long projectId, String buildVersion, Verdict verdict, long reviewerId,
            String reviewerName, LocalDateTime createdAt, int runCount, int unclosedDefectCount, String defectScope) { }

    public record RunEvidence(long id, String name, String buildVersion, String environment, TestRunStatus status,
            LocalDateTime endedAt, Outcome outcome, Counts counts) { }

    public record Counts(long total, long recorded, long passed, long failed, long blocked, long skipped, long notRun) {
        Outcome outcome() {
            if (failed > 0) return Outcome.FAIL;
            if (blocked > 0) return Outcome.BLOCKED;
            if (recorded == 0) return Outcome.NOT_RUN;
            if (notRun > 0 || skipped > 0 && passed > 0) return Outcome.INCOMPLETE;
            return skipped > 0 ? Outcome.SKIPPED : Outcome.PASS;
        }
    }

    public record DefectEvidence(long id, long keyNo, String title, DefectSeverity severity, Priority priority,
            DefectStatus status) { }
}
