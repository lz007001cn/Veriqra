package io.github.lz007001cn.veriqra.integration;

import com.fasterxml.jackson.databind.JsonNode;
import io.github.lz007001cn.veriqra.dao.jdbc.*;
import io.github.lz007001cn.veriqra.model.*;
import io.github.lz007001cn.veriqra.service.*;
import io.github.lz007001cn.veriqra.service.auth.PasswordVerifier;
import io.github.lz007001cn.veriqra.service.support.*;
import io.github.lz007001cn.veriqra.web.*;
import io.github.lz007001cn.veriqra.web.json.JsonMapperProvider;
import org.junit.jupiter.api.*;
import org.junit.jupiter.api.io.TempDir;
import javax.crypto.SecretKeyFactory;
import javax.crypto.spec.PBEKeySpec;
import java.net.*;
import java.net.http.*;
import java.nio.file.Path;
import java.time.*;
import java.util.*;
import static org.junit.jupiter.api.Assertions.*;

/** Execution and defects are created via HTTP; only users/members are bootstrapped using DAOs. */
class ExecutionHttpIntegrationTest extends MysqlFixture {
    @TempDir static Path directory;
    EmbeddedWebServer server;
    HttpClient client;
    String cookie;
    String hash;
    User admin, tester, developer;
    ProjectService projectService;

