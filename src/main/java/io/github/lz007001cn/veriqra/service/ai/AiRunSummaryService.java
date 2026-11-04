package io.github.lz007001cn.veriqra.service.ai;

import io.github.lz007001cn.veriqra.model.*;
import io.github.lz007001cn.veriqra.service.exception.*;
import io.github.lz007001cn.veriqra.service.support.*;
import java.time.*;
import java.util.*;

/** Read-only report generation. Model latency never holds the database transaction open. */
public final class AiRunSummaryService {
    private static final int MAX_CASES = 40, MAX_DEFECTS = 20, TEXT_BUDGET = 32_000;
    private final ServiceTransaction transactions;
    private final ServiceDaoFactory factory;
    private final ProjectAccessPolicy access;
    private final AiRunSummaryProvider provider;
    private final Clock clock;

    public AiRunSummaryService(ServiceTransaction transactions, ServiceDaoFactory factory,
            ProjectAccessPolicy access, AiRunSummaryProvider provider, Clock clock) {
        this.transactions = Objects.requireNonNull(transactions);
        this.factory = Objects.requireNonNull(factory); this.access = Objects.requireNonNull(access);
        this.provider = Objects.requireNonNull(provider); this.clock = Objects.requireNonNull(clock);
    }

    public AiRunSummaryPreview generate(Long actor, Long projectId, Long runId, String language) {
        if (projectId == null || projectId <= 0 || runId == null || runId <= 0)
            throw new ValidationException("Project and run IDs are required");
        if (language == null || !Set.of("zh-CN", "en").contains(language))
            throw new ValidationException("Unsupported summary language");
        AiRunSummaryInput input = transactions.execute(c -> snapshot(factory.create(c), actor, projectId, runId));
        AiRunSummaryAnalysis result = provider.summarize(input, language);
        validateAnalysis(result);
        return new AiRunSummaryPreview(input, result, LocalDateTime.now(clock));
    }

    private AiRunSummaryInput snapshot(ServiceDaos d, Long actor, Long projectId, Long runId) {
        d.projects().findById(projectId).orElseThrow(() -> new NotFoundException("Project does not exist"));
        access.requireProjectRead(d.users(), d.members(), actor, projectId);
        TestRun run = d.testRuns().findById(runId).filter(r -> projectId.equals(r.projectId()))
                .orElseThrow(() -> new NotFoundException("Run does not exist in project"));
        List<CaseState> all = d.runCases().listByRun(runId).stream()
                .map(row -> new CaseState(row, d.attempts().findLatestByRunCase(row.id()).orElse(null))).toList();
        int passed = 0, failed = 0, blocked = 0, skipped = 0, notRun = 0;
        for (CaseState row : all) switch (row.outcome()) {
            case "PASS" -> passed++; case "FAIL" -> failed++; case "BLOCKED" -> blocked++;
            case "SKIPPED" -> skipped++; default -> notRun++;
        }
        var counts = new AiRunSummaryInput.Counts(all.size(), all.size() - notRun,
                passed, failed, blocked, skipped, notRun);
        List<CaseState> selected = all.stream().sorted(Comparator.comparingInt((CaseState c) -> priority(c.outcome()))
                .thenComparing(c -> c.row().id())).limit(MAX_CASES).toList();
        List<Long> defectIds = new ArrayList<>(new LinkedHashSet<>(d.attemptDefects().listDefectIdsByRun(runId)));
        List<Defect> defects = defectIds.stream().limit(MAX_DEFECTS).map(id -> d.defects().findById(id)
                .filter(row -> projectId.equals(row.projectId()))
                .orElseThrow(() -> new ConflictException("Linked defect does not belong to run project"))).toList();
        Budget budget = new Budget();
        String runName = budget.text(run.name(), 240), environment = budget.text(run.environment(), 500), build = budget.text(run.buildVersion(), 240);
        // Reserve identity/title space before optional long notes can consume the shared budget.
        Map<Long, String> titles = new HashMap<>(), defectTitles = new HashMap<>();
        selected.forEach(row -> titles.put(row.row().id(), budget.text(row.row().snapshotTitle(), 240)));
        defects.forEach(row -> defectTitles.put(row.id(), budget.text(row.title(), 240)));
        List<AiRunSummaryInput.DefectEvidence> defectEvidence = defects.stream().map(row ->
                new AiRunSummaryInput.DefectEvidence(row.id(), row.keyNo(), defectTitles.get(row.id()),
                        row.status().name(), row.severity().name(), budget.text(row.resolutionNote(), 800), row.updatedAt())).toList();
        List<AiRunSummaryInput.CaseEvidence> evidence = new ArrayList<>();
        for (CaseState item : selected) {
            TestRunCase row = item.row(); TestAttempt attempt = item.latest();
            String actual = budget.text(attempt == null ? null : attempt.comment(), 1000);
            String failure = budget.text(attempt == null ? null : attempt.failureMessage(), 1000);
            String description = budget.text(row.snapshotDescription(), 500), preconditions = budget.text(row.snapshotPreconditions(), 500);
            List<TestRunCaseStep> steps = d.runCaseSteps().listByRunCase(row.id());
            if (steps.size() > 8) budget.truncated = true;
            List<AiRunSummaryInput.StepEvidence> stepEvidence = steps.stream().limit(8).map(step ->
                    new AiRunSummaryInput.StepEvidence(step.stepOrder(), budget.text(step.action(), 240),
                            budget.text(step.expectedResult(), 240))).toList();
            evidence.add(new AiRunSummaryInput.CaseEvidence(row.id(), row.testCaseId(), titles.get(row.id()),
                    item.outcome(), attempt == null ? null : attempt.attemptNo(), description, preconditions,
                    stepEvidence, actual, failure));
        }
        return new AiRunSummaryInput(projectId, runId, runName, run.status().name(), environment, build,
                run.createdAt(), run.endedAt(), LocalDateTime.now(clock), counts, evidence, all.size() - evidence.size(), defectIds.size(),
                defectEvidence, defectIds.size() - defectEvidence.size(), budget.truncated);
    }

    private record CaseState(TestRunCase row, TestAttempt latest) {
        String outcome() { return latest == null ? "NOT_RUN" : latest.status().name(); }
    }
    private static int priority(String outcome) {
        return switch (outcome) { case "FAIL" -> 0; case "BLOCKED" -> 1; case "NOT_RUN" -> 2; case "SKIPPED" -> 3; default -> 4; };
    }
    private static final class Budget {
        int remaining = TEXT_BUDGET; boolean truncated;
        String text(String value, int max) {
            if (value == null) return "";
            int length = Math.min(value.length(), Math.min(max, remaining));
            if (length > 0 && length < value.length() && Character.isHighSurrogate(value.charAt(length - 1))) length--;
            if (length < value.length()) truncated = true;
            remaining -= length; return value.substring(0, length);
        }
    }
    static void validateAnalysis(AiRunSummaryAnalysis value) {
        if (value == null || !validText(value.overview(), 4000) || !validList(value.findings()) || !validList(value.recommendations()))
            throw new AiUnavailableException("AI_INVALID_RESPONSE");
    }
    private static boolean validText(String value, int max) { return value != null && !value.isBlank() && value.length() <= max; }
    private static boolean validList(List<String> values) {
        return values != null && values.size() <= 8 && values.stream().allMatch(value -> validText(value, 2000));
    }
}
