package io.github.lz007001cn.veriqra.integration;

import io.github.lz007001cn.veriqra.dao.jdbc.JdbcProjectMemberDao;
import io.github.lz007001cn.veriqra.model.*;
import io.github.lz007001cn.veriqra.service.DefaultDefectService;
import io.github.lz007001cn.veriqra.service.command.TransitionDefectCommand;
import io.github.lz007001cn.veriqra.service.exception.ForbiddenException;
import io.github.lz007001cn.veriqra.service.support.ServiceDaoFactory;
import org.junit.jupiter.api.Test;

import java.nio.file.Files;
import java.nio.file.Path;
import java.util.*;
import java.util.concurrent.*;
import java.util.concurrent.atomic.AtomicBoolean;

import static org.junit.jupiter.api.Assertions.*;

/** Real two-connection role change after RR snapshot, before membership locks; no browser-schema access. */
class R1TransitionRoleRaceIntegrationTest extends R1ServiceFixture {
    @Test void committedRoleChangeCannotUseOldTesterSnapshotToStartAnotherAssigneesDefect() throws Exception {
        race(DefectStatus.IN_PROGRESS);
    }

    @Test void committedRoleChangeCannotUseOldTesterSnapshotToResolveAnotherAssigneesDefect() throws Exception {
        race(DefectStatus.RESOLVED);
    }

    private void race(DefectStatus target) throws Exception {
        Scenario s=scenario();
        TestAttempt failure=attempt(s,run(s),TestAttemptStatus.FAIL);
        Defect created=defect(s,failure);
        Defect initial=target==DefectStatus.RESOLVED ? defects.transition(s.developer().id(),s.project().id(),
                new TransitionDefectCommand(created.id(),DefectStatus.IN_PROGRESS,null,created.lockVersion())) : created;
        CountDownLatch snapshot=new CountDownLatch(1),release=new CountDownLatch(1);
        AtomicBoolean paused=new AtomicBoolean();
        List<String> roleReads=new CopyOnWriteArrayList<>();
        Map<String,Object> facts=new LinkedHashMap<>();
        facts.put("target",target.name());facts.put("initialDefect",initial);
        ServiceDaoFactory barrier=c->{
            var daos=jdbcDaos.create(c);
            daos=replaceDao(daos,"members",dao->proxy(dao,(actual,method,args)->{
                Object result=invoke(actual,method,args);
                if((method.getName().equals("find")||method.getName().equals("findForShare"))
                        && Objects.equals(args[0],s.project().id())&&Objects.equals(args[1],s.tester().id())) {
                    var value=(Optional<?>)result;
                    roleReads.add(method.getName()+":"+value.map(v->((ProjectMember)v).projectRole().name()).orElse("MISSING"));
                }
                return result;
            }));
            return replaceDao(daos,"defects",dao->proxy(dao,(actual,method,args)->{
                Object result=invoke(actual,method,args);
                if(method.getName().equals("findById")&&paused.compareAndSet(false,true)) {
                    assertEquals(java.sql.Connection.TRANSACTION_REPEATABLE_READ,c.getTransactionIsolation());
                    try(var st=c.createStatement();var rs=st.executeQuery("SELECT CONNECTION_ID()")){assertTrue(rs.next());facts.put("transitionConnection",rs.getLong(1));}
                    snapshot.countDown();
                    assertTrue(release.await(10,TimeUnit.SECONDS),"Role update did not release snapshot barrier");
                }
                return result;
            }));
        };
        try(ExecutorService executor=Executors.newSingleThreadExecutor()) {
            var service=new DefaultDefectService(serviceTx,barrier,access);
            Future<Defect> transition=executor.submit(()->service.transition(s.tester().id(),s.project().id(),
                    new TransitionDefectCommand(initial.id(),target,target==DefectStatus.RESOLVED?"Synthetic role-race probe":null,initial.lockVersion())));
            try {
                assertTrue(snapshot.await(10,TimeUnit.SECONDS),"Transition did not establish RR snapshot");
                ProjectMember updated=tx.inTransaction(c->{
                    try(var st=c.createStatement();var rs=st.executeQuery("SELECT CONNECTION_ID()")){assertTrue(rs.next());facts.put("roleWriterConnection",rs.getLong(1));}
                    var dao=new JdbcProjectMemberDao(c);
                    ProjectMember old=dao.find(s.project().id(),s.tester().id()).orElseThrow();
                    assertEquals(ProjectRole.TESTER,old.projectRole());
                    return dao.update(new ProjectMember(old.projectId(),old.userId(),ProjectRole.DEVELOPER,
                            old.status(),old.joinedAt(),old.updatedAt(),old.lockVersion()));
                });
                facts.put("committedMember",updated);
                assertEquals(ProjectRole.DEVELOPER,updated.projectRole());
                assertNotEquals(facts.get("transitionConnection"),facts.get("roleWriterConnection"));
                release.countDown();
                ExecutionException denied=assertThrows(ExecutionException.class,()->transition.get(10,TimeUnit.SECONDS));
                assertInstanceOf(ForbiddenException.class,denied.getCause());
                facts.put("result","FORBIDDEN");
                assertEquals(initial,current(s,initial),"Denied transition must not change status/version/note");
                assertTrue(receipts(initial).isEmpty());
                assertTrue(links(initial).isEmpty());
                assertTrue(roleReads.stream().anyMatch(v->v.equals("findForShare:DEVELOPER")));
                assertFalse(roleReads.stream().anyMatch(v->v.equals("find:TESTER")),"Authorization must never use the old consistent-read role");
            } finally {
                release.countDown();
                // Persist observations even when pre-fix authorization incorrectly succeeds.
                facts.put("roleReads",roleReads);
                facts.put("actualDefect",current(s,initial));
                facts.put("receiptCount",receipts(initial).size());
                String output=System.getProperty("r1.role.race.evidence");
                if(output!=null) {
                    Path folder=Path.of(output);Files.createDirectories(folder);
                    new com.fasterxml.jackson.databind.ObjectMapper().findAndRegisterModules().writerWithDefaultPrettyPrinter()
                            .writeValue(folder.resolve(target.name()+".json").toFile(),facts);
                }
            }
        }
    }
}
