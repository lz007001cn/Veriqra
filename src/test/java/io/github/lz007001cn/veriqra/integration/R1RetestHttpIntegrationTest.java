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

/** Session-authenticated HTTP against the isolated MySQL fixture and real domain Services. */
class R1RetestHttpIntegrationTest extends R1ServiceFixture {
    @TempDir static Path directory;
    EmbeddedWebServer server;
    HttpClient client;
    String cookie, passwordHash;
    User admin, tester, developer, outsider;
    int testSequence;

    @BeforeAll void startHttp() throws Exception {
        var transactions = new JdbcServiceTransaction(tx);
        var daos = new JdbcServiceDaoFactory();
        var access = new ProjectAccessPolicy();
        server = new EmbeddedWebServer(directory, new WebServices(
                new DefaultAuthService(transactions, daos, new PasswordVerifier()),
                new DefaultProjectService(transactions, daos, access),
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
        var spec = new PBEKeySpec("r1-http-test-only".toCharArray(), salt, 600000, 256);
        try {
            passwordHash = "pbkdf2_sha256$600000$" + HexFormat.of().formatHex(salt) + "$" +
                    HexFormat.of().formatHex(SecretKeyFactory.getInstance("PBKDF2WithHmacSHA256").generateSecret(spec).getEncoded());
        } finally { spec.clearPassword(); }
    }
    @AfterAll void stopHttp() throws Exception { if (server != null) server.close(); }
    @BeforeEach void bootstrapAccounts() {
        cookie = null;
        testSequence++;
        admin = account("r1_admin_" + testSequence, SystemRole.ADMIN);
        tester = account("r1_tester_" + testSequence, SystemRole.USER);
        developer = account("r1_developer_" + testSequence, SystemRole.USER);
        outsider = account("r1_outsider_" + testSequence, SystemRole.USER);
    }
    User account(String name, SystemRole role) {
        return tx.inTransaction(c -> new JdbcUserDao(c).insert(
                new User(null, name, name, passwordHash, role, UserStatus.ACTIVE, null, null, null)));
    }
    void member(long project, User user, ProjectRole role, MembershipStatus status) {
        tx.inTransaction(c -> {
            var dao = new JdbcProjectMemberDao(c);
            var old = dao.find(project, user.id());
            if (old.isEmpty()) dao.add(new ProjectMember(project, user.id(), role, status, null, null, null));
            else {
                var value = old.get();
                dao.update(new ProjectMember(project, user.id(), role, status,
                        value.joinedAt(), value.updatedAt(), value.lockVersion()));
            }
            return null;
        });
    }
    HttpResponse<String> call(String method, String path, String body) throws Exception {
        return call(method, path, body, true, "http://" + URI.create(server.base()).getRawAuthority());
    }
    HttpResponse<String> call(String method, String path, String body, boolean marker, String origin) throws Exception {
        var request = HttpRequest.newBuilder(URI.create(server.base() + "/api" + path)).timeout(Duration.ofSeconds(15));
        if (marker) request.header("X-Veriqra-Request", "1");
        if (origin != null) request.header("Origin", origin);
        if (cookie != null) request.header("Cookie", cookie);
        if (body != null) request.header("Content-Type", "application/json");
        return client.send(request.method(method, body == null ? HttpRequest.BodyPublishers.noBody()
                : HttpRequest.BodyPublishers.ofString(body)).build(), HttpResponse.BodyHandlers.ofString());
    }
    JsonNode expect(int status, String method, String path, String body) throws Exception {
        var response = call(method, path, body);
        assertEquals(status, response.statusCode(), method + " " + path + ": " + response.body());
        if (status == 204) { assertEquals("", response.body()); return null; }
        return JsonMapperProvider.readerFor(JsonNode.class).readValue(response.body());
    }
    void login(User user) throws Exception {
        var response = call("POST", "/auth/login", "{\"username\":\"" + user.username() + "\",\"password\":\"r1-http-test-only\"}");
        assertEquals(200, response.statusCode(), response.body());
        cookie = response.headers().firstValue("set-cookie").orElseThrow().split(";", 2)[0];
    }
    static String base(long project) { return "/projects/" + project; }
    static String defectPath(long project, long defect) { return base(project) + "/defects/" + defect; }
    static String version(int value) { return "{\"expectedVersion\":" + value + "}"; }
    long project(String name) throws Exception {
        return expect(201, "POST", "/projects", "{\"projectKey\":\"" + name + "\",\"name\":\"" + name + "\"}").get("id").asLong();
    }
    long readyCase(long project) throws Exception {
        String fields = "\"title\":\"retained case\",\"description\":\"definition\",\"priority\":\"HIGH\",\"steps\":[{\"stepOrder\":1,\"action\":\"do\",\"expectedResult\":\"ok\"}]";
        var value = expect(201, "POST", base(project) + "/test-cases", "{" + fields + "}");
        long id = value.get("id").asLong();
        expect(200, "PUT", base(project) + "/test-cases/" + id,
                "{" + fields + ",\"status\":\"READY\",\"expectedVersion\":" + value.get("version").asInt() + "}");
        return id;
    }
    record RunRef(long project, long run, long runCase) {
        String path() { return base(project) + "/runs/" + run; }
        String attempts() { return path() + "/cases/" + runCase + "/attempts"; }
    }
    RunRef run(long project, long testCase) throws Exception {
        var value = expect(201, "POST", base(project) + "/runs", "{\"name\":\"retest run\",\"testCaseIds\":[" + testCase + "]}");
        long id = value.get("id").asLong();
        return new RunRef(project, id, expect(200, "GET", base(project) + "/runs/" + id, null).at("/cases/0/runCaseId").asLong());
    }
    long record(RunRef run, String outcome) throws Exception {
        return expect(201, "POST", run.attempts(), "{\"outcome\":\"" + outcome + "\",\"submissionKey\":\"" + UUID.randomUUID() + "\"}").get("id").asLong();
    }
    int defectVersion(String path) throws Exception { return expect(200, "GET", path, null).at("/defect/version").asInt(); }
    void resolve(String path) throws Exception {
        expect(204, "POST", path + "/start", version(defectVersion(path)));
        expect(204, "POST", path + "/resolve", "{\"resolutionNote\":\"fixed\",\"expectedVersion\":" + defectVersion(path) + "}");
    }
    record Flow(long project, long testCase, RunRef source, long failure, String defect) { }
    Flow resolvedFlow(String key) throws Exception {
        login(admin); long project = project(key), testCase = readyCase(project);
        member(project, tester, ProjectRole.TESTER, MembershipStatus.ACTIVE);
        member(project, developer, ProjectRole.DEVELOPER, MembershipStatus.ACTIVE);
        var source = run(project, testCase); long failure = record(source, "FAIL");
        long defect = expect(201, "POST", base(project) + "/defects", "{\"failureAttemptId\":" + failure +
                ",\"title\":\"bug\",\"severity\":\"HIGH\",\"priority\":\"HIGH\",\"assigneeId\":" + developer.id() + "}").get("id").asLong();
        String path = defectPath(project, defect);
        login(developer); resolve(path); login(tester);
        return new Flow(project, testCase, source, failure, path);
    }
    static String linkBody(long fail, long pass, int version, UUID key) {
        return "{\"failureAttemptId\":" + fail + ",\"passAttemptId\":" + pass + ",\"expectedVersion\":" + version +
                ",\"requestKey\":\"" + key + "\",\"reviewNote\":\"Actual later execution reviewed\",\"timingBasis\":\"MANUAL_SERVER_RECORD\"}";
    }
    long count(String table) {
        assertTrue(Set.of("test_attempts", "defect_retest_links", "defect_closure_receipts", "defect_closure_items").contains(table));
        return tx.inTransaction(c -> {
            try (var s = c.createStatement(); var r = s.executeQuery("SELECT COUNT(*) FROM " + table)) {
                assertTrue(r.next()); return r.getLong(1);
            }
        });
    }
    Map<String,Long> facts() {
        var counts = new LinkedHashMap<String,Long>();
        for (String table : List.of("test_attempts", "defect_retest_links", "defect_closure_receipts", "defect_closure_items"))
            counts.put(table, count(table));
        return counts;
    }
    @Test void completedOriginalClosesThroughExplicitCrossRunPassAndKeepsReceipt() throws Exception {
        var flow = resolvedFlow("HTTPCHAIN");
        var original = expect(200, "GET", flow.source().attempts(), null);
        expect(204, "POST", flow.source().path() + "/complete", version(0));
        var retest = run(flow.project(), flow.testCase()); long pass = record(retest, "PASS");
        var beforeReads = facts(); int initialVersion = defectVersion(flow.defect());
        var blocked = expect(200, "GET", flow.defect() + "/closure-eligibility", null);
        assertFalse(blocked.get("canClose").asBoolean());
        var candidates = expect(200, "GET", flow.defect() + "/retest-candidates?failureAttemptId=" + flow.failure(), null);
        assertTrue(candidates.get("candidates").isArray());
        assertTrue(candidates.get("candidates").toString().contains("\"id\":" + pass));
        var impact = expect(200, "GET", flow.source().path() + "/completion-impact", null);
        assertEquals(1, impact.at("/outcomes/FAIL").asLong());
        assertEquals(1, impact.get("openDefectCount").asLong());
        assertEquals(1, impact.get("pendingRetestDefectCount").asLong());
        assertEquals(beforeReads, facts(), "GET must not create business facts");
        assertEquals(initialVersion, defectVersion(flow.defect()));
        var key = UUID.randomUUID(); String body = linkBody(flow.failure(), pass, initialVersion, key);
        var linked = expect(200, "POST", flow.defect() + "/retests", body);
        long link = linked.at("/link/id").asLong(); assertTrue(link > 0);
        assertEquals(initialVersion + 1, linked.get("resultDefectVersion").asInt());
        long links = count("defect_retest_links");
        var recovered = expect(200, "GET", flow.defect() + "/retest-operations/" + key + "?action=LINK", null);
        assertEquals(link, recovered.at("/link/id").asLong());
        assertEquals(link, expect(200, "POST", flow.defect() + "/retests", body).at("/link/id").asLong());
        assertEquals(links, count("defect_retest_links"));
        expect(409, "POST", flow.defect() + "/retests", body.replace("Actual later execution reviewed", "Different payload"));
        assertTrue(expect(200, "GET", flow.defect() + "/closure-eligibility", null).get("canClose").asBoolean());
        expect(204, "POST", flow.defect() + "/close", version(defectVersion(flow.defect())));
        assertEquals("CLOSED", expect(200, "GET", flow.defect(), null).at("/defect/status").asText());
        var receipt = expect(200, "GET", flow.defect() + "/closure-eligibility", null).get("history");
        assertEquals(1, receipt.size()); assertEquals(link, receipt.at("/0/items/0/retestLinkId").asLong());
        assertEquals(flow.failure(), receipt.at("/0/items/0/failure/attempt/id").asLong());
        assertEquals(pass, receipt.at("/0/items/0/pass/attempt/id").asLong());
        assertEquals(original, expect(200, "GET", flow.source().attempts(), null));
        assertEquals("COMPLETED", expect(200, "GET", flow.source().path(), null).at("/run/status").asText());
        record(retest, "FAIL");
        assertEquals(receipt, expect(200, "GET", flow.defect() + "/closure-eligibility", null).get("history"));
    }
    @Test void revokeReplaceAndUncertainResponseRecoveryRemainScopedAndVersioned() throws Exception {
        var flow = resolvedFlow("HTTPOPS");
        var firstRun = run(flow.project(), flow.testCase()); long firstPass = record(firstRun, "PASS");
        var firstKey = UUID.randomUUID();
        var first = expect(200, "POST", flow.defect() + "/retests",
                linkBody(flow.failure(), firstPass, defectVersion(flow.defect()), firstKey));
        long firstId = first.at("/link/id").asLong();
        var secondRun = run(flow.project(), flow.testCase()); long secondPass = record(secondRun, "PASS");
        var replacementKey = UUID.randomUUID();
        String replacement = linkBody(flow.failure(), secondPass, defectVersion(flow.defect()), replacementKey)
                .replace("}", ",\"oldLinkId\":" + firstId + ",\"revokeReason\":\"Use newer actual pass\"}");
        var replaced = expect(200, "POST", flow.defect() + "/retests", replacement);
        long secondId = replaced.at("/link/id").asLong();
        assertEquals(firstId, replaced.get("replacedLinkId").asLong());
        var recovered = expect(200, "GET", flow.defect() + "/retest-operations/" + replacementKey + "?action=LINK", null);
        assertEquals(secondId, recovered.at("/link/id").asLong());
        expect(404, "GET", flow.defect() + "/retest-operations/" + replacementKey + "?action=REVOKE", null);
        var revokeKey = UUID.randomUUID();
        String revoke = "{\"expectedVersion\":" + defectVersion(flow.defect()) + ",\"requestKey\":\"" + revokeKey + "\",\"reason\":\"Incorrect reviewed link\"}";
        var revoked = expect(200, "POST", flow.defect() + "/retests/" + secondId + "/revoke", revoke);
        assertEquals("REVOKE", revoked.get("action").asText());
        assertEquals("REVOKE", revoked.at("/link/revocation/operation").asText());
        int resultVersion = revoked.get("resultDefectVersion").asInt();
        assertEquals(resultVersion, expect(200, "POST", flow.defect() + "/retests/" + secondId + "/revoke", revoke).get("resultDefectVersion").asInt());
        assertEquals(resultVersion, expect(200, "GET", flow.defect() + "/retest-operations/" + revokeKey + "?action=REVOKE", null).get("resultDefectVersion").asInt());
        expect(404, "GET", flow.defect() + "/retest-operations/" + revokeKey + "?action=LINK", null);
        expect(409, "POST", flow.defect() + "/close", version(resultVersion));
        assertFalse(expect(200, "GET", flow.defect() + "/closure-eligibility", null).get("canClose").asBoolean());
        var retained = expect(409, "POST", flow.defect() + "/evidence/" + flow.failure() + "/remove", version(resultVersion));
        assertEquals("EVIDENCE_RETAINED", retained.at("/error/reasonCode").asText());
        assertEquals(resultVersion, defectVersion(flow.defect()));
        login(outsider);
        expect(403, "GET", flow.defect() + "/retest-operations/" + firstKey + "?action=LINK", null);
    }
    @Test void sessionCsrfLiveRolesAndProjectIsolationProtectEveryNewRoute() throws Exception {
        var flow = resolvedFlow("HTTPROLES");
        var retest = run(flow.project(), flow.testCase()); long pass = record(retest, "PASS");
        String body = linkBody(flow.failure(), pass, defectVersion(flow.defect()), UUID.randomUUID());
        var before = facts();
        assertEquals(403, call("POST", flow.defect() + "/retests", body, false, null).statusCode());
        assertEquals(403, call("POST", flow.defect() + "/retests", body, true, "https://foreign.example").statusCode());
        login(developer);
        expect(200, "GET", flow.defect() + "/closure-eligibility", null);
        expect(200, "GET", flow.defect() + "/retest-candidates?failureAttemptId=" + flow.failure(), null);
        expect(200, "GET", flow.source().path() + "/completion-impact", null);
        expect(403, "POST", flow.defect() + "/retests", body);
        expect(403, "POST", flow.defect() + "/close", version(defectVersion(flow.defect())));
        login(outsider);
        expect(403, "GET", flow.defect() + "/closure-eligibility", null);
        expect(403, "GET", flow.defect() + "/retest-candidates?failureAttemptId=" + flow.failure(), null);
        expect(403, "GET", flow.source().path() + "/completion-impact", null);
        login(admin); long otherProject = project("HTTPOTHER");
        String wrong = flow.defect().replace(base(flow.project()), base(otherProject));
        expect(400, "GET", wrong + "/closure-eligibility", null);
        expect(400, "GET", wrong + "/retest-candidates?failureAttemptId=" + flow.failure(), null);
        expect(400, "POST", wrong + "/retests", body);
        expect(400, "GET", base(otherProject) + "/runs/" + flow.source().run() + "/completion-impact", null);
        member(flow.project(), tester, ProjectRole.TESTER, MembershipStatus.INACTIVE);
        login(tester);
        expect(403, "POST", flow.defect() + "/retests", body);
        expect(403, "GET", flow.defect() + "/closure-eligibility", null);
        cookie = null;
        expect(401, "GET", flow.defect() + "/closure-eligibility", null);
        expect(401, "POST", flow.defect() + "/retests", body);
        assertEquals(before, facts(), "Rejected actions must not create business facts");
    }
    @Test void staleVersionAndNewFailureOverridePrecheckAtTheCloseTransaction() throws Exception {
        var flow = resolvedFlow("HTTPSTALE");
        var retest = run(flow.project(), flow.testCase()); long pass = record(retest, "PASS");
        int oldVersion = defectVersion(flow.defect());
        expect(200, "POST", flow.defect() + "/retests", linkBody(flow.failure(), pass, oldVersion, UUID.randomUUID()));
        var stale = expect(409, "POST", flow.defect() + "/close", version(oldVersion));
        assertEquals("STALE_VERSION", stale.at("/error/reasonCode").asText());
        assertTrue(expect(200, "GET", flow.defect() + "/closure-eligibility", null).get("canClose").asBoolean());
        var thirdRun = run(flow.project(), flow.testCase()); record(thirdRun, "FAIL");
        var refused = expect(409, "POST", flow.defect() + "/close", version(defectVersion(flow.defect())));
        assertEquals("LATER_NON_PASS", refused.at("/error/reasonCode").asText());
        assertEquals("RESOLVED", expect(200, "GET", flow.defect(), null).at("/defect/status").asText());
        assertEquals(0, expect(200, "GET", flow.defect() + "/closure-eligibility", null).get("history").size());
    }
}
