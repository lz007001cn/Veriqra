package io.github.lz007001cn.veriqra.web;

import com.fasterxml.jackson.databind.JsonNode;
import io.github.lz007001cn.veriqra.model.*;
import io.github.lz007001cn.veriqra.service.*;
import io.github.lz007001cn.veriqra.service.auth.*;
import io.github.lz007001cn.veriqra.service.command.*;
import io.github.lz007001cn.veriqra.web.json.JsonMapperProvider;
import org.junit.jupiter.api.*;
import org.junit.jupiter.api.io.TempDir;
import java.net.*;
import java.net.http.*;
import java.nio.file.Path;
import java.util.*;
import static org.junit.jupiter.api.Assertions.*;

/** Transport contracts on real Tomcat; business rules are covered with real Services/MySQL separately. */
@TestInstance(TestInstance.Lifecycle.PER_CLASS)
class TestAssetWebTest {
    @TempDir static Path directory;
    EmbeddedWebServer server;
    HttpClient client;
    String cookie;
    String invoked;
    Object[] arguments;
    RuntimeException serviceFailure;
    static final String CASE = "{\"title\":\"case\",\"priority\":\"HIGH\",\"steps\":[{\"stepOrder\":1,\"action\":\"do\",\"expectedResult\":\"ok\"}]}";
    static final String UPDATE_CASE = CASE.substring(0, CASE.length()-1) + ",\"status\":\"READY\",\"expectedVersion\":4}";
    final TestCase testCase = new TestCase(20L, 7L, 1L, "case", null, null, Priority.HIGH, TestCaseStatus.DRAFT, 1L, null, null, 5);
    final Requirement requirement = new Requirement(10L, 7L, 1L, "req", null, Priority.HIGH, RequirementStatus.DRAFT, 1L, null, null, 5);
    final TestPlan plan = new TestPlan(30L, 7L, 1L, "plan", null, TestPlanStatus.DRAFT, 1L, null, null, 5);