    @BeforeAll void startHttp() throws Exception {
        // No DatabaseConfig.load/application environment: reuse the already checked fixture pool exclusively.
        if (!config.jdbcUrl().matches("jdbc:mysql://(?:localhost|127\\.0\\.0\\.1):[0-9]{1,5}/veriqra_test_[a-z0-9_]+"))
            throw new IllegalStateException("Asset HTTP tests require the isolated 13307 fixture");
        var transactions = new JdbcServiceTransaction(tx);
        var daos = new JdbcServiceDaoFactory();
        var access = new ProjectAccessPolicy();
        projectService = new DefaultProjectService(transactions, daos, access);
        server = new EmbeddedWebServer(directory, new WebServices(
                new DefaultAuthService(transactions, daos, new PasswordVerifier()), projectService,
                new DefaultRequirementService(transactions, daos, access),
                new DefaultTestCaseService(transactions, daos, access),
                new DefaultTraceabilityService(transactions, daos, access, Clock.systemUTC()),
                new DefaultTestPlanService(transactions, daos, access),
                new DefaultTestRunService(transactions, daos, access, Clock.systemUTC()),
                new DefaultTestExecutionService(transactions, daos, access, Clock.systemUTC()),
                new DefaultDefectService(transactions, daos, access),
                new DefaultAutomationService(transactions, daos, access),
                new DefaultTestImportService(transactions, daos, access,
                        new io.github.lz007001cn.veriqra.service.importing.JUnitXmlParser(), Clock.systemUTC())), false, "");
        client = HttpClient.newBuilder().connectTimeout(Duration.ofSeconds(5)).build();
        byte[] salt = new byte[16]; new java.security.SecureRandom().nextBytes(salt);
        PBEKeySpec spec = new PBEKeySpec("asset-test-password".toCharArray(),salt,600000,256);
        try {
            hash="pbkdf2_sha256$600000$"+HexFormat.of().formatHex(salt)+"$"+
                    HexFormat.of().formatHex(SecretKeyFactory.getInstance("PBKDF2WithHmacSHA256").generateSecret(spec).getEncoded());
        } finally { spec.clearPassword(); }
    }
    @AfterAll void stopHttp() throws Exception { if(server!=null)server.close(); }
    @BeforeEach void bootstrapAccounts() {
        cookie=null;
        admin=account("asset_admin",SystemRole.ADMIN);
        tester=account("asset_tester",SystemRole.USER);
        developer=account("asset_developer",SystemRole.USER);
    }
    User account(String name,SystemRole role) {
        return tx.inTransaction(c->new JdbcUserDao(c).insert(new User(null,name,name,hash,role,UserStatus.ACTIVE,null,null,null)));
    }
    void member(long project,User user,ProjectRole role,MembershipStatus status) {
        tx.inTransaction(c-> {
            var dao=new JdbcProjectMemberDao(c);
            var existing=dao.find(project,user.id());
            if(existing.isEmpty())dao.add(new ProjectMember(project,user.id(),role,status,null,null,null));
            else {var v=existing.get();dao.update(new ProjectMember(project,user.id(),role,status,v.joinedAt(),v.updatedAt(),v.lockVersion()));}
            return null;
        });
    }
    HttpResponse<String> call(String method,String path,String body) throws Exception {
        var request=HttpRequest.newBuilder(URI.create(server.base()+"/api"+path)).timeout(Duration.ofSeconds(15))
                .header("X-Veriqra-Request","1");
        request.header("Origin", "http://" + URI.create(server.base()).getRawAuthority());
        if(cookie!=null)request.header("Cookie",cookie);
        if(body!=null)request.header("Content-Type","application/json");
        return client.send(request.method(method,body==null?HttpRequest.BodyPublishers.noBody():HttpRequest.BodyPublishers.ofString(body))
                .build(),HttpResponse.BodyHandlers.ofString());
    }
    JsonNode expect(int status,String method,String path,String body) throws Exception {
        var response=call(method,path,body);
        assertEquals(status,response.statusCode(),method+" "+path+": "+response.body());
        if(status==204){assertEquals("",response.body());return null;}
        return JsonMapperProvider.readerFor(JsonNode.class).readValue(response.body());
    }
    void login(User user) throws Exception {
        var r=call("POST","/auth/login","{\"username\":\""+user.username()+"\",\"password\":\"asset-test-password\"}");
        assertEquals(200,r.statusCode(),r.body());
        cookie=r.headers().firstValue("set-cookie").orElseThrow().split(";",2)[0];
    }
    long project(String key) throws Exception {
        return expect(201,"POST","/projects","{\"projectKey\":\""+key+"\",\"name\":\""+key+"\"}").get("id").asLong();
    }
    static String base(long p){return "/projects/"+p;}
    JsonNode requirement(long p) throws Exception {
        return expect(201,"POST",base(p)+"/requirements","{\"title\":\"requirement\",\"description\":\"text\",\"priority\":\"HIGH\"}");
    }
    static String steps(String action) {
        return "[{\"stepOrder\":1,\"action\":\""+action+"\",\"expectedResult\":\"ok\"}]";
    }
    JsonNode testCase(long p) throws Exception {
        return expect(201,"POST",base(p)+"/test-cases","{\"title\":\"case\",\"priority\":\"HIGH\",\"steps\":"+steps("do")+"}");
    }
    static String caseUpdate(int version,String action,String status) {
        return "{\"title\":\"case\",\"priority\":\"HIGH\",\"status\":\""+status+"\",\"expectedVersion\":"+version+",\"steps\":"+steps(action)+"}";
    }
    static String planUpdate(int version,String status) {
        return "{\"name\":\"plan\",\"status\":\""+status+"\",\"expectedVersion\":"+version+"}";
    }
    JsonNode plan(long p,List<Long> cases) throws Exception {
        return expect(201,"POST",base(p)+"/test-plans","{\"name\":\"plan\",\"testCaseIds\":"+JsonMapperProvider.writer().writeValueAsString(cases)+"}");
    }
    static String version(int v){return "{\"expectedVersion\":"+v+"}";}
    static String evidence(long failure,int version){return "{\"failureAttemptId\":"+failure+",\"expectedVersion\":"+version+"}";}
    String link(long p,long r,long c){return base(p)+"/requirements/"+r+"/test-cases/"+c;}


