package io.github.lz007001cn.veriqra.service;

import io.github.lz007001cn.veriqra.model.*;
import io.github.lz007001cn.veriqra.service.exception.*;
import io.github.lz007001cn.veriqra.service.support.*;
import org.junit.jupiter.api.Test;
import java.lang.reflect.Proxy;
import java.time.Clock;
import java.util.*;
import static org.junit.jupiter.api.Assertions.*;

/** Strict read-only DAO doubles: any write or locking DAO call fails the test. */
class R2ReadRelationsServiceTest {
    static final long PROJECT = 7L, ACTOR = 1L;
    final Map<Long, Requirement> requirements = new HashMap<>();
    final Map<Long, Defect> defects = new HashMap<>();
    List<TestCaseRequirement> traces = List.of();
    List<TestAttemptDefect> evidence = List.of();
    SystemRole systemRole = SystemRole.USER;
    MembershipStatus membership = MembershipStatus.ACTIVE;
    long caseProject = PROJECT, runProject = PROJECT, runCaseRun = 40L, attemptRunCase = 50L;
    int relationReads;
    final ServiceTransaction tx = new ServiceTransaction() {
        public <T> T execute(Work<T> work) { return work.execute(null); }
    };
    final ServiceDaoFactory factory = connection -> daos();

    Object answer(String dao, String method, Object[] args) {
        return switch (dao + "." + method) {
            case "users.findById" -> Optional.of(new User(ACTOR,"tester","Tester","unused",systemRole,UserStatus.ACTIVE,null,null,0));
            case "members.find" -> Optional.of(new ProjectMember(PROJECT,ACTOR,ProjectRole.DEVELOPER,membership,null,null,0));
            case "testCases.findById" -> Optional.of(new TestCase(20L,caseProject,1L,"Case",null,null,Priority.MEDIUM,TestCaseStatus.READY,ACTOR,null,null,0));
            case "requirements.findById" -> Optional.ofNullable(requirements.get(args[0]));
            case "traceability.listByTestCase" -> { relationReads++; yield traces; }
            case "testRuns.findById" -> Optional.of(new TestRun(40L,runProject,null,"Run",null,null,TestRunStatus.COMPLETED,null,ACTOR,null,null,0));
            case "runCases.findById" -> Optional.of(new TestRunCase(50L,runCaseRun,20L,"Snapshot",null,null,Priority.MEDIUM,null));
            case "attempts.findById" -> Optional.of(new TestAttempt(60L,attemptRunCase,1,TestAttemptStatus.FAIL,ACTOR,null,null,null,null,null,null,null,null));
            case "attemptDefects.listDefectsByAttempt" -> { relationReads++; yield evidence; }
            case "defects.findById" -> Optional.ofNullable(defects.get(args[0]));
            default -> throw new AssertionError("Unexpected DAO call: " + dao + "." + method);
        };
    }
    ServiceDaos daos() {
        try {
            var components = ServiceDaos.class.getRecordComponents();
            var types = Arrays.stream(components).map(c -> c.getType()).toArray(Class<?>[]::new);
            Object[] values = new Object[components.length];
            for (int i = 0; i < values.length; i++) {
                String name = components[i].getName();
                values[i] = Proxy.newProxyInstance(getClass().getClassLoader(), new Class<?>[]{types[i]},
                        (proxy, method, args) -> answer(name, method.getName(), args));
            }
            return ServiceDaos.class.getDeclaredConstructor(types).newInstance(values);
        } catch (ReflectiveOperationException failure) { throw new AssertionError(failure); }
    }
    TraceabilityService traceService() { return new DefaultTraceabilityService(tx,factory,new ProjectAccessPolicy(),Clock.systemUTC()); }
    DefectService defectService() { return new DefaultDefectService(tx,factory,new ProjectAccessPolicy()); }
    Requirement requirement(long id, long project) {
        return new Requirement(id,project,id,"Requirement " + id,null,Priority.MEDIUM,RequirementStatus.ACTIVE,ACTOR,null,null,0);
    }
    Defect defect(long id, long project, DefectStatus status) {
        return new Defect(id,project,id,"Defect " + id,null,DefectSeverity.MEDIUM,Priority.MEDIUM,status,ACTOR,null,null,null,null,3);
    }