    @BeforeAll void start() throws Exception {
        AuthService auth = new AuthService() {
            public AuthenticatedUser authenticate(String u, String p) { return current(1L); }
            public AuthenticatedUser current(Long actor) { return new AuthenticatedUser(actor, "test", SystemRole.USER, UserStatus.ACTIVE); }
        };
        var projects = WebFoundationTest.proxy(ProjectService.class, (o,m,a) -> { throw new AssertionError("Unused"); });
        var requirements = WebFoundationTest.proxy(RequirementService.class, (o,m,a) -> {
            record("requirements." + m.getName(), a);
            if (serviceFailure != null) throw serviceFailure;
            return m.getName().equals("listByProject") ? List.of(requirement) : requirement;
        });
        var cases = WebFoundationTest.proxy(TestCaseService.class, (o,m,a) -> {
            record("cases." + m.getName(), a);
            return switch (m.getName()) {
                case "listByProject" -> List.of(testCase);
                case "getDetails" -> new TestCaseDetails(testCase, List.of(new TestStep(20L,1,"do","ok")));
                default -> testCase;
            };
        });
        var trace = WebFoundationTest.proxy(TraceabilityService.class, (o,m,a) -> {
            record("trace." + m.getName(), a);
            var link = new TestCaseRequirement(10L,20L,TraceabilityStatus.NEEDS_REVIEW,1L,null,null,null,null);
            return switch (m.getName()) {
                case "listByRequirement" -> List.of(new TraceabilityDetails(testCase,link));
                case "listByTestCase" -> List.of(new CaseRequirementDetails(requirement,link));
                default -> link;
            };
        });
        var plans = WebFoundationTest.proxy(TestPlanService.class, (o,m,a) -> {
            record("plans." + m.getName(), a);
            return switch (m.getName()) {
                case "listByProject" -> List.of(plan);
                case "getDetails" -> new TestPlanDetails(plan, List.of(new TestPlanCase(30L,20L,1L,null)));
                case "addCase" -> new TestPlanCase(30L,20L,1L,null);
                case "removeCase" -> null;
                default -> plan;
            };
        });
        server = new EmbeddedWebServer(directory, new WebServices(auth, projects, requirements, cases, trace, plans,
                WebFoundationTest.proxy(TestRunService.class, (o,m,a) -> { throw new AssertionError("Unexpected Round 3 call"); }),
                WebFoundationTest.proxy(TestExecutionService.class, (o,m,a) -> { throw new AssertionError("Unexpected Round 3 call"); }),
                WebFoundationTest.proxy(DefectService.class, (o,m,a) -> { throw new AssertionError("Unexpected Round 3 call"); }),
                WebFoundationTest.proxy(AutomationService.class, (o,m,a) -> { throw new AssertionError("Unexpected Round 4 call"); }),
                WebFoundationTest.proxy(TestImportService.class, (o,m,a) -> { throw new AssertionError("Unexpected Round 4 call"); })));
        client = HttpClient.newHttpClient();
    }
    @AfterAll void stop() throws Exception { if (server != null) server.close(); }
    @BeforeEach void login() throws Exception {
        cookie = null;
        var response = call("POST", "/auth/login", "{\"username\":\"test\",\"password\":\"test-only\"}", true);
        assertEquals(200,response.statusCode());
        cookie=response.headers().firstValue("set-cookie").orElseThrow().split(";",2)[0];
        invoked=null; arguments=null; serviceFailure=null;
    }
    void record(String method,Object[] args) { invoked=method; arguments=args; }
    HttpResponse<String> call(String method,String path,String body,boolean marker) throws Exception {
        var b=HttpRequest.newBuilder(URI.create(server.base()+"/api"+path));
        b.header("Origin", "http://" + URI.create(server.base()).getRawAuthority());
        if(cookie!=null)b.header("Cookie",cookie);
        if(marker)b.header("X-Veriqra-Request","1");
        if(body!=null)b.header("Content-Type","application/json");
        return client.send(b.method(method,body==null?HttpRequest.BodyPublishers.noBody():HttpRequest.BodyPublishers.ofString(body))
                .build(),HttpResponse.BodyHandlers.ofString());
    }
    JsonNode expect(int status,String method,String path,String body) throws Exception {
        var r=call(method,path,body,true);
        assertEquals(status,r.statusCode(),r.body());
        if(status==204){assertEquals("",r.body());return null;}
        assertTrue(r.headers().firstValue("content-type").orElseThrow().contains("application/json"));
        return JsonMapperProvider.readerFor(JsonNode.class).readValue(r.body());
    }
    void scope(String expected,long id) {
        assertEquals(expected,invoked);
        assertEquals(1L,arguments[0]); assertEquals(7L,arguments[1]); assertEquals(id,arguments[2]);
    }