    long readyCase(long p) throws Exception {
        var value=testCase(p);long id=value.get("id").asLong();
        expect(200,"PUT",base(p)+"/test-cases/"+id,caseUpdate(value.get("version").asInt(),"do","READY"));
        return id;
    }
    record RunRef(long project,long run,long runCase) {
        String path(){return base(project)+"/runs/"+run;}
        String attempts(){return path()+"/cases/"+runCase+"/attempts";}
    }
    RunRef adHoc(long p,long... cases) throws Exception {
        var value=expect(201,"POST",base(p)+"/runs","{\"name\":\"run\",\"testCaseIds\":"+Arrays.toString(cases)+"}");
        long run=value.get("id").asLong();
        long rc=expect(200,"GET",base(p)+"/runs/"+run,null).at("/cases/0/runCaseId").asLong();
        return new RunRef(p,run,rc);
    }
    static String attempt(String outcome,UUID key) {
        return "{\"outcome\":\""+outcome+"\",\"submissionKey\":\""+key+"\"}";
    }
    JsonNode record(RunRef run,String outcome) throws Exception {
        return expect(201,"POST",run.attempts(),attempt(outcome,UUID.randomUUID()));
    }
    JsonNode defect(long p,long failure,Long assignee) throws Exception {
        return expect(201,"POST",base(p)+"/defects","{\"failureAttemptId\":"+failure+
                ",\"title\":\"bug\",\"severity\":\"HIGH\",\"priority\":\"HIGH\",\"assigneeId\":"+assignee+"}");
    }
    static String defectPath(long p,long id){return base(p)+"/defects/"+id;}
    int defectVersion(String path) throws Exception {
        return expect(200,"GET",path,null).at("/defect/version").asInt();
    }
    void resolve(String path) throws Exception {
        expect(204,"POST",path+"/start",version(defectVersion(path)));
        expect(204,"POST",path+"/resolve","{\"expectedVersion\":"+defectVersion(path)+",\"resolutionNote\":\"fixed\"}");
    }
    record ClosedFlow(RunRef run,long defect,long failure,long pass,long bugKey) { }
    ClosedFlow closedFlow() throws Exception {
        login(admin);long p=project("CHAIN");
        long req=requirement(p).get("id").asLong(),c=readyCase(p);
        expect(204,"POST",link(p,req,c),"{}");
        expect(204,"POST",link(p,req,c)+"/confirm","{}");
        var plan=plan(p,List.of(c));long planId=plan.get("id").asLong();
        expect(200,"PUT",base(p)+"/test-plans/"+planId,planUpdate(plan.get("version").asInt(),"READY"));
        var run=expect(201,"POST",base(p)+"/runs","{\"name\":\"release\",\"testPlanId\":"+planId+"}");
        long runId=run.get("id").asLong();
        var detail=expect(200,"GET",base(p)+"/runs/"+runId,null);
        assertEquals("NOT_RUN",detail.at("/cases/0/currentOutcome").asText());
        assertTrue(detail.at("/cases/0/latestAttempt").isNull());
        assertEquals(planId,detail.at("/run/testPlanId").asLong());
        var ref=new RunRef(p,runId,detail.at("/cases/0/runCaseId").asLong());
        long fail=record(ref,"FAIL").get("id").asLong();
        var bug=defect(p,fail,admin.id());long bugId=bug.get("id").asLong();
        String path=defectPath(p,bugId);
        resolve(path);
        expect(409,"POST",path+"/close",version(defectVersion(path)));
        long pass=record(ref,"PASS").get("id").asLong();
        expect(204,"POST",path+"/close",version(defectVersion(path)));
        assertEquals("CLOSED",expect(200,"GET",path,null).at("/defect/status").asText());
        assertEquals(1,expect(200,"GET",base(p)+"/runs",null).size());
        assertEquals(1,expect(200,"GET",base(p)+"/defects",null).size());
        return new ClosedFlow(ref,bugId,fail,pass,bug.get("keyNo").asLong());
    }

