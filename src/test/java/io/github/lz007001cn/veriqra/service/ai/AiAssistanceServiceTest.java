package io.github.lz007001cn.veriqra.service.ai;

import io.github.lz007001cn.veriqra.model.*;
import io.github.lz007001cn.veriqra.service.exception.*;
import io.github.lz007001cn.veriqra.service.support.*;
import java.lang.reflect.Proxy;
import java.time.*;
import java.util.*;
import org.junit.jupiter.api.Test;
import static org.junit.jupiter.api.Assertions.*;

class AiAssistanceServiceTest {
    static final LocalDateTime NOW = LocalDateTime.of(2026, 11, 5, 1, 0);
    static class Fixture implements AiAssistanceProvider {
        boolean inTransaction, disabled, inactive, archived, missingProject;
        long requirementProject = 7, defectProject = 7, evidenceProject = 7;
        int modelCalls, stepReads;
        RequirementStatus requirementStatus = RequirementStatus.ACTIVE;
        DefectStatus defectStatus = DefectStatus.CLOSED;
        String requirementDescription = "Choose an empty cache and switch the server";
        final List<TestCaseRequirement> links = new ArrayList<>();
        final Map<Long, TestCase> cases = new HashMap<>();
        final List<TestAttemptDefect> failures = new ArrayList<>();
        final Map<Long, TestAttempt> attempts = new HashMap<>();
        final Map<Long, TestAttempt> latestOverrides = new HashMap<>();
        final List<DefectRetestLink> retests = new ArrayList<>();
        final Clock clock = Clock.fixed(NOW.toInstant(ZoneOffset.UTC), ZoneOffset.UTC);
        AiAssistance.RequirementInput reviewInput;
        AiAssistance.CoverageInput coverageInput;
        AiAssistance.DefectInput defectInput;
        AiAssistance.ReviewAnalysis reviewAnswer = new AiAssistance.ReviewAnalysis("Review", List.of("Undefined cache state"), List.of("Which server?"), List.of("Switch completes"));
        AiAssistance.CoverageAnalysis coverageAnswer = new AiAssistance.CoverageAnalysis("Coverage", List.of("Empty cache"), List.of(), List.of());
        AiAssistance.DefectAnalysis defectAnswer = new AiAssistance.DefectAnalysis("Historical failure, already closed", List.of("Original FAIL is retained"), List.of(), List.of(), List.of("Review the recorded PASS"));
        final ServiceTransaction tx = new ServiceTransaction() {
            public <T> T execute(Work<T> work) {
                assertFalse(inTransaction); inTransaction = true;
                try { return work.execute(null); } finally { inTransaction = false; }
            }
        };
        AiAssistanceService service() { return new AiAssistanceService(tx, c -> daos(), new ProjectAccessPolicy(), this, clock); }
        public AiAssistance.ReviewAnalysis review(AiAssistance.RequirementInput input, String language) { outside(); reviewInput = input; return reviewAnswer; }
        public AiAssistance.CoverageAnalysis coverage(AiAssistance.CoverageInput input, String language) { outside(); coverageInput = input; return coverageAnswer; }
        public AiAssistance.DefectAnalysis analyzeDefect(AiAssistance.DefectInput input, String language) { outside(); defectInput = input; return defectAnswer; }
        void outside() { assertFalse(inTransaction, "Model latency must not hold a database connection"); modelCalls++; }
        void addCase(long id, TestCaseStatus status, TraceabilityStatus linkStatus) {
            links.add(new TestCaseRequirement(10L, id, linkStatus, 1L, NOW, null, null, NOW));
            cases.put(id, new TestCase(id, 7L, id, "Case " + id, "Description", "Cache empty", Priority.HIGH, status, 1L, NOW, NOW, 4));
        }
        void addFailure(long id) {
            failures.add(new TestAttemptDefect(id, 20L, 1L, NOW)); attempts.put(id, attempt(id, TestAttemptStatus.FAIL));
        }
        TestAttempt attempt(long id, TestAttemptStatus outcome) {
            return new TestAttempt(id, id == 201 ? 41L : 40L, 1, outcome, 1L, null, null, NOW.minusHours(id == 201 ? 1 : 2), NOW.minusHours(1), null,
                    outcome == TestAttemptStatus.PASS ? "Later repair verified" : "Button remains disabled", outcome == TestAttemptStatus.FAIL ? "Empty cache rejected" : null, UUID.randomUUID());
        }
        Object answer(String dao, String method, Object[] args) {
            assertTrue(inTransaction, "All evidence must share the read snapshot");
            return switch (dao + "." + method) {
                case "projects.findById" -> missingProject ? Optional.empty() : Optional.of(new Project(7L, "AI", "AI course project", null, archived ? ProjectStatus.ARCHIVED : ProjectStatus.ACTIVE, 1L, NOW, NOW, 1));
                case "users.findById" -> Optional.of(new User(1L, "developer", "Developer", "unused", SystemRole.USER, disabled ? UserStatus.DISABLED : UserStatus.ACTIVE, NOW, NOW, 1));
                case "members.find" -> Optional.of(new ProjectMember(7L, 1L, ProjectRole.DEVELOPER, inactive ? MembershipStatus.INACTIVE : MembershipStatus.ACTIVE, NOW, NOW, 1));
                case "requirements.findById" -> Optional.of(new Requirement(10L, requirementProject, 2L, "【演示模拟】空缓存切服", requirementDescription, Priority.HIGH, requirementStatus, 1L, NOW, NOW, 3));
                case "traceability.listByRequirement" -> List.copyOf(links);
                case "testCases.findById" -> Optional.ofNullable(cases.get(args[0]));
                case "steps.listByTestCase" -> { stepReads++; yield List.of(new TestStep((Long) args[0], 1, "Select server", "Switch completes")); }
                case "defects.findById" -> Optional.of(new Defect(20L, defectProject, 3L, "【演示模拟】空缓存拒绝切服", "Recorded issue", DefectSeverity.HIGH, Priority.HIGH, defectStatus, 1L, 2L, "Fixed and retested in a later build", NOW, NOW, 6));
                case "attemptDefects.listAttemptsByDefect" -> List.copyOf(failures);
                case "retestLinks.listByDefect" -> List.copyOf(retests);
                case "attempts.findById" -> Optional.ofNullable(attempts.get(args[0]));
                case "attempts.findLatestByRunCase" -> Optional.ofNullable(latestOverrides.get(args[0]))
                        .or(() -> attempts.values().stream().filter(row -> row.testRunCaseId().equals(args[0]))
                                .max(Comparator.comparing(TestAttempt::attemptNo).thenComparing(TestAttempt::id)));
                case "runCases.findById" -> Optional.of(new TestRunCase((Long) args[0], (Long) args[0] == 41 ? 31L : 30L, 100L, "Frozen empty cache switch", "Frozen definition", "Frozen precondition", Priority.HIGH, NOW.minusDays(1)));
                case "testRuns.findById" -> Optional.of(new TestRun((Long) args[0], evidenceProject, null, "【演示模拟】" + ((Long) args[0] == 31 ? "修复版复测" : "修复前回归"), "Windows 11", (Long) args[0] == 31 ? "v1.4.1" : "v1.4.0", TestRunStatus.COMPLETED, NOW.minusHours(1), 1L, NOW.minusDays(1), NOW, 1));
                case "runCaseSteps.listByRunCase" -> List.of(new TestRunCaseStep((Long) args[0], 1, "Frozen switch action", "Frozen switch expected"));
                default -> throw new AssertionError("Unexpected read or write: " + dao + "." + method);
            };
        }
        ServiceDaos daos() {
            try {
                var components = ServiceDaos.class.getRecordComponents();
                var types = Arrays.stream(components).map(c -> c.getType()).toArray(Class<?>[]::new);
                Object[] values = new Object[components.length];
                for (int i = 0; i < values.length; i++) {
                    String name = components[i].getName();
                    values[i] = Proxy.newProxyInstance(getClass().getClassLoader(), new Class<?>[]{types[i]}, (p, m, a) -> answer(name, m.getName(), a));
                }
                return ServiceDaos.class.getDeclaredConstructor(types).newInstance(values);
            } catch (ReflectiveOperationException e) { throw new AssertionError(e); }
        }
    }
    @Test void activeDeveloperCanReviewWithoutWritePermissionAndReceivesServerVersionsAndTimes() {
        var f = new Fixture(); var value = f.service().review(1L, 7L, 10L, "zh-CN");
        assertEquals(10L, value.requirementId()); assertEquals(3, value.expectedVersion());
        assertEquals(NOW, value.capturedAt()); assertEquals(NOW, value.generatedAt());
        assertEquals("【演示模拟】空缓存切服", f.reviewInput.title()); assertEquals(1, f.modelCalls);
    }
    @Test void validatesRequestPermissionsAndOwnershipBeforeModelRequests() {
        var f = new Fixture(); var s = f.service();
        assertThrows(ValidationException.class, () -> s.review(1L, 7L, 10L, "fr"));
        assertThrows(ValidationException.class, () -> s.coverage(1L, 7L, -1L, "en"));
        assertThrows(ValidationException.class, () -> s.analyzeDefect(1L, null, 20L, null));
        f.requirementProject = 8; assertThrows(NotFoundException.class, () -> s.review(1L, 7L, 10L, "en"));
        f.defectProject = 8; assertThrows(NotFoundException.class, () -> s.analyzeDefect(1L, 7L, 20L, "en"));
        f.disabled = true; assertThrows(ForbiddenException.class, () -> s.coverage(1L, 7L, 10L, "en"));
        f.disabled = false; f.inactive = true; assertThrows(ForbiddenException.class, () -> s.review(1L, 7L, 10L, "en"));
        f.inactive = false; f.archived = true; assertThrows(ConflictException.class, () -> s.analyzeDefect(1L, 7L, 20L, "en"));
        assertEquals(0, f.modelCalls);
    }
    @Test void coverageExcludesRemovedLinksAndDistinguishesPendingDraftFromEffectiveCoverage() {
        var f = new Fixture(); f.addCase(100, TestCaseStatus.READY, TraceabilityStatus.CONFIRMED);
        f.addCase(101, TestCaseStatus.DRAFT, TraceabilityStatus.NEEDS_REVIEW); f.addCase(102, TestCaseStatus.READY, TraceabilityStatus.REMOVED);
        var preview = f.service().coverage(1L, 7L, 10L, "en");
        assertEquals(2, preview.totalLinkedCases()); assertEquals(2, preview.includedCases()); assertFalse(preview.truncated());
        assertEquals(List.of(100L, 101L), preview.sourceCases().stream().map(AiAssistance.SourceCase::id).toList());
        assertEquals(4, preview.sourceCases().getFirst().version()); assertEquals("NEEDS_REVIEW", preview.sourceCases().getLast().linkStatus());
        assertTrue(f.coverageInput.cases().getFirst().effectiveCoverage()); assertFalse(f.coverageInput.cases().getLast().effectiveCoverage());
        assertEquals("Select server", f.coverageInput.cases().getFirst().steps().getFirst().action());
        f.requirementStatus = RequirementStatus.DRAFT; f.service().coverage(1L, 7L, 10L, "en");
        assertFalse(f.coverageInput.cases().getFirst().effectiveCoverage());
    }
    @Test void coveragePreservesActualTotalsAndSourceVersionsWhileLimitingExpensiveDetailReads() {
        var f = new Fixture(); for (long i = 100; i < 205; i++) f.addCase(i, TestCaseStatus.READY, TraceabilityStatus.CONFIRMED);
        var preview = f.service().coverage(1L, 7L, 10L, "en");
        assertEquals(105, preview.totalLinkedCases()); assertEquals(30, preview.includedCases());
        assertEquals(100, preview.sourceCases().size()); assertEquals(30, f.stepReads); assertTrue(preview.truncated());
    }
    @Test void crossProjectCoverageAndFailureEvidenceDoNotReachModel() {
        var f = new Fixture(); f.addCase(100, TestCaseStatus.READY, TraceabilityStatus.CONFIRMED);
        var row = f.cases.get(100L); f.cases.put(100L, new TestCase(row.id(), 8L, row.keyNo(), row.title(), row.description(), row.preconditions(), row.priority(), row.status(), row.createdBy(), row.createdAt(), row.updatedAt(), row.lockVersion()));
        assertThrows(ConflictException.class, () -> f.service().coverage(1L, 7L, 10L, "en"));
        f.addFailure(100); f.evidenceProject = 8;
        assertThrows(ConflictException.class, () -> f.service().analyzeDefect(1L, 7L, 20L, "en")); assertEquals(0, f.modelCalls);
    }
    @Test void defectInputUsesFrozenFailureAndLaterSelectedRetestWithClosedStatusAndResolution() {
        var f = new Fixture(); f.addFailure(100); f.attempts.put(201L, f.attempt(201, TestAttemptStatus.PASS));
        f.retests.add(new DefectRetestLink(1L, 20L, 100L, 201L, DefectRetestLink.POLICY, 1L, NOW, "Verified later repair", DefectRetestTimingBasis.MANUAL_SERVER_RECORD, null, null, 6, null));
        var result = f.service().analyzeDefect(1L, 7L, 20L, "zh-CN");
        assertEquals(6, result.expectedVersion()); assertEquals(1, result.evidenceCount()); assertFalse(result.truncated());
        assertEquals("CLOSED", f.defectInput.status()); assertEquals("Fixed and retested in a later build", f.defectInput.resolutionNote());
        var evidence = f.defectInput.failures().getFirst(); assertEquals("FAIL", evidence.failure().outcome());
        assertEquals("Frozen switch action", evidence.failure().steps().getFirst().action());
        assertEquals("v1.4.0", evidence.failure().buildVersion()); assertEquals("Windows 11", evidence.failure().environment());
        assertTrue(evidence.retests().getFirst().active()); assertEquals("PASS", evidence.retests().getFirst().selectedPass().outcome());
        assertEquals("v1.4.1", evidence.retests().getFirst().selectedPass().buildVersion());
        assertEquals(201L, evidence.retests().getFirst().latestForSelectedCase().attemptId());
    }
    @Test void selectedHistoricalPassIncludesLaterFailureOrBlockOnItsOwnDifferentRunCase() {
        for (var outcome : List.of(TestAttemptStatus.FAIL, TestAttemptStatus.BLOCKED)) {
            var f = new Fixture(); f.addFailure(100); f.attempts.put(201L, f.attempt(201, TestAttemptStatus.PASS));
            f.retests.add(new DefectRetestLink(1L, 20L, 100L, 201L, DefectRetestLink.POLICY, 1L, NOW.minusMinutes(30), "Earlier repair verified", DefectRetestTimingBasis.MANUAL_SERVER_RECORD, null, null, 6, null));
            var latest = new TestAttempt(202L, 41L, 2, outcome, 1L, null, null, NOW, NOW, null,
                    "Later result supersedes selected PASS", outcome == TestAttemptStatus.FAIL ? "Switch fails again" : null, UUID.randomUUID());
            f.attempts.put(202L, latest);
            f.service().analyzeDefect(1L, 7L, 20L, "en");
            var failure = f.defectInput.failures().getFirst(); var retest = failure.retests().getFirst();
            assertEquals(30L, failure.failure().runId()); assertEquals(31L, retest.selectedPass().runId());
            assertTrue(retest.active(), "An unrevoked association is not a declaration that its historical PASS is still latest");
            assertEquals("PASS", retest.selectedPass().outcome()); assertEquals(201L, retest.selectedPass().attemptId());
            assertEquals(outcome.name(), retest.latestForSelectedCase().outcome());
            assertEquals(202L, retest.latestForSelectedCase().attemptId()); assertEquals(31L, retest.latestForSelectedCase().runId());
            assertEquals(100L, failure.latestForOriginalCase().attemptId());
        }
    }
    @Test void mismatchedLatestRetestOwnershipCannotBeSentToTheModel() {
        var f = new Fixture(); f.addFailure(100); f.attempts.put(201L, f.attempt(201, TestAttemptStatus.PASS));
        f.retests.add(new DefectRetestLink(1L, 20L, 100L, 201L, DefectRetestLink.POLICY, 1L, NOW, "Review", DefectRetestTimingBasis.MANUAL_SERVER_RECORD, null, null, 6, null));
        f.latestOverrides.put(41L, new TestAttempt(202L, 99L, 2, TestAttemptStatus.FAIL, 1L, null, null, NOW, NOW, null, "Wrong frozen case", "Failure", UUID.randomUUID()));
        assertThrows(ConflictException.class, () -> f.service().analyzeDefect(1L, 7L, 20L, "en")); assertEquals(0, f.modelCalls);
    }
    @Test void oversizedContextIsMarkedAndEvidenceCountsAreNotReplacedByPromptLimits() {
        var f = new Fixture(); f.requirementDescription = "X".repeat(50_000);
        f.addCase(100, TestCaseStatus.DRAFT, TraceabilityStatus.NEEDS_REVIEW);
        assertTrue(f.service().coverage(1L, 7L, 10L, "en").truncated());
        assertEquals(32_000, f.coverageInput.requirement().description().length());
        for (long i = 100; i < 114; i++) f.addFailure(i);
        var preview = f.service().analyzeDefect(1L, 7L, 20L, "en");
        assertEquals(14, preview.evidenceCount()); assertEquals(12, preview.includedEvidenceCount()); assertTrue(preview.truncated());
    }
    @Test void malformedProviderResultsAreMappedToConsistentAiErrorsAndNoApprovalIsPersisted() {
        var f = new Fixture(); f.reviewAnswer = new AiAssistance.ReviewAnalysis("", List.of(), List.of(), List.of());
        assertEquals("AI_INVALID_RESPONSE", assertThrows(AiUnavailableException.class, () -> f.service().review(1L, 7L, 10L, "en")).code());
        f.coverageAnswer = new AiAssistance.CoverageAnalysis("Coverage", List.of(), List.of(), null);
        assertEquals("AI_INVALID_RESPONSE", assertThrows(AiUnavailableException.class, () -> f.service().coverage(1L, 7L, 10L, "en")).code());
        f.defectAnswer = new AiAssistance.DefectAnalysis("Details", List.of(), List.of(""), List.of(), List.of());
        assertEquals("AI_INVALID_RESPONSE", assertThrows(AiUnavailableException.class, () -> f.service().analyzeDefect(1L, 7L, 20L, "en")).code());
    }
}
