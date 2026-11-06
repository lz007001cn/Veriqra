package io.github.lz007001cn.veriqra.service.ai;

import io.github.lz007001cn.veriqra.model.*;
import io.github.lz007001cn.veriqra.service.exception.*;
import io.github.lz007001cn.veriqra.service.support.*;
import java.time.*;
import java.util.*;

/** One coherent read snapshot is released before a model request; no analysis operation writes data. */
public final class AiAssistanceService {
    private static final int MAX_CASES = 30, MAX_SOURCE_CASES = 100, MAX_FAILURES = 12, MAX_RETESTS = 3, MAX_STEPS = 12;
    private final ServiceTransaction transactions;
    private final ServiceDaoFactory factory;
    private final ProjectAccessPolicy access;
    private final AiAssistanceProvider provider;
    private final Clock clock;
    public AiAssistanceService(ServiceTransaction transactions, ServiceDaoFactory factory,
            ProjectAccessPolicy access, AiAssistanceProvider provider, Clock clock) {
        this.transactions = Objects.requireNonNull(transactions); this.factory = Objects.requireNonNull(factory);
        this.access = Objects.requireNonNull(access); this.provider = Objects.requireNonNull(provider);
        this.clock = Objects.requireNonNull(clock);
    }
    public AiAssistance.ReviewPreview review(Long actor, Long projectId, Long requirementId, String language) {
        validateRequest(projectId, requirementId, language);
        var input = transactions.execute(c -> {
            var d = factory.create(c); var row = requirement(d, actor, projectId, requirementId);
            return requirementInput(row, new Budget());
        });
        var analysis = provider.review(input, language); validateReview(analysis);
        return new AiAssistance.ReviewPreview(input.requirementId(), input.expectedVersion(), input.capturedAt(), now(), analysis);
    }
    public AiAssistance.CoveragePreview coverage(Long actor, Long projectId, Long requirementId, String language) {
        validateRequest(projectId, requirementId, language);
        var snapshot = transactions.execute(c -> coverageSnapshot(factory.create(c), actor, projectId, requirementId));
        var input = snapshot.input();
        var analysis = provider.coverage(input, language); validateCoverage(analysis);
        return new AiAssistance.CoveragePreview(requirementId, input.requirement().expectedVersion(),
                input.requirement().capturedAt(), now(), input.totalLinkedCases(), input.cases().size(),
                input.truncated(), snapshot.sources(), analysis);
    }
    public AiAssistance.DefectPreview analyzeDefect(Long actor, Long projectId, Long defectId, String language) {
        validateRequest(projectId, defectId, language);
        var input = transactions.execute(c -> defectSnapshot(factory.create(c), actor, projectId, defectId));
        var analysis = provider.analyzeDefect(input, language); validateDefect(analysis);
        return new AiAssistance.DefectPreview(defectId, input.expectedVersion(), input.capturedAt(), now(),
                input.evidenceCount(), input.failures().size(), input.truncated(), analysis);
    }
    private void readable(ServiceDaos d, Long actor, Long projectId) {
        var project = d.projects().findById(projectId).orElseThrow(() -> new NotFoundException("Project does not exist"));
        access.requireProjectRead(d.users(), d.members(), actor, projectId);
        if (project.status() != ProjectStatus.ACTIVE) throw new ConflictException("AI analysis requires an active project");
    }
    private Requirement requirement(ServiceDaos d, Long actor, Long projectId, Long requirementId) {
        readable(d, actor, projectId);
        return d.requirements().findById(requirementId).filter(row -> projectId.equals(row.projectId()))
                .orElseThrow(() -> new NotFoundException("Requirement does not exist in project"));
    }
    private AiAssistance.RequirementInput requirementInput(Requirement row, Budget budget) {
        String title = budget.text(row.title(), 480), description = budget.text(row.description(), 32_000);
        return new AiAssistance.RequirementInput(row.id(), row.lockVersion(), "REQ-" + row.keyNo(), title,
                description, row.priority().name(), row.status().name(), now(), budget.truncated);
    }
    private record CoverageSnapshot(AiAssistance.CoverageInput input, List<AiAssistance.SourceCase> sources) { }
    private CoverageSnapshot coverageSnapshot(ServiceDaos d, Long actor, Long projectId, Long id) {
        var requirement = requirement(d, actor, projectId, id); Budget budget = new Budget();
        var input = requirementInput(requirement, budget);
        var links = d.traceability().listByRequirement(id).stream().filter(row -> row.status() != TraceabilityStatus.REMOVED).toList();
        List<AiAssistance.LinkedCase> included = new ArrayList<>(); List<AiAssistance.SourceCase> sources = new ArrayList<>();
        for (var link : links.stream().limit(MAX_SOURCE_CASES).toList()) {
            TestCase row = d.testCases().findById(link.testCaseId()).filter(value -> projectId.equals(value.projectId()))
                    .orElseThrow(() -> new ConflictException("Linked case does not belong to requirement project"));
            sources.add(new AiAssistance.SourceCase(row.id(), row.lockVersion(), row.status().name(), link.status().name()));
            if (included.size() >= MAX_CASES) continue;
            boolean effective = requirement.status() == RequirementStatus.ACTIVE && row.status() == TestCaseStatus.READY
                    && link.status() == TraceabilityStatus.CONFIRMED;
            String title = budget.text(row.title(), 480), description = budget.text(row.description(), 1000), preconditions = budget.text(row.preconditions(), 1000);
            var allSteps = d.steps().listByTestCase(row.id());
            if (allSteps.size() > MAX_STEPS) budget.truncated = true;
            var steps = allSteps.stream().limit(MAX_STEPS).map(step -> new AiAssistance.Step(step.stepOrder(),
                    budget.text(step.action(), 600), budget.text(step.expectedResult(), 600))).toList();
            included.add(new AiAssistance.LinkedCase(row.id(), row.lockVersion(), "TC-" + row.keyNo(), title,
                    description, preconditions, row.priority().name(), row.status().name(), link.status().name(), effective, steps));
        }
        return new CoverageSnapshot(new AiAssistance.CoverageInput(input, links.size(), included,
                budget.truncated || links.size() > included.size()), List.copyOf(sources));
    }
    private AiAssistance.DefectInput defectSnapshot(ServiceDaos d, Long actor, Long projectId, Long id) {
        readable(d, actor, projectId);
        var defect = d.defects().findById(id).filter(row -> projectId.equals(row.projectId()))
                .orElseThrow(() -> new NotFoundException("Defect does not exist in project"));
        Budget budget = new Budget();
        String title = budget.text(defect.title(), 480), description = budget.text(defect.description(), 4000), resolution = budget.text(defect.resolutionNote(), 4000);
        var all = d.attemptDefects().listAttemptsByDefect(id);
        var retests = d.retestLinks().listByDefect(id);
        List<AiAssistance.FailureEvidence> failures = new ArrayList<>();
        for (var link : all.stream().limit(MAX_FAILURES).toList()) {
            if (!id.equals(link.defectId())) throw new ConflictException("Failure association does not belong to defect");
            var attempt = d.attempts().findById(link.attemptId()).filter(row -> row.status() == TestAttemptStatus.FAIL)
                    .orElseThrow(() -> new ConflictException("Linked FAIL evidence is unavailable"));
            var original = frozen(d, projectId, attempt, budget);
            var latest = d.attempts().findLatestByRunCase(attempt.testRunCaseId()).orElse(attempt);
            if (!attempt.testRunCaseId().equals(latest.testRunCaseId())) throw new ConflictException("Latest result does not belong to source case");
            var selected = retests.stream().filter(row -> link.attemptId().equals(row.failureAttemptId()))
                    .sorted(Comparator.comparing((DefectRetestLink row) -> row.revocation() != null)
                            .thenComparing(DefectRetestLink::id, Comparator.reverseOrder())).toList();
            if (selected.size() > MAX_RETESTS) budget.truncated = true;
            List<AiAssistance.RetestEvidence> followups = new ArrayList<>();
            for (var retest : selected.stream().limit(MAX_RETESTS).toList()) {
                if (!id.equals(retest.defectId())) throw new ConflictException("Retest association does not belong to defect");
                var pass = d.attempts().findById(retest.passAttemptId()).filter(row -> row.status() == TestAttemptStatus.PASS)
                        .orElseThrow(() -> new ConflictException("Linked PASS evidence is unavailable"));
                var latestRetest = d.attempts().findLatestByRunCase(pass.testRunCaseId()).orElse(pass);
                if (!pass.testRunCaseId().equals(latestRetest.testRunCaseId()))
                    throw new ConflictException("Latest retest result does not belong to selected source case");
                var selectedPass = frozen(d, projectId, pass, budget);
                var latestForSelectedCase = latestRetest.id().equals(pass.id()) ? selectedPass : frozen(d, projectId, latestRetest, budget);
                followups.add(new AiAssistance.RetestEvidence(retest.id(), retest.revocation() == null,
                        budget.text(retest.reviewNote(), 1000), retest.timingBasis() == null ? null : retest.timingBasis().name(),
                        retest.linkedAt(), selectedPass, latestForSelectedCase));
            }
            failures.add(new AiAssistance.FailureEvidence(original, latest.id().equals(attempt.id()) ? original : frozen(d, projectId, latest, budget), followups));
        }
        return new AiAssistance.DefectInput(id, defect.lockVersion(), "BUG-" + defect.keyNo(), title, description,
                defect.status().name(), defect.severity().name(), defect.priority().name(), resolution, defect.updatedAt(), now(),
                all.size(), failures, budget.truncated || all.size() > failures.size());
    }
    private AiAssistance.FrozenExecution frozen(ServiceDaos d, Long projectId, TestAttempt attempt, Budget budget) {
        var row = d.runCases().findById(attempt.testRunCaseId()).orElseThrow(() -> new ConflictException("Frozen source case is unavailable"));
        var run = d.testRuns().findById(row.testRunId()).filter(value -> projectId.equals(value.projectId()))
                .orElseThrow(() -> new ConflictException("Evidence does not belong to defect project"));
        var allSteps = d.runCaseSteps().listByRunCase(row.id());
        if (allSteps.size() > MAX_STEPS) budget.truncated = true;
        // Reserve actual result before long frozen definitions consume the shared context budget.
        String actual = budget.text(attempt.comment(), 1500), failure = budget.text(attempt.failureMessage(), 1500);
        String name = budget.text(run.name(), 480), build = budget.text(run.buildVersion(), 480), environment = budget.text(run.environment(), 1000);
        String title = budget.text(row.snapshotTitle(), 480), description = budget.text(row.snapshotDescription(), 1000), preconditions = budget.text(row.snapshotPreconditions(), 1000);
        var steps = allSteps.stream().limit(MAX_STEPS).map(step -> new AiAssistance.Step(step.stepOrder(),
                budget.text(step.action(), 600), budget.text(step.expectedResult(), 600))).toList();
        return new AiAssistance.FrozenExecution(attempt.id(), attempt.attemptNo(), attempt.status().name(),
                attempt.executedAt(), attempt.recordedAt(), run.id(), name, run.status().name(), build, environment,
                row.id(), row.testCaseId(), title, description, preconditions, steps, actual, failure);
    }
    private LocalDateTime now() { return LocalDateTime.now(clock); }
    private static void validateRequest(Long project, Long object, String language) {
        if (project == null || project <= 0 || object == null || object <= 0) throw new ValidationException("Positive project and object IDs are required");
        if (!Set.of("en", "zh-CN").contains(Objects.toString(language, ""))) throw new ValidationException("Unsupported analysis language");
    }
    static void validateReview(AiAssistance.ReviewAnalysis value) {
        if (value == null || !text(value.overview(), 4000) || !items(value.issues(), 8) || !items(value.questions(), 8) || !items(value.acceptanceCriteria(), 12)) invalid();
    }
    static void validateCoverage(AiAssistance.CoverageAnalysis value) {
        if (value == null || !text(value.overview(), 4000) || !items(value.gaps(), 8) || !items(value.duplicates(), 8)) invalid();
        try { AiCaseService.validate(value.candidates(), 0); } catch (ValidationException | NullPointerException e) { invalid(); }
    }
    static void validateDefect(AiAssistance.DefectAnalysis value) {
        if (value == null || !text(value.overview(), 4000) || !items(value.observations(), 8) || !items(value.possibleCauses(), 8)
                || !items(value.missingInformation(), 8) || !items(value.retestSuggestions(), 8)) invalid();
    }
    private static boolean text(String value, int max) { return value != null && !value.isBlank() && value.length() <= max; }
    private static boolean items(List<String> values, int max) { return values != null && values.size() <= max && values.stream().allMatch(value -> text(value, 2000)); }
    private static void invalid() { throw new AiUnavailableException("AI_INVALID_RESPONSE"); }
    private static final class Budget {
        int remaining = 48_000; boolean truncated;
        String text(String value, int max) {
            if (value == null) return "";
            int length = Math.min(value.length(), Math.min(max, remaining));
            if (length > 0 && length < value.length() && Character.isHighSurrogate(value.charAt(length - 1))) length--;
            if (length < value.length()) truncated = true;
            remaining -= length; return value.substring(0, length);
        }
    }
}
