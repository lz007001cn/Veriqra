package io.github.lz007001cn.veriqra.service;

import io.github.lz007001cn.veriqra.model.*;
import io.github.lz007001cn.veriqra.service.ai.*;
import io.github.lz007001cn.veriqra.service.command.TestStepInput;
import io.github.lz007001cn.veriqra.service.exception.*;
import io.github.lz007001cn.veriqra.service.support.*;
import org.junit.jupiter.api.Test;
import java.lang.reflect.Proxy;
import java.util.*;
import static org.junit.jupiter.api.Assertions.*;

class AiCaseServiceTest {
    boolean inTransaction, forbidden, archived;
    int inserts, steps, links, calls;
    long project = 7;
    final AiCandidate candidate = new AiCandidate("Title", "Description", "Precondition", Priority.HIGH, List.of(new TestStepInput(1, "Action", "Expected")));
    final ServiceTransaction tx = new ServiceTransaction() {
        public <T> T execute(Work<T> work) { assertFalse(inTransaction); inTransaction = true; try { return work.execute(null); } finally { inTransaction = false; } }
    };
    Object answer(String dao, String method, Object[] args) {
        return switch (dao + "." + method) {
            case "users.findById", "users.findByIdForShare" -> Optional.of(new User(1L,"tester","Tester","unused",SystemRole.USER,UserStatus.ACTIVE,null,null,0));
            case "members.find", "members.findForShare" -> Optional.of(new ProjectMember(7L,1L,forbidden ? ProjectRole.DEVELOPER : ProjectRole.TESTER,MembershipStatus.ACTIVE,null,null,0));
            case "projects.findByIdForShare" -> Optional.of(new Project(7L,"AI","AI project",null,ProjectStatus.ACTIVE,1L,null,null,0));
            case "requirements.findById", "requirements.findByIdForUpdate" -> Optional.of(new Requirement(10L,project,1L,"Requirement","Acceptance criteria",Priority.MEDIUM,archived ? RequirementStatus.ARCHIVED : RequirementStatus.ACTIVE,1L,null,null,4));
            case "counters.allocateNext" -> (long) inserts + 1;
            case "testCases.insert" -> { inserts++; TestCase row = (TestCase) args[0]; assertEquals(TestCaseStatus.DRAFT,row.status()); yield new TestCase((long)inserts,7L,row.keyNo(),row.title(),row.description(),row.preconditions(),row.priority(),row.status(),1L,null,null,0); }
            case "steps.add" -> { steps++; yield args[0]; }
            case "traceability.add" -> { links++; assertEquals(TraceabilityStatus.NEEDS_REVIEW,((TestCaseRequirement)args[0]).status()); yield args[0]; }
            default -> throw new AssertionError(dao + "." + method);
        };
    }
    ServiceDaos daos() {
        try {
            var components = ServiceDaos.class.getRecordComponents();
            var types = Arrays.stream(components).map(c -> c.getType()).toArray(Class<?>[]::new);
            Object[] values = new Object[components.length];
            for (int i = 0; i < values.length; i++) {
                String name = components[i].getName();
                values[i] = Proxy.newProxyInstance(getClass().getClassLoader(),new Class<?>[]{types[i]},(p,m,a)-> answer(name,m.getName(),a));
            }
            return ServiceDaos.class.getDeclaredConstructor(types).newInstance(values);
        } catch (ReflectiveOperationException e) { throw new AssertionError(e); }
    }
    AiCaseService service() { return new AiCaseService(tx,c -> daos(),new ProjectAccessPolicy(),(r,i) -> {
        assertFalse(inTransaction,"Model request must release the database connection"); calls++; return List.of(candidate,candidate,candidate);
    }); }
    @Test void previewDoesNotWriteAndAcceptCreatesAllSelectedDraftsAndReviewLinks() {
        var service = service(); var preview = service.generate(1L,7L,10L,"Boundary cases");
        assertEquals(4,preview.expectedVersion()); assertEquals(0,inserts);
        var result = service.accept(1L,7L,10L,preview.expectedVersion(),preview.candidates().subList(0,2));
        assertEquals(2,result.size()); assertEquals(2,steps); assertEquals(2,links); assertEquals(1,calls);
    }
    @Test void staleVersionAndMalformedSelectionFailBeforeAnyWrite() {
        assertThrows(ConflictException.class,() -> service().accept(1L,7L,10L,3,List.of(candidate)));
        assertThrows(ValidationException.class,() -> service().accept(1L,7L,10L,4,List.of(candidate,new AiCandidate("",null,null,Priority.LOW,List.of()))));
        assertEquals(0,inserts);
    }
    @Test void wrongProjectArchivedRequirementAndDeveloperCannotGenerate() {
        project = 8; assertThrows(NotFoundException.class,() -> service().generate(1L,7L,10L,null));
        project = 7; archived = true; assertThrows(ConflictException.class,() -> service().generate(1L,7L,10L,null));
        archived = false; forbidden = true; assertThrows(ForbiddenException.class,() -> service().generate(1L,7L,10L,null)); assertEquals(0,calls);
    }
}
