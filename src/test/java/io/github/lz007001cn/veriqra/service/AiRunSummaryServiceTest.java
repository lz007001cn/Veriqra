package io.github.lz007001cn.veriqra.service;

import io.github.lz007001cn.veriqra.model.*;
import io.github.lz007001cn.veriqra.service.ai.*;
import io.github.lz007001cn.veriqra.service.exception.*;
import io.github.lz007001cn.veriqra.service.support.*;
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
            case "defects.findById" -> Optional.of(new Defect((Long)args[0],7L,(Long)args[0],"Linked bug",null,DefectSeverity.HIGH,Priority.HIGH,DefectStatus.CLOSED,1L,null,"Fixed",null,LocalDateTime.of(2026,10,30,4,0),0));
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
}