    @Test void requirementScopedGetAndUpdateVersionContract() throws Exception {
        assertEquals(5,expect(200,"GET","/projects/7/requirements/10",null).get("version").asInt());
        scope("requirements.get",10);
        expect(200,"PUT","/projects/7/requirements/10","{\"title\":\"req\",\"priority\":\"HIGH\",\"status\":\"DRAFT\",\"expectedVersion\":4}");
        assertEquals("requirements.update",invoked);assertEquals(7L,arguments[1]);
        var command=(UpdateRequirementCommand)arguments[2];
        assertEquals(10L,command.requirementId());assertEquals(4,command.lockVersion());
    }
    @Test void caseWholeStepsCommandsAndSafeDetailProjection() throws Exception {
        expect(201,"POST","/projects/7/test-cases",CASE);
        var create=(CreateTestCaseCommand)arguments[1];
        assertEquals(7L,create.projectId());assertEquals(1,create.steps().getFirst().stepOrder());
        var detail=expect(200,"GET","/projects/7/test-cases/20",null);
        scope("cases.getDetails",20);assertEquals("ok",detail.at("/steps/0/expectedResult").asText());
        assertFalse(detail.toString().contains("createdBy"));assertFalse(detail.toString().contains("lockVersion"));
        expect(200,"PUT","/projects/7/test-cases/20",UPDATE_CASE);
        assertEquals(7L,arguments[1]);var update=(UpdateTestCaseCommand)arguments[2];
        assertEquals(4,update.lockVersion());assertEquals(TestCaseStatus.READY,update.status());
        assertTrue(expect(200,"GET","/projects/7/test-cases",null).isArray());
    }
    @Test void planCommandsAndActionsCarryExpectedVersionAndScope() throws Exception {
        expect(201,"POST","/projects/7/test-plans","{\"name\":\"plan\",\"testCaseIds\":[20]}");
        assertEquals(List.of(20L),((CreateTestPlanCommand)arguments[1]).testCaseIds());
        assertEquals(20,expect(200,"GET","/projects/7/test-plans/30",null).at("/testCaseIds/0").asInt());
        scope("plans.getDetails",30);
        expect(200,"PUT","/projects/7/test-plans/30","{\"name\":\"plan\",\"status\":\"READY\",\"expectedVersion\":4}");
        assertEquals(7L,arguments[1]);assertEquals(4,((UpdateTestPlanCommand)arguments[2]).lockVersion());
        for(String action:List.of("/test-cases/20","/test-cases/20/remove","/archive")) {
            expect(204,"POST","/projects/7/test-plans/30"+action,"{\"expectedVersion\":4}");
            assertEquals(7L,arguments[1]);assertEquals(30L,arguments[2]);
            assertEquals(4,arguments[arguments.length-1]);
        }
        assertTrue(expect(200,"GET","/projects/7/test-plans",null).isArray());
    }
    @Test void traceabilityActionsUseProjectAndSessionIdentity() throws Exception {
        for(String action:List.of("","/confirm","/remove")) {
            expect(204,"POST","/projects/7/requirements/10/test-cases/20"+action,"{}");
            assertArrayEquals(new Object[]{1L,7L,10L,20L},arguments);
        }
        var links=expect(200,"GET","/projects/7/requirements/10/test-cases",null);
        scope("trace.listByRequirement",10);
        assertEquals("NEEDS_REVIEW",links.at("/0/status").asText());
    }
    @Test void reverseTraceGetUsesSessionAndBothParentsAndRejectsQueryOrWrites() throws Exception {
        var links = expect(200, "GET", "/projects/7/test-cases/20/requirements", null);
        scope("trace.listByTestCase", 20);
        assertEquals(20, links.at("/0/testCaseId").asInt());
        assertEquals(10, links.at("/0/requirement/id").asInt());
        assertEquals("req", links.at("/0/requirement/title").asText());
        assertEquals("NEEDS_REVIEW", links.at("/0/status").asText());
        invoked = null;
        expect(400, "GET", "/projects/7/test-cases/20/requirements?projectId=8", null);
        assertNull(invoked);
        expect(405, "POST", "/projects/7/test-cases/20/requirements", "{}");
    }
    @Test void safeQaErrorsExposeFieldsAndKeepR1ReasonsWithoutExceptionText() throws Exception {
        var missing = expect(400,"POST","/projects/7/requirements","{\"priority\":\"HIGH\"}");
        assertEquals("INVALID_JSON",missing.at("/error/code").asText());
        assertEquals("QA_FIELD_REQUIRED",missing.at("/error/reasonCode").asText());
        assertEquals("title",missing.at("/error/field").asText());
        serviceFailure = new io.github.lz007001cn.veriqra.service.exception.ValidationException("title is required");
        var field = expect(400,"GET","/projects/7/requirements/10",null);
        assertEquals("VALIDATION",field.at("/error/code").asText());
        assertEquals("QA_FIELD_REQUIRED",field.at("/error/reasonCode").asText());
        assertEquals("title",field.at("/error/field").asText());
        serviceFailure = new io.github.lz007001cn.veriqra.service.exception.ConflictException("SQL password=private-token");
        var unknown = expect(409,"GET","/projects/7/requirements/10",null);
        assertEquals("QA_STATE_CONFLICT",unknown.at("/error/reasonCode").asText());
        assertFalse(unknown.toString().contains("SQL"));
        assertFalse(unknown.toString().contains("private-token"));
        serviceFailure = new io.github.lz007001cn.veriqra.service.exception.R1RuleException("STALE_VERSION");
        var r1 = expect(409,"GET","/projects/7/requirements/10",null);
        assertEquals("STALE_VERSION",r1.at("/error/reasonCode").asText());
        assertTrue(r1.at("/error/field").isNull() || r1.at("/error/field").isMissingNode());
    }
    @Test void malformedMissingNullAndWrongTypesFailBeforeService() throws Exception {
        for(String body:List.of("{}",UPDATE_CASE.replace("\"expectedVersion\":4","\"expectedVersion\":null"),
                UPDATE_CASE.replace("\"expectedVersion\":4","\"expectedVersion\":-1"),
                UPDATE_CASE.replace("\"expectedVersion\":4","\"expectedVersion\":4.8"),
                UPDATE_CASE.replace("\"expectedVersion\":4","\"expectedVersion\":2147483648"),
                UPDATE_CASE.replace("\"expectedVersion\":4","\"expectedVersion\":\"4\""),
                UPDATE_CASE.replace("\"READY\"","\"UNKNOWN\""),
                UPDATE_CASE.replace("\"READY\"","1"),
                UPDATE_CASE.replace("\"steps\":[{\"stepOrder\":1,\"action\":\"do\",\"expectedResult\":\"ok\"}]","\"steps\":[null]"),
                UPDATE_CASE.replace("\"stepOrder\":1","\"stepOrder\":1.5"),
                UPDATE_CASE.replace("\"expectedVersion\":4","\"expectedVersion\":4,\"expectedVersion\":5"),
                UPDATE_CASE.substring(0,UPDATE_CASE.length()-1)+",\"actorUserId\":99}",
                UPDATE_CASE.substring(0,UPDATE_CASE.length()-1)+",\"role\":\"ADMIN\"}",
                "{broken")) {
            invoked=null;expect(400,"PUT","/projects/7/test-cases/20",body);assertNull(invoked,body);
        }
        expect(400,"POST","/projects/7/test-plans","{\"name\":\"p\",\"testCaseIds\":[null]}");
        invoked=null;
        expect(400,"POST","/projects/7/requirements","{\"title\":\"r\"}");
        assertNull(invoked);
        expect(400,"POST","/projects/7/test-plans/30/archive","{}");
        expect(400,"POST","/projects/7/test-plans/30/archive","{\"expectedVersion\":-1}");
        expect(400,"POST","/projects/7/requirements/10/test-cases/20","{\"userId\":99}");
        expect(400,"PUT","/projects/7/requirements/10","{\"title\":\"r\",\"status\":\"DRAFT\",\"priority\":\"HIGH\"}");
        expect(400,"PUT","/projects/7/requirements/10","{\"title\":\"r\",\"status\":\"DRAFT\",\"priority\":\"HIGH\",\"expectedVersion\":-1}");
        expect(400,"PUT","/projects/7/test-plans/30","{\"name\":\"p\",\"status\":\"DRAFT\",\"expectedVersion\":-1}");
    }
    @Test void authenticationHeaderAndUnknownRouteBoundaries() throws Exception {
        assertEquals(403,call("PUT","/projects/7/test-cases/20",UPDATE_CASE,false).statusCode());
        expect(405,"DELETE","/projects/7/test-cases/20",null);
        expect(404,"POST","/projects/7/test-cases/20/steps","{}");
        expect(404,"GET","/projects/7/test-plans/30/extra",null);
        expect(400,"GET","/projects/7/test-cases/9223372036854775808",null);
        cookie=null;
        expect(401,"GET","/projects/7/test-cases",null);
    }
}