    @Test void reverseTraceReturnsEveryPersistedReviewStateWithNamesAndRequirementStatus() {
        var links = new ArrayList<TestCaseRequirement>();
        long id = 10L;
        for (TraceabilityStatus status : TraceabilityStatus.values()) {
            requirements.put(id,requirement(id,PROJECT));
            links.add(new TestCaseRequirement(id++,20L,status,ACTOR,null,null,null,null));
        }
        traces = List.copyOf(links);
        var result = traceService().listByTestCase(ACTOR,PROJECT,20L);
        assertEquals(Set.of(TraceabilityStatus.values()), new HashSet<>(result.stream().map(v -> v.link().status()).toList()));
        assertEquals("Requirement 10",result.getFirst().requirement().title());
        assertEquals(RequirementStatus.ACTIVE,result.getFirst().requirement().status());
    }
    @Test void reverseTraceRejectsWrongCaseProjectAndCorruptRequirementProject() {
        caseProject = 8L;
        assertThrows(NotFoundException.class,() -> traceService().listByTestCase(ACTOR,PROJECT,20L));
        assertEquals(0,relationReads);
        caseProject = PROJECT;
        traces = List.of(new TestCaseRequirement(10L,20L,TraceabilityStatus.CONFIRMED,ACTOR,null,null,null,null));
        requirements.put(10L,requirement(10L,8L));
        assertThrows(NotFoundException.class,() -> traceService().listByTestCase(ACTOR,PROJECT,20L));
    }
    @Test void inactiveMemberCannotReadTargetRelations() {
        membership = MembershipStatus.INACTIVE;
        assertThrows(ForbiddenException.class,() -> traceService().listByTestCase(ACTOR,PROJECT,20L));
        assertThrows(ForbiddenException.class,() -> defectService().listForAttempt(ACTOR,PROJECT,40L,50L,60L));
        assertEquals(0,relationReads);
    }
    @Test void adminWithoutActiveMembershipCanReadButDoesNotBypassScope() {
        systemRole = SystemRole.ADMIN; membership = MembershipStatus.INACTIVE;
        assertEquals(List.of(),traceService().listByTestCase(ACTOR,PROJECT,20L));
        assertEquals(List.of(),defectService().listForAttempt(ACTOR,PROJECT,40L,50L,60L));
        runProject = 8L;
        assertThrows(NotFoundException.class,() -> defectService().listForAttempt(ACTOR,PROJECT,40L,50L,60L));
    }
    @Test void attemptQueryReturnsOnlyItsPersistedDefectsIncludingClosed() {
        defects.put(70L,defect(70L,PROJECT,DefectStatus.OPEN));
        defects.put(71L,defect(71L,PROJECT,DefectStatus.CLOSED));
        defects.put(72L,defect(72L,PROJECT,DefectStatus.OPEN)); // Not linked to this attempt.
        evidence = List.of(new TestAttemptDefect(60L,70L,ACTOR,null),new TestAttemptDefect(60L,71L,ACTOR,null));
        var result = defectService().listForAttempt(ACTOR,PROJECT,40L,50L,60L);
        assertEquals(List.of(70L,71L),result.stream().map(Defect::id).toList());
        assertEquals(DefectStatus.CLOSED,result.getLast().status());
    }
    @Test void attemptQueryRejectsEachBrokenParentBeforeReadingAnyDefect() {
        runProject = 8L;
        assertThrows(NotFoundException.class,() -> defectService().listForAttempt(ACTOR,PROJECT,40L,50L,60L));
        runProject = PROJECT; runCaseRun = 41L;
        assertThrows(NotFoundException.class,() -> defectService().listForAttempt(ACTOR,PROJECT,40L,50L,60L));
        runCaseRun = 40L; attemptRunCase = 51L;
        assertThrows(NotFoundException.class,() -> defectService().listForAttempt(ACTOR,PROJECT,40L,50L,60L));
        assertEquals(0,relationReads);
    }
    @Test void attemptQueryFailsClosedIfPersistentLinkPointsToAnotherProject() {
        defects.put(70L,defect(70L,8L,DefectStatus.OPEN));
        evidence = List.of(new TestAttemptDefect(60L,70L,ACTOR,null));
        assertThrows(NotFoundException.class,() -> defectService().listForAttempt(ACTOR,PROJECT,40L,50L,60L));
    }
}