    @Test void fullHttpWorkflowPreservesFailPassAndClosedEvidenceInMysql() throws Exception {
        var flow=closedFlow();
        var history=expect(200,"GET",flow.run().attempts(),null);
        assertEquals(2,history.size());
        assertEquals("FAIL",history.get(0).get("outcome").asText());
        assertEquals("PASS",history.get(1).get("outcome").asText());
        tx.inTransaction(c->{
            var attempts=new JdbcTestAttemptDao(c).listByRunCase(flow.run().runCase());
            assertEquals(List.of(1,2),attempts.stream().map(TestAttempt::attemptNo).toList());
            assertEquals(List.of(flow.failure(),flow.pass()),attempts.stream().map(TestAttempt::id).toList());
            assertEquals(DefectStatus.CLOSED,new JdbcDefectDao(c).findById(flow.defect()).orElseThrow().status());
            assertEquals(List.of(flow.failure()),new JdbcTestAttemptDefectDao(c).listAttemptsByDefect(flow.defect())
                    .stream().map(TestAttemptDefect::attemptId).toList());
            return null;
        });
    }

    @Test void planMembershipSnapshotsAndThreeManualAttemptsRemainHistorical() throws Exception {
        login(admin);
        long p = project("PLANEXEC"), first = readyCase(p), second = readyCase(p);
        var created = plan(p, List.of(first));
        long planId = created.get("id").asLong();
        String planPath = base(p) + "/test-plans/" + planId;
        expect(204, "POST", planPath + "/test-cases/" + second, version(created.get("version").asInt()));
        var withTwo = expect(200, "GET", planPath, null);
        assertEquals(2, withTwo.get("testCaseIds").size());
        expect(204, "POST", planPath + "/test-cases/" + second + "/remove", version(withTwo.at("/plan/version").asInt()));
        var withOne = expect(200, "GET", planPath, null);
        assertEquals(List.of(first), List.of(withOne.at("/testCaseIds/0").asLong()));
        expect(204, "POST", planPath + "/test-cases/" + second, version(withOne.at("/plan/version").asInt()));
        var ready = expect(200, "PUT", planPath,
                planUpdate(expect(200, "GET", planPath, null).at("/plan/version").asInt(), "READY"));
        assertEquals("READY", ready.get("status").asText());
        var run = expect(201, "POST", base(p) + "/runs", "{\"name\":\"manual release\",\"testPlanId\":" + planId + "}");
        long runId = run.get("id").asLong();
        assertEquals(1, expect(200, "GET", base(p) + "/runs", null).size());
        String runPath = base(p) + "/runs/" + runId;
        var before = expect(200, "GET", runPath, null);
        assertEquals(2, before.get("cases").size());
        long runCase = before.at("/cases/0/runCaseId").asLong();
        var currentCase = expect(200, "GET", base(p) + "/test-cases/" + first, null);
        expect(200, "PUT", base(p) + "/test-cases/" + first,
                caseUpdate(currentCase.at("/testCase/version").asInt(), "changed after run", "READY"));
        assertEquals(before, expect(200, "GET", runPath, null));
        String historyPath = runPath + "/cases/" + runCase + "/attempts";
        for (String outcome : List.of("FAIL", "PASS", "FAIL"))
            expect(201, "POST", historyPath, attempt(outcome, UUID.randomUUID()));
        var history = expect(200, "GET", historyPath, null);
        assertEquals(List.of("FAIL", "PASS", "FAIL"),
                List.of(history.get(0).get("outcome").asText(), history.get(1).get("outcome").asText(), history.get(2).get("outcome").asText()));
        assertEquals(List.of(1, 2, 3),
                List.of(history.get(0).get("attemptNo").asInt(), history.get(1).get("attemptNo").asInt(), history.get(2).get("attemptNo").asInt()));
        assertEquals("FAIL", expect(200, "GET", runPath, null).at("/cases/0/currentOutcome").asText());
        long otherRunCase = before.at("/cases/1/runCaseId").asLong();
        expect(201, "POST", runPath + "/cases/" + otherRunCase + "/attempts", attempt("SKIPPED", UUID.randomUUID()));
        expect(204, "POST", runPath + "/complete", version(run.get("version").asInt()));
        assertEquals("COMPLETED", expect(200, "GET", runPath, null).at("/run/status").asText());
        assertEquals(3, expect(200, "GET", historyPath, null).size());
    }

