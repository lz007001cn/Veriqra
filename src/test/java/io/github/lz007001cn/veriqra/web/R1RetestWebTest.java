package io.github.lz007001cn.veriqra.web;

import com.fasterxml.jackson.databind.JsonNode;
import io.github.lz007001cn.veriqra.model.*;
import io.github.lz007001cn.veriqra.service.*;
import io.github.lz007001cn.veriqra.service.auth.*;
import io.github.lz007001cn.veriqra.service.command.*;
import io.github.lz007001cn.veriqra.service.exception.*;
import io.github.lz007001cn.veriqra.web.json.JsonMapperProvider;
import org.junit.jupiter.api.*;
import org.junit.jupiter.api.io.TempDir;
import java.net.*;
import java.net.http.*;
import java.nio.file.Path;
import java.time.Duration;
import java.util.*;
import static org.junit.jupiter.api.Assertions.*;

/** Real HTTP boundary tests. Scope/role and database rules are separately proved by the MySQL tests. */
@TestInstance(TestInstance.Lifecycle.PER_CLASS)
class R1RetestWebTest {
    @TempDir static Path directory;
    EmbeddedWebServer server;
    HttpClient client;
    String cookie, invoked;
    Object[] arguments;
    RuntimeException serviceFailure;
    static final String DEFECT = "/projects/7/defects/70";
    static final String RUN = "/projects/7/runs/40";
    static final String KEY = "12345678-1234-1234-1234-123456789012";
    static final String LINK = "{\"failureAttemptId\":60,\"passAttemptId\":61,\"expectedVersion\":2,\"requestKey\":\"" + KEY +
            "\",\"reviewNote\":\"Reviewed actual retest\",\"timingBasis\":\"MANUAL_SERVER_RECORD\"}";
    static final String REVOKE = "{\"expectedVersion\":3,\"requestKey\":\"" + KEY + "\",\"reason\":\"Wrong selection\"}";

