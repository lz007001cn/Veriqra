package io.github.lz007001cn.veriqra.web;

import com.fasterxml.jackson.databind.JsonNode;
import io.github.lz007001cn.veriqra.model.*;
import io.github.lz007001cn.veriqra.service.*;
import io.github.lz007001cn.veriqra.service.auth.*;
import io.github.lz007001cn.veriqra.service.command.*;
import io.github.lz007001cn.veriqra.service.query.*;
import io.github.lz007001cn.veriqra.web.json.JsonMapperProvider;
import org.junit.jupiter.api.*;
import org.junit.jupiter.api.io.TempDir;
import java.net.*;
import java.net.http.*;
import java.nio.file.Path;
import java.time.Duration;
import java.util.*;
import static org.junit.jupiter.api.Assertions.*;

/** Real HTTP parsing/routing, with captured Service calls; business proofs use MySQL separately. */
@TestInstance(TestInstance.Lifecycle.PER_CLASS)
class ExecutionWebTest {
    @TempDir static Path directory;
    EmbeddedWebServer server;
    HttpClient client;
    String cookie, invoked;
    Object[] arguments;
    final TestRun run=new TestRun(40L,7L,null,"run",null,null,TestRunStatus.IN_PROGRESS,null,1L,null,null,0);
    final TestAttempt attempt=new TestAttempt(60L,50L,1,TestAttemptStatus.FAIL,1L,null,null,null,null,null,null,null,UUID.randomUUID());
    final Defect defect=new Defect(70L,7L,1L,"bug",null,DefectSeverity.HIGH,Priority.HIGH,DefectStatus.OPEN,1L,null,null,null,null,0);
    static final String RUNS="/projects/7/runs", RUN=RUNS+"/40", ATTEMPTS=RUN+"/cases/50/attempts";
    static final String DEFECTS="/projects/7/defects", DEFECT=DEFECTS+"/70";
    static final String CREATE_DEFECT="{\"failureAttemptId\":60,\"title\":\"bug\",\"severity\":\"HIGH\",\"priority\":\"HIGH\"}";
    @BeforeAll void start() throws Exception {
        AuthService auth=new AuthService() {
            public AuthenticatedUser authenticate(String u,String p){return current(1L);}
            public AuthenticatedUser current(Long id){return new AuthenticatedUser(id,"test",SystemRole.USER,UserStatus.ACTIVE);}
        };
        var runs=WebFoundationTest.proxy(TestRunService.class,(o,m,a)->{
            capture(m.getName(),a);
            return switch(m.getName()){
                case "listByProject" -> List.of(run);
                case "getDetails" -> new RunDetails(run,List.of(new RunDetails.CaseDetails(
                        new TestRunCase(50L,40L,20L,"old title",null,"setup",Priority.HIGH,null),
                        List.of(new TestRunCaseStep(50L,1,"do","ok")),Optional.empty())));
                default -> run;
            };
        });
        var execution=WebFoundationTest.proxy(TestExecutionService.class,(o,m,a)->{
            capture(m.getName(),a);return m.getName().equals("listAttempts")?List.of(attempt):attempt;
        });
        var defects=WebFoundationTest.proxy(DefectService.class,(o,m,a)->{
            capture(m.getName(),a);
            return switch(m.getName()){
                case "listByProject" -> List.of(defect);
                case "getDetails" -> new DefectDetails(defect,List.of(new DefectDetails.Evidence(new TestAttemptDefect(60L,70L,1L,null),attempt,40L)));
                case "addEvidence" -> new TestAttemptDefect(60L,70L,1L,null);
                case "removeEvidence" -> null;
                default -> defect;
            };
        });
        server=new EmbeddedWebServer(directory,new WebServices(auth,unused(ProjectService.class),unused(RequirementService.class),
                unused(TestCaseService.class),unused(TraceabilityService.class),unused(TestPlanService.class),runs,execution,defects,
                unused(AutomationService.class), unused(TestImportService.class)));
        client=HttpClient.newBuilder().connectTimeout(Duration.ofSeconds(5)).build();
    }
    static <T> T unused(Class<T> type){return WebFoundationTest.proxy(type,(o,m,a)->{throw new AssertionError("Unexpected Service");});}
    void capture(String name,Object[] args){invoked=name;arguments=args;}
    @AfterAll void stop() throws Exception {if(server!=null)server.close();}
    @BeforeEach void login() throws Exception {
        cookie=null;
        var response=call("POST","/auth/login","{\"username\":\"test\",\"password\":\"test-only\"}",true);
        assertEquals(200,response.statusCode());
        cookie=response.headers().firstValue("set-cookie").orElseThrow().split(";",2)[0];
        invoked=null;arguments=null;
    }
    HttpResponse<String> call(String method,String path,String body,boolean marker) throws Exception {
        var b=HttpRequest.newBuilder(URI.create(server.base()+"/api"+path)).timeout(Duration.ofSeconds(15));
        b.header("Origin", "http://" + URI.create(server.base()).getRawAuthority());
        if(cookie!=null)b.header("Cookie",cookie);
        if(marker)b.header("X-Veriqra-Request","1");
        if(body!=null)b.header("Content-Type","application/json");
        return client.send(b.method(method,body==null?HttpRequest.BodyPublishers.noBody():HttpRequest.BodyPublishers.ofString(body)).build(),HttpResponse.BodyHandlers.ofString());
    }
    JsonNode expect(int status,String method,String path,String body) throws Exception {
        var r=call(method,path,body,true);assertEquals(status,r.statusCode(),r.body());
        if(status==204){assertEquals("",r.body());return null;}
        return JsonMapperProvider.readerFor(JsonNode.class).readValue(r.body());
    }
    static String attemptBody(){return "{\"outcome\":\"FAIL\",\"submissionKey\":\"12345678-1234-1234-1234-123456789012\"}";}
    @Test void runCreationMapsExactlyOneOriginAndRejectsAmbiguity() throws Exception {
        expect(201,"POST",RUNS,"{\"name\":\"run\",\"testPlanId\":30}");
        assertEquals("createFromPlan",invoked);assertEquals(1L,arguments[0]);
        assertEquals(new CreatePlanRunCommand(7L,30L,"run",null,null),arguments[1]);
        expect(201,"POST",RUNS,"{\"name\":\"run\",\"testCaseIds\":[20]}");
        assertEquals(new CreateAdHocRunCommand(7L,"run",null,null,List.of(20L)),arguments[1]);
        for(String body:List.of("{\"name\":\"run\"}","{\"name\":\"run\",\"testPlanId\":30,\"testCaseIds\":[20]}")){
            invoked=null;expect(400,"POST",RUNS,body);assertNull(invoked);
        }
    }
    @Test void snapshotProjectionAndRunActionsUseScopedServices() throws Exception {
        var detail=expect(200,"GET",RUN,null);
        assertArrayEquals(new Object[]{1L,7L,40L},arguments);
        assertEquals("NOT_RUN",detail.at("/cases/0/currentOutcome").asText());
        assertEquals("old title",detail.at("/cases/0/snapshotTitle").asText());
        assertEquals("do",detail.at("/cases/0/steps/0/action").asText());
        expect(200,"GET",RUNS,null);
        for(String action:List.of("complete","cancel")){
            expect(204,"POST",RUN+"/"+action,"{\"expectedVersion\":2}");
            assertEquals(action,invoked);assertArrayEquals(new Object[]{1L,7L,40L,2},arguments);
        }
        expect(405,"PUT",RUN,"{}");
        expect(404,"POST",RUN+"/cases/50/steps","{}");
    }
    @Test void attemptsMapActorAndAllPathParentsWithoutBusinessLogic() throws Exception {
        expect(201,"POST",ATTEMPTS,attemptBody());
        assertEquals("recordAttempt",invoked);assertEquals(4,arguments.length);
        assertEquals(1L,arguments[0]);assertEquals(7L,arguments[1]);assertEquals(40L,arguments[2]);
        var cmd=(RecordAttemptCommand)arguments[3];
        assertEquals(50L,cmd.runCaseId());assertEquals(TestAttemptStatus.FAIL,cmd.status());assertNull(cmd.failureMessage());
        expect(200,"GET",ATTEMPTS,null);
        assertEquals("listAttempts",invoked);assertArrayEquals(new Object[]{1L,7L,40L,50L},arguments);
    }
    @Test void defectsMapCommandsAndExplicitActionsAndSmallEvidenceProjection() throws Exception {
        expect(201,"POST",DEFECTS,CREATE_DEFECT);
        assertEquals(new CreateDefectCommand(7L,60L,"bug",null,DefectSeverity.HIGH,Priority.HIGH,null),arguments[1]);
        var detail=expect(200,"GET",DEFECT,null);
        assertEquals(40L,detail.at("/evidence/0/runId").asLong());assertEquals(50L,detail.at("/evidence/0/runCaseId").asLong());
        expect(200,"GET",DEFECTS,null);
        expect(200,"PUT",DEFECT,"{\"title\":\"bug\",\"severity\":\"HIGH\",\"priority\":\"HIGH\",\"expectedVersion\":3}");
        assertEquals(new UpdateDefectCommand(70L,"bug",null,DefectSeverity.HIGH,Priority.HIGH,null,3),arguments[2]);
        for(String action:List.of("start","close")){
            expect(204,"POST",DEFECT+"/"+action,"{\"expectedVersion\":3}");
            assertEquals(new TransitionDefectCommand(70L,action.equals("start")?DefectStatus.IN_PROGRESS:DefectStatus.CLOSED,null,3),arguments[2]);
        }
        expect(204,"POST",DEFECT+"/resolve","{\"expectedVersion\":3,\"resolutionNote\":\"fixed\"}");
        assertEquals(new TransitionDefectCommand(70L,DefectStatus.RESOLVED,"fixed",3),arguments[2]);
        expect(204,"POST",DEFECT+"/reopen","{\"expectedVersion\":3,\"failureAttemptId\":61,\"assigneeId\":2}");
        assertEquals(new ReopenDefectCommand(70L,61L,2L,3),arguments[2]);
        expect(204,"POST",DEFECT+"/evidence","{\"failureAttemptId\":61,\"expectedVersion\":3}");
        assertArrayEquals(new Object[]{1L,7L,70L,61L,3},arguments);
        expect(204,"POST",DEFECT+"/evidence/61/remove","{\"expectedVersion\":4}");
        assertEquals("removeEvidence",invoked);assertArrayEquals(new Object[]{1L,7L,70L,61L,4},arguments);
        expect(405,"PATCH",DEFECT,"{\"status\":\"CLOSED\"}");
    }
    @Test void allWriteShapesRejectForgedServerFieldsAndInvalidVersions() throws Exception {
        Map<String,String> bodies=new LinkedHashMap<>();
        bodies.put(RUNS,"{\"name\":\"run\",\"testPlanId\":30}");
        bodies.put(ATTEMPTS,attemptBody());bodies.put(DEFECTS,CREATE_DEFECT);
        bodies.put(DEFECT+"/resolve","{\"expectedVersion\":0,\"resolutionNote\":\"fixed\"}");
        bodies.put(DEFECT+"/reopen","{\"expectedVersion\":0,\"failureAttemptId\":61,\"assigneeId\":2}");
        bodies.put(DEFECT+"/evidence","{\"failureAttemptId\":61,\"expectedVersion\":0}");
        for(var entry:bodies.entrySet())for(String field:List.of(
                "actorUserId","role","projectRole","projectId","runId","runCaseId",
                "attemptNo","status","bugKey","lockVersion")){
            invoked=null;
            expect(400,"POST",entry.getKey(),entry.getValue().replace("}",",\""+field+"\":1}"));
            assertNull(invoked);
        }
        for(String value:List.of("-1","1.5","null","\"1\"","2147483648")){
            for(String path:List.of(RUN+"/complete",DEFECT+"/start",DEFECT+"/close",DEFECT+"/resolve",DEFECT+"/reopen")){
                invoked=null;
                String extra=path.endsWith("resolve")?",\"resolutionNote\":\"fixed\"":path.endsWith("reopen")?",\"failureAttemptId\":61,\"assigneeId\":2":"";
                expect(400,"POST",path,"{\"expectedVersion\":"+value+extra+"}");assertNull(invoked);
            }
        }
    }
    @Test void duplicateTrailingWrongTypeAndOversizeJsonNeverReachService() throws Exception {
        for(String body:List.of(attemptBody()+" {}",attemptBody().replace("\"outcome\":\"FAIL\"","\"outcome\":\"FAIL\",\"outcome\":\"PASS\""),
                attemptBody().replace("\"FAIL\"","1"),attemptBody().replace("12345678-1234-1234-1234-123456789012","invalid"),
                "{\"outcome\":\"FAIL\"}",attemptBody().replace("}",",\"durationMs\":\"10\"}"))){
            invoked=null;expect(400,"POST",ATTEMPTS,body);assertNull(invoked);
        }
        invoked=null;expect(413,"POST",ATTEMPTS,attemptBody().replace("}",",\"comment\":\""+"x".repeat(66000)+"\"}"));assertNull(invoked);
        assertEquals(403,call("POST",ATTEMPTS,attemptBody(),false).statusCode());
        assertNull(invoked);
    }
}