    @Test void reopenAtomicallyRetainsBugAndOldEvidenceAndClearsResolution() throws Exception {
        var f=closedFlow();String path=defectPath(f.run().project(),f.defect());
        long newer=record(f.run(),"FAIL").get("id").asLong();
        int v=defectVersion(path);
        String body="{\"expectedVersion\":"+v+",\"failureAttemptId\":"+newer+",\"assigneeId\":"+admin.id()+"}";
        expect(409,"POST",path+"/reopen",body.replace("\"expectedVersion\":"+v,"\"expectedVersion\":"+(v-1)));
        assertEquals(1,expect(200,"GET",path,null).get("evidence").size());
        expect(204,"POST",path+"/reopen",body);
        var detail=expect(200,"GET",path,null);
        assertEquals("REOPENED",detail.at("/defect/status").asText());
        assertEquals(f.bugKey(),detail.at("/defect/keyNo").asLong());
        assertTrue(detail.at("/defect/resolutionNote").isNull());
        assertEquals(Set.of(f.failure(),newer),new HashSet<>(List.of(detail.at("/evidence/0/attemptId").asLong(),detail.at("/evidence/1/attemptId").asLong())));
        tx.inTransaction(c -> {
            var persisted = new JdbcDefectDao(c).findById(f.defect()).orElseThrow();
            assertEquals(DefectStatus.REOPENED, persisted.status());
            assertEquals(f.bugKey(), persisted.keyNo());
            assertNull(persisted.resolutionNote());
            assertEquals(Set.of(f.failure(), newer), new JdbcTestAttemptDefectDao(c)
                    .listAttemptsByDefect(f.defect()).stream()
                    .map(TestAttemptDefect::attemptId).collect(java.util.stream.Collectors.toSet()));
            return null;
        });
        expect(204,"POST",path+"/start",version(v+1));
    }

    @Test void runSnapshotsStayIndependentAndTerminalReplayStillWorks() throws Exception {
        login(admin);long p=project("SNAP");long c=readyCase(p);var run=adHoc(p,c);
        var original=expect(200,"GET",run.path(),null);
        var tc=expect(200,"GET",base(p)+"/test-cases/"+c,null);
        expect(200,"PUT",base(p)+"/test-cases/"+c,caseUpdate(tc.at("/testCase/version").asInt(),"changed","READY"));
        assertEquals(original,expect(200,"GET",run.path(),null));
        expect(409,"POST",run.path()+"/complete",version(0));
        UUID key=UUID.randomUUID();String body=attempt("FAIL",key);
        var first=expect(201,"POST",run.attempts(),body);
        assertEquals(first,expect(201,"POST",run.attempts(),body));
        expect(409,"POST",run.attempts(),attempt("PASS",key));
        expect(204,"POST",run.path()+"/complete",version(0));
        assertEquals(first,expect(201,"POST",run.attempts(),body));
        expect(409,"POST",run.attempts(),attempt("PASS",UUID.randomUUID()));
        expect(409,"POST",run.path()+"/cancel",version(1));
        assertEquals(1,expect(200,"GET",run.attempts(),null).size());
        var cancelled=adHoc(p,readyCase(p));
        String prior=attempt("SKIPPED",UUID.randomUUID());
        var skipped=expect(201,"POST",cancelled.attempts(),prior);
        expect(204,"POST",cancelled.path()+"/cancel",version(0));
        assertEquals(skipped,expect(201,"POST",cancelled.attempts(),prior));
        expect(409,"POST",cancelled.attempts(),attempt("PASS",UUID.randomUUID()));
    }