    @BeforeAll void start() throws Exception {
        AuthService auth = new AuthService() {
            public AuthenticatedUser authenticate(String u, String p) { return current(1L); }
            public AuthenticatedUser current(Long id) { return new AuthenticatedUser(id, "tester", SystemRole.USER, UserStatus.ACTIVE); }
        };
        var defects = WebFoundationTest.proxy(DefectService.class, (o, m, a) -> {
            capture(m.getName(), a);
            return m.getName().equals("recoverRetestOperation") ? Optional.empty() : null;
        });
        var runs = WebFoundationTest.proxy(TestRunService.class, (o, m, a) -> {
            capture(m.getName(), a); return null;
        });
        server = new EmbeddedWebServer(directory, new WebServices(auth, unused(ProjectService.class), unused(RequirementService.class),
                unused(TestCaseService.class), unused(TraceabilityService.class), unused(TestPlanService.class), runs,
                unused(TestExecutionService.class), defects, unused(AutomationService.class), unused(TestImportService.class)));
        client = HttpClient.newBuilder().connectTimeout(Duration.ofSeconds(5)).build();
    }
    static <T> T unused(Class<T> type) {
        return WebFoundationTest.proxy(type, (o, m, a) -> { throw new AssertionError("Unexpected Service"); });
    }
    void capture(String name, Object[] args) {
        invoked = name; arguments = args;
        if (serviceFailure != null) throw serviceFailure;
    }
    @AfterAll void stop() throws Exception { if (server != null) server.close(); }
    @BeforeEach void login() throws Exception {
        serviceFailure = null; cookie = null;
        var response = call("POST", "/auth/login", "{\"username\":\"test\",\"password\":\"test-only\"}", true, null);
        assertEquals(200, response.statusCode());
        cookie = response.headers().firstValue("set-cookie").orElseThrow().split(";", 2)[0];
        invoked = null; arguments = null;
    }
    HttpResponse<String> call(String method, String path, String body, boolean marker, String origin) throws Exception {
        var request = HttpRequest.newBuilder(URI.create(server.base() + "/api" + path)).timeout(Duration.ofSeconds(15));
        request.header("Origin", origin == null ? "http://" + URI.create(server.base()).getRawAuthority() : origin);
        if (cookie != null) request.header("Cookie", cookie);
        if (marker) request.header("X-Veriqra-Request", "1");
        if (body != null) request.header("Content-Type", "application/json");
        return client.send(request.method(method, body == null ? HttpRequest.BodyPublishers.noBody()
                : HttpRequest.BodyPublishers.ofString(body)).build(), HttpResponse.BodyHandlers.ofString());
    }
    JsonNode expect(int status, String method, String path, String body) throws Exception {
        var response = call(method, path, body, true, null);
        assertEquals(status, response.statusCode(), method + " " + path + ": " + response.body());
        if (status == 204) { assertEquals("", response.body()); return null; }
        return JsonMapperProvider.readerFor(JsonNode.class).readValue(response.body());
    }
    void rejected(String path, String body) throws Exception {
        invoked = null; arguments = null;
        expect(400, "POST", path, body); assertNull(invoked, body);
    }
    @Test void routesDelegateActorAndScopeAndCompleteExactCommands() throws Exception {
        expect(200, "GET", DEFECT + "/closure-eligibility", null);
        assertEquals("closureEligibility", invoked); assertArrayEquals(new Object[]{1L, 7L, 70L}, arguments);
        expect(200, "GET", DEFECT + "/retest-candidates?failureAttemptId=60", null);
        assertEquals("retestCandidates", invoked); assertArrayEquals(new Object[]{1L, 7L, 70L, 60L, null, 25}, arguments);
        expect(200, "GET", DEFECT + "/retest-candidates?failureAttemptId=60&cursor=61&pageSize=100", null);
        assertArrayEquals(new Object[]{1L, 7L, 70L, 60L, 61L, 100}, arguments);
        expect(200, "POST", DEFECT + "/retests", LINK);
        assertEquals("linkRetest", invoked); assertEquals(1L, arguments[0]); assertEquals(7L, arguments[1]);
        assertEquals(new LinkRetestCommand(70L, 60L, 61L, 2, UUID.fromString(KEY), "Reviewed actual retest",
                DefectRetestTimingBasis.MANUAL_SERVER_RECORD, null, null), arguments[2]);
        expect(200, "POST", DEFECT + "/retests", LINK.replace("}", ",\"oldLinkId\":80,\"revokeReason\":\"Wrong selection\"}"));
        assertEquals(80L, ((LinkRetestCommand) arguments[2]).oldLinkId());
        expect(200, "POST", DEFECT + "/retests/80/revoke", REVOKE);
        assertEquals("revokeRetest", invoked);
        assertEquals(new RevokeRetestCommand(70L, 80L, 3, UUID.fromString(KEY), "Wrong selection"), arguments[2]);
        expect(404, "GET", DEFECT + "/retest-operations/" + KEY + "?action=LINK", null);
        assertEquals("recoverRetestOperation", invoked);
        assertArrayEquals(new Object[]{1L, 7L, 70L, UUID.fromString(KEY), "LINK"}, arguments);
        expect(200, "GET", RUN + "/completion-impact", null);
        assertEquals("completionImpact", invoked); assertArrayEquals(new Object[]{1L, 7L, 40L}, arguments);
        expect(204, "POST", DEFECT + "/evidence", "{\"failureAttemptId\":62,\"expectedVersion\":4}");
        assertArrayEquals(new Object[]{1L, 7L, 70L, 62L, 4}, arguments);
        expect(204, "POST", DEFECT + "/evidence/62/remove", "{\"expectedVersion\":5}");
        assertArrayEquals(new Object[]{1L, 7L, 70L, 62L, 5}, arguments);
    }
    @Test void readQueryShapesAndMethodsAreStrictAndNeverReachTheService() throws Exception {
        for (String suffix : List.of("", "?failureAttemptId=0", "?failureAttemptId=-1", "?failureAttemptId=01", "?failureAttemptId=1.0",
                "?failureAttemptId=60&failureAttemptId=61", "?failureAttemptId=60&cursor=0", "?failureAttemptId=60&cursor=",
                "?failureAttemptId=60&pageSize=0", "?failureAttemptId=60&pageSize=101", "?failureAttemptId=60&pageSize=2147483648",
                "?failureAttemptId=60&projectId=8")) {
            invoked = null; expect(400, "GET", DEFECT + "/retest-candidates" + suffix, null); assertNull(invoked);
        }
        for (String suffix : List.of("", "?action=", "?action=REPLACE", "?action=link", "?action=LINK&action=REVOKE", "?action=LINK&actorUserId=2")) {
            invoked = null; expect(400, "GET", DEFECT + "/retest-operations/" + KEY + suffix, null); assertNull(invoked);
        }
        invoked = null;
        expect(400, "GET", DEFECT + "/retest-operations/1-1-1-1-1?action=LINK", null);
        expect(400, "GET", DEFECT + "/closure-eligibility?expectedVersion=1", null);
        expect(400, "GET", RUN + "/completion-impact?actorUserId=2", null);
        expect(405, "POST", DEFECT + "/closure-eligibility", "{}");
        expect(405, "GET", DEFECT + "/retests", null);
        expect(405, "GET", DEFECT + "/retests/80/revoke", null);
        expect(405, "POST", RUN + "/completion-impact", "{}");
        assertNull(invoked);
    }
    @Test void typedBusinessReasonsAreSafeAndOrdinaryExceptionTextIsHidden() throws Exception {
        serviceFailure = new R1RuleException("LATEST_NOT_PASS");
        var error = expect(409, "POST", DEFECT + "/retests", LINK);
        assertEquals("CONFLICT", error.at("/error/code").asText());
        assertEquals("LATEST_NOT_PASS", error.at("/error/reasonCode").asText());
        assertEquals("Request conflicts with current state", error.at("/error/message").asText());
        serviceFailure = new ConflictException("credential-secret-should-never-leak");
        error = expect(409, "POST", DEFECT + "/retests", LINK);
        assertFalse(error.toString().contains("credential-secret"));
        // R2 adds a fixed manual-QA correction hint; the original exception remains hidden.
        assertEquals("QA_STATE_CONFLICT", error.at("/error/reasonCode").asText());
        assertTrue(error.at("/error/field").isNull());
        serviceFailure = new ValidationException("credential-secret-should-never-leak");
        assertFalse(expect(400, "POST", DEFECT + "/retests", LINK).toString().contains("credential-secret"));
    }
    @Test void callerCannotForgeRetestActorScopePolicyOrResult() throws Exception {
        for (String field : List.of("actorUserId", "projectId", "defectId", "projectRole", "linkedBy", "policyVersion", "resultDefectVersion"))
            rejected(DEFECT + "/retests", LINK.replace("}", ",\"" + field + "\":1}"));
        rejected(DEFECT + "/retests", LINK + " {}");
        rejected(DEFECT + "/retests", LINK.replace("\"passAttemptId\":61", "\"passAttemptId\":61,\"passAttemptId\":62"));
    }
    @Test void versionsIdsAndKeysUseStrictTypesAndBounds() throws Exception {
        for (String value : List.of("-1", "null", "1.5", "\"2\"", "2147483648")) {
            rejected(DEFECT + "/retests", LINK.replace("\"expectedVersion\":2", "\"expectedVersion\":" + value));
            rejected(DEFECT + "/retests/80/revoke", REVOKE.replace("\"expectedVersion\":3", "\"expectedVersion\":" + value));
        }
        for (String field : List.of("failureAttemptId", "passAttemptId"))
            for (String value : List.of("0", "-1", "null", "1.5", "\"60\"", "9223372036854775808"))
                rejected(DEFECT + "/retests", LINK.replace("\"" + field + "\":" + (field.equals("failureAttemptId") ? "60" : "61"),
                        "\"" + field + "\":" + value));
        for (String key : List.of("invalid", "1-1-1-1-1", "12345678123412341234123456789012", " ", "MTIzNDU2Nzg5MDEyMzQ1Ng==")) {
            rejected(DEFECT + "/retests", LINK.replace(KEY, key));
            rejected(DEFECT + "/retests/80/revoke", REVOKE.replace(KEY, key));
        }
        rejected(DEFECT + "/retests", LINK.replace(",\"requestKey\":\"" + KEY + "\"", ""));
        rejected(DEFECT + "/retests", LINK.replace(",\"expectedVersion\":2", ""));
    }
    @Test void reviewsAndReplacementShapesRejectMissingBlankAndOversizeFields() throws Exception {
        for (String note : List.of("", " ", "x".repeat(2001))) {
            rejected(DEFECT + "/retests", LINK.replace("Reviewed actual retest", note));
            rejected(DEFECT + "/retests/80/revoke", REVOKE.replace("Wrong selection", note));
        }
        rejected(DEFECT + "/retests", LINK.replace(",\"timingBasis\":\"MANUAL_SERVER_RECORD\"", ""));
        rejected(DEFECT + "/retests", LINK.replace("MANUAL_SERVER_RECORD", "EXTERNAL_TIMESTAMP"));
        rejected(DEFECT + "/retests", LINK.replace("}", ",\"oldLinkId\":80}"));
        rejected(DEFECT + "/retests", LINK.replace("}", ",\"revokeReason\":\"wrong\"}"));
        rejected(DEFECT + "/retests", LINK.replace("}", ",\"oldLinkId\":0,\"revokeReason\":\"wrong\"}"));
    }
    @Test void sessionOriginAndCsrfMarkerApplyToRetestWrites() throws Exception {
        assertEquals(403, call("POST", DEFECT + "/retests", LINK, false, null).statusCode());
        assertNull(invoked);
        assertEquals(403, call("POST", DEFECT + "/retests", LINK, true, "https://foreign.example").statusCode());
        assertNull(invoked);
        cookie = null;
        expect(401, "GET", DEFECT + "/closure-eligibility", null);
        expect(401, "POST", DEFECT + "/retests", LINK);
        assertNull(invoked);
    }
    @Test void evidenceCorrectionsRequireExplicitVersionsAndPositiveSourceIds() throws Exception {
        rejected(DEFECT + "/evidence", "{\"failureAttemptId\":60}");
        rejected(DEFECT + "/evidence/60/remove", "{}");
        for (String value : List.of("-1", "null", "\"1\"", "1.5", "2147483648")) {
            rejected(DEFECT + "/evidence", "{\"failureAttemptId\":60,\"expectedVersion\":" + value + "}");
            rejected(DEFECT + "/evidence/60/remove", "{\"expectedVersion\":" + value + "}");
        }
        rejected(DEFECT + "/evidence", "{\"failureAttemptId\":0,\"expectedVersion\":0}");
        invoked = null;
        expect(400, "POST", DEFECT + "/evidence/0/remove", "{\"expectedVersion\":0}");
        assertNull(invoked);
    }
    @Test void relatedDefectBodiesRejectNonpositiveIdsAndOversizeTitlesBeforeTheService() throws Exception {
        String create = "{\"failureAttemptId\":60,\"title\":\"bug\",\"severity\":\"HIGH\",\"priority\":\"HIGH\"}";
        for (String value : List.of("0", "-1")) {
            rejected("/projects/7/defects", create.replace("\"failureAttemptId\":60", "\"failureAttemptId\":" + value));
            rejected("/projects/7/defects", create.replace("}", ",\"assigneeId\":" + value + "}"));
            rejected(DEFECT + "/reopen", "{\"expectedVersion\":2,\"failureAttemptId\":" + value + ",\"assigneeId\":1}");
            rejected(DEFECT + "/reopen", "{\"expectedVersion\":2,\"failureAttemptId\":60,\"assigneeId\":" + value + "}");
            invoked = null;
            expect(400, "PUT", DEFECT, "{\"title\":\"bug\",\"severity\":\"HIGH\",\"priority\":\"HIGH\",\"expectedVersion\":2,\"assigneeId\":" + value + "}");
            assertNull(invoked);
        }
        rejected("/projects/7/defects", create.replace("bug", "x".repeat(241)));
        invoked = null;
        expect(400, "PUT", DEFECT, "{\"title\":\"" + "x".repeat(241) + "\",\"severity\":\"HIGH\",\"priority\":\"HIGH\",\"expectedVersion\":2}");
        assertNull(invoked);
    }
}
