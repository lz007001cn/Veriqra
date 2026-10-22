package io.github.lz007001cn.veriqra.integration;

import io.github.lz007001cn.veriqra.dao.TestStepDao;
import io.github.lz007001cn.veriqra.dao.jdbc.*;
import io.github.lz007001cn.veriqra.model.*;
import io.github.lz007001cn.veriqra.service.ai.*;
import io.github.lz007001cn.veriqra.service.command.TestStepInput;
import io.github.lz007001cn.veriqra.service.exception.*;
import io.github.lz007001cn.veriqra.service.support.*;
import org.junit.jupiter.api.Test;
import java.lang.reflect.*;
import java.util.*;
import java.util.concurrent.atomic.AtomicInteger;
import static org.junit.jupiter.api.Assertions.*;

class AiCaseIntegrationTest extends ServiceFixture {
    AiCandidate candidate(String title) { return new AiCandidate(title,"说明","前置条件",Priority.HIGH,List.of(new TestStepInput(1,"操作","预期"))); }
    @Test void selectedCandidatesPersistStepsAndReviewLinksAndCanBecomeReady() {
        User admin = actor("ai_admin",SystemRole.ADMIN,UserStatus.ACTIVE);
        Project project = createProject(admin,"AICASE",null,null);
        Requirement requirement = createRequirement(admin,project,"登录验收");
        var service = new AiCaseService(serviceTx,jdbcDaos,access,(r,i)-> List.of(candidate("正常"),candidate("异常"),candidate("边界")));
        var preview = service.generate(admin.id(),project.id(),requirement.id(),null);
        assertTrue(testCases.listByProject(admin.id(),project.id()).isEmpty());
        var saved = service.accept(admin.id(),project.id(),requirement.id(),preview.expectedVersion(),preview.candidates().subList(0,2));
        assertEquals(2,saved.size());
        for (TestCase row : saved) {
            var details = testCases.getDetails(admin.id(),project.id(),row.id());
            assertEquals(TestCaseStatus.DRAFT,details.testCase().status());
            assertEquals("操作",details.steps().getFirst().action());
            assertEquals(TraceabilityStatus.NEEDS_REVIEW,traceability.listByRequirement(admin.id(),project.id(),requirement.id()).getFirst().link().status());
            testCases.update(admin.id(),new io.github.lz007001cn.veriqra.service.command.UpdateTestCaseCommand(row.id(),row.title(),row.description(),row.preconditions(),row.priority(),TestCaseStatus.READY,row.lockVersion(),List.of(new TestStepInput(1,"操作","预期"))));
        }
    }
    @Test void laterInsertFailureRollsBackWholeBatchIncludingCountersAndLinks() {
        User admin = actor("ai_rollback",SystemRole.ADMIN,UserStatus.ACTIVE);
        Project project = createProject(admin,"AIROLLBACK",null,null);
        Requirement requirement = createRequirement(admin,project,"原子批次");
        AtomicInteger writes = new AtomicInteger();
        ServiceDaoFactory failing = connection -> {
            ServiceDaos original = jdbcDaos.create(connection);
            try {
                var components = ServiceDaos.class.getRecordComponents();
                Class<?>[] types = Arrays.stream(components).map(RecordComponent::getType).toArray(Class<?>[]::new);
                Object[] values = new Object[components.length];
                for (int i=0;i<values.length;i++) {
                    values[i] = components[i].getAccessor().invoke(original);
                    if (components[i].getName().equals("steps")) values[i] = Proxy.newProxyInstance(getClass().getClassLoader(),new Class[]{TestStepDao.class},(p,m,a)-> {
                        if (m.getName().equals("add") && writes.incrementAndGet()==2) throw new ConflictException("Injected second step failure");
                        try { return m.invoke(original.steps(),a); } catch (InvocationTargetException e) { throw e.getCause(); }
                    });
                }
                return ServiceDaos.class.getDeclaredConstructor(types).newInstance(values);
            } catch (ReflectiveOperationException e) { throw new AssertionError(e); }
        };
        var service = new AiCaseService(serviceTx,failing,access,(r,i)->List.of());
        assertThrows(ConflictException.class,()->service.accept(admin.id(),project.id(),requirement.id(),requirement.lockVersion(),List.of(candidate("一"),candidate("二"))));
        assertTrue(testCases.listByProject(admin.id(),project.id()).isEmpty());
        assertTrue(traceability.listByRequirement(admin.id(),project.id(),requirement.id()).isEmpty());
        assertEquals(1L,createCase(admin,project,"事务回滚后",1).keyNo());
    }
}