    @Test void wrongProjectAndSameProjectWrongRunRejectReadsWritesAndReplay() throws Exception {
        login(admin);long p=project("SCOPE"),q=project("OTHER");long c=readyCase(p);
        var run=adHoc(p,c);var other=adHoc(p,c);var foreign=adHoc(q,readyCase(q));
        String body=attempt("FAIL",UUID.randomUUID());
        long failure=expect(201,"POST",run.attempts(),body).get("id").asLong();
        for(var bad:List.of(new RunRef(q,run.run(),run.runCase()),new RunRef(p,other.run(),run.runCase()))) {
            expect(400,"GET",bad.attempts(),null);expect(400,"POST",bad.attempts(),body);
        }
        expect(400,"GET",base(q)+"/runs/"+run.run(),null);
        for(String action:List.of("complete","cancel"))expect(400,"POST",base(q)+"/runs/"+run.run()+"/"+action,version(0));
        var bug=defect(p,failure,admin.id());long id=bug.get("id").asLong();
        String wrong=defectPath(q,id),right=defectPath(p,id);
        expect(400,"GET",wrong,null);
        expect(400,"PUT",wrong,"{\"title\":\"x\",\"priority\":\"HIGH\",\"severity\":\"HIGH\",\"expectedVersion\":0}");
        for(String action:List.of("start","close"))expect(400,"POST",wrong+"/"+action,version(0));
        expect(400,"POST",wrong+"/resolve","{\"expectedVersion\":0,\"resolutionNote\":\"fixed\"}");
        expect(400,"POST",wrong+"/reopen","{\"expectedVersion\":0,\"failureAttemptId\":"+failure+",\"assigneeId\":"+admin.id()+"}");
        expect(400,"POST",wrong+"/evidence","{\"failureAttemptId\":"+failure+",\"expectedVersion\":0}");
        expect(400,"POST",wrong+"/evidence/"+failure+"/remove",version(0));
        long outside=record(foreign,"FAIL").get("id").asLong();
        expect(400,"POST",right+"/evidence","{\"failureAttemptId\":"+outside+",\"expectedVersion\":0}");
        expect(400,"POST",right+"/evidence/"+outside+"/remove",version(0));
        expect(400,"POST",right+"/reopen","{\"expectedVersion\":0,\"failureAttemptId\":"+outside+",\"assigneeId\":"+admin.id()+"}");
        expect(400,"POST",base(q)+"/defects","{\"failureAttemptId\":"+failure+",\"title\":\"x\",\"priority\":\"HIGH\",\"severity\":\"HIGH\"}");
        assertEquals(0,defectVersion(right));
        assertEquals(1,expect(200,"GET",right,null).get("evidence").size());
    }

    @Test void closeRequiresLatestPassForEveryEvidenceRunCaseAndEvidenceCorrectionKeepsAttempts() throws Exception {
        login(admin);long p=project("EVIDENCE");var a=adHoc(p,readyCase(p));var b=adHoc(p,readyCase(p));
        long fa=record(a,"FAIL").get("id").asLong(),fb=record(b,"FAIL").get("id").asLong();
        long id=defect(p,fa,admin.id()).get("id").asLong();String path=defectPath(p,id);
        expect(204,"POST",path+"/evidence",evidence(fb,defectVersion(path)));
        expect(204,"POST",path+"/evidence",evidence(fb,defectVersion(path)));
        assertEquals(2,expect(200,"GET",path,null).get("evidence").size());
        expect(204,"POST",path+"/evidence/"+fb+"/remove",version(defectVersion(path)));
        assertEquals(1,expect(200,"GET",b.attempts(),null).size());
        expect(204,"POST",path+"/evidence",evidence(fb,defectVersion(path)));
        resolve(path);
        record(a,"PASS");expect(409,"POST",path+"/close",version(defectVersion(path)));
        record(b,"PASS");record(a,"FAIL");
        expect(409,"POST",path+"/close",version(defectVersion(path)));
        record(a,"PASS");expect(204,"POST",path+"/close",version(defectVersion(path)));
        expect(409,"POST",path+"/evidence",evidence(fb,defectVersion(path)));
        expect(409,"POST",path+"/evidence/"+fb+"/remove",version(defectVersion(path)));
    }

