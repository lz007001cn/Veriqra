package io.github.lz007001cn.veriqra.service;

import com.fasterxml.jackson.databind.ObjectMapper;
import io.github.lz007001cn.veriqra.model.*;
import io.github.lz007001cn.veriqra.service.ai.*;
import io.github.lz007001cn.veriqra.service.exception.*;
import io.github.lz007001cn.veriqra.service.support.*;
import io.github.lz007001cn.veriqra.web.json.JsonMapperProvider;
import org.junit.jupiter.api.Test;
import java.lang.reflect.Proxy;
import java.time.*;
import java.util.*;
import static org.junit.jupiter.api.Assertions.*;

class AiRunSummaryServiceTest {
    boolean inTransaction, disabled, inactive;
    long runProject = 7L;
    int calls;
    final Clock clock = Clock.fixed(Instant.parse("2026-10-31T01:00:00Z"), ZoneOffset.UTC);
    final List<TestRunCase> cases = new ArrayList<>();
    final Map<Long, TestAttempt> attempts = new HashMap<>();
    final List<Long> defectIds = new ArrayList<>();
    final Map<Long, List<Long>> exactDefectIds = new HashMap<>();
    final List<Long> exactLinkReads = new ArrayList<>();
    long foreignDefectId = -1;
    AiRunSummaryInput captured;
    AiRunSummaryAnalysis answer = new AiRunSummaryAnalysis("Overview", List.of("Finding"), List.of("Retest"));
    final ServiceTransaction tx = new ServiceTransaction() {
        public <T> T execute(Work<T> work) {
            assertFalse(inTransaction); inTransaction = true;
            try { return work.execute(null); } finally { inTransaction = false; }
        }
    };
    Object answer(String dao, String method, Object[] args) {
        assertTrue(inTransaction, "All evidence reads share one transaction");
        return switch (dao + "." + method) {
            case "projects.findById" -> Optional.of(new Project(7L,"SUMMARY","Summary project",null,ProjectStatus.ARCHIVED,1L,null,null,0));
            case "users.findById" -> Optional.of(new User(1L,"developer","Developer","unused",SystemRole.USER,disabled ? UserStatus.DISABLED : UserStatus.ACTIVE,null,null,0));
            case "members.find" -> Optional.of(new ProjectMember(7L,1L,ProjectRole.DEVELOPER,inactive ? MembershipStatus.INACTIVE : MembershipStatus.ACTIVE,null,null,0));
            case "testRuns.findById" -> Optional.of(new TestRun(9L,runProject,null,"【演示模拟】修复前回归","Synthetic","v1.4.0",TestRunStatus.COMPLETED,LocalDateTime.of(2026,10,20,3,0),1L,LocalDateTime.of(2026,10,20,2,0),null,0));
            case "runCases.listByRun" -> List.copyOf(cases);
            case "attempts.findLatestByRunCase" -> Optional.ofNullable(attempts.get(args[0]));
            case "attemptDefects.listDefectIdsByRun" -> { assertEquals(9L,args[0]); yield List.copyOf(defectIds); }
            case "attemptDefects.listDefectsByAttempt" -> {
                Long attempt = (Long) args[0]; exactLinkReads.add(attempt);
                yield exactDefectIds.getOrDefault(attempt, List.of()).stream().map(id -> new TestAttemptDefect(attempt, id, 1L, null)).toList();
            }
            case "defects.findById" -> Optional.of(new Defect((Long)args[0],(Long)args[0] == foreignDefectId ? 8L : 7L,(Long)args[0],"Linked bug",null,DefectSeverity.HIGH,Priority.HIGH,DefectStatus.CLOSED,1L,null,"Fixed",null,LocalDateTime.of(2026,10,30,4,0),0));
            case "runCaseSteps.listByRunCase" -> List.of(new TestRunCaseStep((Long)args[0],1,"Action","Expected"));
            default -> throw new AssertionError("Unexpected read/write " + dao + "." + method);
        };
    }
    ServiceDaos daos() {
        try {
            var components = ServiceDaos.class.getRecordComponents();
            var types = Arrays.stream(components).map(c -> c.getType()).toArray(Class<?>[]::new);
            Object[] values = new Object[components.length];
            for (int i = 0; i < values.length; i++) {
                String name = components[i].getName();
                values[i] = Proxy.newProxyInstance(getClass().getClassLoader(),new Class<?>[]{types[i]},(p,m,a)->answer(name,m.getName(),a));
            }
            return ServiceDaos.class.getDeclaredConstructor(types).newInstance(values);
        } catch (ReflectiveOperationException e) { throw new AssertionError(e); }
    }
    AiRunSummaryService service() {
        return new AiRunSummaryService(tx,c -> daos(),new ProjectAccessPolicy(),(input,language) -> {
            assertFalse(inTransaction,"Model request must release the database connection");
            assertTrue(Set.of("zh-CN","en").contains(language)); captured = input; calls++; return answer;
        },clock);
    }
    void add(long id, TestAttemptStatus status) {
        cases.add(new TestRunCase(id,9L,id + 100,"Case " + id,"Description","Preconditions",Priority.HIGH,null));
        if (status != null) attempts.put(id,new TestAttempt(id + 1000,id,3,status,1L,null,null,null,null,null,"Actual",status == TestAttemptStatus.FAIL ? "Failure" : null,UUID.randomUUID()));
    }
    void addImported(long id, TestAttemptStatus status) {
        add(id, status);
        attempts.put(id, new TestAttempt(id + 1000, id, 1, status, null, 17L, 27L, null, null, null,
                "JUnit actual", status == TestAttemptStatus.FAIL ? "JUnit failure" : null, UUID.randomUUID()));
    }
    @Test void latestResultsAreCountedByServerAndReadOnlyDeveloperCanSummarizeArchivedProject() {
        add(1,TestAttemptStatus.FAIL); add(2,TestAttemptStatus.BLOCKED); add(3,TestAttemptStatus.PASS); add(4,TestAttemptStatus.SKIPPED); add(5,null);
        defectIds.addAll(List.of(31L,31L));
        var preview = service().generate(1L,7L,9L,"zh-CN");
        assertEquals(new AiRunSummaryInput.Counts(5,4,1,1,1,1,1),preview.input().counts());
        assertEquals(List.of("FAIL","BLOCKED","NOT_RUN","SKIPPED","PASS"),preview.input().cases().stream().map(AiRunSummaryInput.CaseEvidence::outcome).toList());
        assertEquals("Failure",preview.input().cases().getFirst().failureMessage());
        assertEquals(1,preview.input().linkedDefectCount()); assertEquals(1,preview.input().defects().size());
        assertEquals("CLOSED",preview.input().defects().getFirst().status());
        assertEquals(LocalDateTime.of(2026,10,20,2,0),preview.input().runCreatedAt());
        assertEquals(LocalDateTime.of(2026,10,20,3,0),preview.input().runEndedAt());
        assertEquals(LocalDateTime.of(2026,10,30,4,0),preview.input().defects().getFirst().updatedAt());
        assertEquals(LocalDateTime.of(2026,10,31,1,0),preview.generatedAt()); assertEquals(1,calls);
        assertTrue(preview.failureActions().isEmpty()); assertTrue(exactLinkReads.isEmpty());
    }
    @Test void wrongProjectDisabledAndInactiveUsersCannotCallTheModel() {
        runProject = 8L; assertThrows(NotFoundException.class,()->service().generate(1L,7L,9L,"en"));
        runProject = 7L; disabled = true; assertThrows(ForbiddenException.class,()->service().generate(1L,7L,9L,"en"));
        disabled = false; inactive = true; assertThrows(ForbiddenException.class,()->service().generate(1L,7L,9L,"en"));
        assertEquals(0,calls);
    }
    @Test void limitsPreserveWholeRunCountsPrioritizeFailuresAndDiscloseOmissions() {
        for (int i = 1; i <= 45; i++) add(i,i <= 43 ? TestAttemptStatus.PASS : TestAttemptStatus.FAIL);
        for (long i = 1; i <= 23; i++) defectIds.add(i);
        var input = service().generate(1L,7L,9L,"en").input();
        assertEquals(45,input.counts().total()); assertEquals(43,input.counts().passed()); assertEquals(2,input.counts().failed());
        assertEquals(40,input.cases().size()); assertEquals(5,input.omittedCaseCount());
        assertEquals(44L,input.cases().getFirst().runCaseId());
        assertEquals(23,input.linkedDefectCount()); assertEquals(20,input.defects().size()); assertEquals(3,input.omittedDefectCount());
    }
    @Test void oversizedEvidenceIsBoundedAndMarkedWithoutChangingCounts() {
        add(1,TestAttemptStatus.FAIL);
        cases.set(0,new TestRunCase(1L,9L,101L,"X".repeat(1000),"Y".repeat(20000),"Z".repeat(20000),Priority.HIGH,null));
        var input = service().generate(1L,7L,9L,"en").input();
        assertTrue(input.detailsTruncated()); assertEquals(240,input.cases().getFirst().title().length());
        assertEquals(500,input.cases().getFirst().description().length()); assertEquals(1,input.counts().failed());
    }
    @Test void malformedLanguageAndMalformedProviderResponseHaveExplicitErrors() {
        assertThrows(ValidationException.class,()->service().generate(1L,7L,9L,"fr"));
        assertThrows(ValidationException.class,()->service().generate(1L,7L,9L,null)); assertEquals(0,calls);
        answer = new AiRunSummaryAnalysis("",List.of(),List.of());
        assertEquals("AI_INVALID_RESPONSE",assertThrows(AiUnavailableException.class,()->service().generate(1L,7L,9L,"en")).code());
    }
    @Test void importedFailureActionsUseExactLatestAttemptsAndFindLinksBeyondNarrativeCap() {
        addImported(1, TestAttemptStatus.FAIL); addImported(2, TestAttemptStatus.FAIL);
        add(3, TestAttemptStatus.FAIL); addImported(4, TestAttemptStatus.SKIPPED); addImported(5, TestAttemptStatus.PASS);
        addImported(6, TestAttemptStatus.FAIL);
        attempts.put(6L, new TestAttempt(2006L, 6L, 2, TestAttemptStatus.PASS, 1L, null, null, null, null, null, "Later PASS", null, UUID.randomUUID()));
        for (long id = 1; id <= 22; id++) defectIds.add(id);
        exactDefectIds.put(1001L, List.of(21L)); exactDefectIds.put(1006L, List.of(22L));
        answer = new AiRunSummaryAnalysis("Overview", List.of(), List.of(), List.of(
                new AiRunSummaryAnalysis.FailureSuggestion(1L, "Unneeded new title", "Review existing evidence"),
                new AiRunSummaryAnalysis.FailureSuggestion(2L, "Observed timeout", "Check the expected wait"),
                new AiRunSummaryAnalysis.FailureSuggestion(3L, "Manual failure", "Ignored"),
                new AiRunSummaryAnalysis.FailureSuggestion(6L, "Superseded failure", "Ignored")));
        var preview = service().generate(1L, 7L, 9L, "en");
        assertEquals(List.of(1L, 2L), preview.failureActions().stream().map(AiRunSummaryPreview.FailureAction::runCaseId).toList());
        assertEquals(List.of(1001L, 1002L), exactLinkReads);
        var linked = preview.failureActions().getFirst();
        assertEquals(1001L, linked.attemptId()); assertEquals("Case 1", linked.title());
        assertNull(linked.draftTitle()); assertEquals("Review existing evidence", linked.suggestion());
        assertEquals(List.of(new AiRunSummaryPreview.LinkedDefect(21L, 21L, "Linked bug")), linked.linkedDefects());
        assertTrue(preview.input().defects().stream().noneMatch(row -> row.defectId().equals(21L)));
        assertEquals(20, preview.input().defects().size());
        assertEquals(new AiRunSummaryInput.JunitFailureContext(1, 0), captured.cases().getFirst().junitFailure());
        assertEquals("Observed timeout", preview.failureActions().getLast().draftTitle());
        assertTrue(preview.failureActions().getLast().linkedDefects().isEmpty());
    }
    @Test void absentUnknownAndAmbiguousModelSuggestionsLeaveServerActionsAvailable() throws Exception {
        addImported(1, TestAttemptStatus.FAIL); addImported(2, TestAttemptStatus.FAIL); addImported(3, TestAttemptStatus.FAIL);
        answer = new AiRunSummaryAnalysis("Overview", List.of(), List.of(), List.of(
                new AiRunSummaryAnalysis.FailureSuggestion(1L, "First title", null),
                new AiRunSummaryAnalysis.FailureSuggestion(1L, "Conflicting title", null),
                new AiRunSummaryAnalysis.FailureSuggestion(2L, " ", "Inspect timeout"),
                new AiRunSummaryAnalysis.FailureSuggestion(99L, "Unknown case", "Ignored")));
        var preview = service().generate(1L, 7L, 9L, "en");
        assertEquals(3, preview.failureActions().size());
        assertNull(preview.failureActions().getFirst().draftTitle());
        assertNull(preview.failureActions().get(1).draftTitle()); assertEquals("Inspect timeout", preview.failureActions().get(1).suggestion());
        assertNull(preview.failureActions().getLast().suggestion());
        var json = new ObjectMapper().readTree(JsonMapperProvider.writer().writeValueAsBytes(preview));
        assertFalse(json.path("analysis").has("failureSuggestions"));
        assertEquals(1002L, json.path("failureActions").get(1).path("attemptId").asLong());
        assertEquals("Inspect timeout", json.path("failureActions").get(1).path("suggestion").asText());
    }
    @Test void importedFailureActionsAreBoundedAndRejectCrossProjectLinkedDefects() {
        for (long id = 1; id <= 42; id++) addImported(id, TestAttemptStatus.FAIL);
        var preview = service().generate(1L, 7L, 9L, "en");
        assertEquals(42, preview.input().counts().failed()); assertEquals(40, preview.failureActions().size());
        assertEquals(1040L, exactLinkReads.getLast()); assertEquals(40, exactLinkReads.size());
        exactDefectIds.put(1001L, List.of(88L)); foreignDefectId = 88L;
        assertThrows(ConflictException.class, () -> service().generate(1L, 7L, 9L, "en"));
        assertEquals(1, calls, "Wrong-project evidence must fail before the model call");
    }
}