    @Test void invalidFailureAndResolutionAndStaleUpdateDoNotMutate() throws Exception {
        login(admin);long p=project("VALID");var run=adHoc(p,readyCase(p));
        expect(400,"POST",run.attempts(),attempt("PASS",UUID.randomUUID()).replace("}",",\"failureMessage\":\"not allowed\"}"));
        long pass=record(run,"PASS").get("id").asLong();
        expect(409,"POST",base(p)+"/defects","{\"failureAttemptId\":"+pass+",\"title\":\"x\",\"priority\":\"HIGH\",\"severity\":\"HIGH\"}");
        long fail=record(run,"FAIL").get("id").asLong();
        long id=defect(p,fail,admin.id()).get("id").asLong();String path=defectPath(p,id);
        String update="{\"title\":\"updated\",\"priority\":\"HIGH\",\"severity\":\"HIGH\",\"expectedVersion\":0}";
        expect(200,"PUT",path,update);expect(409,"PUT",path,update);
        expect(409,"POST",path+"/resolve","{\"expectedVersion\":1,\"resolutionNote\":\"fixed\"}");
        expect(204,"POST",path+"/start",version(1));
        expect(400,"POST",path+"/resolve","{\"expectedVersion\":2}");
        expect(400,"POST",path+"/resolve","{\"expectedVersion\":2,\"resolutionNote\":\"  \"}");
        assertEquals("IN_PROGRESS",expect(200,"GET",path,null).at("/defect/status").asText());
    }

    @Test void developerAndRevokedTesterCannotBypassLivePermissions() throws Exception {
        login(admin);long p=project("ROLES");
        member(p,tester,ProjectRole.TESTER,MembershipStatus.ACTIVE);
        member(p,developer,ProjectRole.DEVELOPER,MembershipStatus.ACTIVE);
        var run=adHoc(p,readyCase(p));
        login(tester);long fail=record(run,"FAIL").get("id").asLong();
        login(developer);
        expect(200,"GET",run.path(),null);
        expect(403,"POST",run.attempts(),attempt("PASS",UUID.randomUUID()));
        long own=defect(p,fail,developer.id()).get("id").asLong();
        long others=defect(p,fail,admin.id()).get("id").asLong();
        String path=defectPath(p,own);
        expect(403,"POST",defectPath(p,others)+"/start",version(0));
        resolve(path);
        expect(403,"POST",path+"/close",version(defectVersion(path)));
        expect(403,"POST",path+"/evidence",evidence(fail,defectVersion(path)));
        expect(403,"POST",path+"/evidence/"+fail+"/remove",version(defectVersion(path)));
        expect(403,"POST",path+"/reopen","{\"expectedVersion\":"+defectVersion(path)+",\"failureAttemptId\":"+fail+",\"assigneeId\":"+developer.id()+"}");
        login(tester);
        record(run,"PASS");
        expect(204,"POST",path+"/close",version(defectVersion(path)));
        member(p,tester,ProjectRole.TESTER,MembershipStatus.INACTIVE);
        expect(403,"POST",run.attempts(),attempt("PASS",UUID.randomUUID()));
        expect(403,"GET",run.path(),null);
    }

    @Test void concurrentHttpSameKeyCreatesExactlyOneAttempt() throws Exception {
        login(admin);long p=project("KEY");var run=adHoc(p,readyCase(p));
        String body=attempt("FAIL",UUID.randomUUID());
        try(var executor=java.util.concurrent.Executors.newFixedThreadPool(2)) {
            var start=new java.util.concurrent.CountDownLatch(1);
            java.util.concurrent.Callable<HttpResponse<String>> task=()->{start.await();return call("POST",run.attempts(),body);};
            var a=executor.submit(task);var b=executor.submit(task);start.countDown();
            var ra=a.get(20,java.util.concurrent.TimeUnit.SECONDS);var rb=b.get(20,java.util.concurrent.TimeUnit.SECONDS);
            assertEquals(201,ra.statusCode(),ra.body());assertEquals(201,rb.statusCode(),rb.body());
            JsonNode first=JsonMapperProvider.readerFor(JsonNode.class).readValue(ra.body());
            JsonNode second=JsonMapperProvider.readerFor(JsonNode.class).readValue(rb.body());
            assertEquals(first,second);
        }
        assertEquals(1,expect(200,"GET",run.attempts(),null).size());
    }
}
