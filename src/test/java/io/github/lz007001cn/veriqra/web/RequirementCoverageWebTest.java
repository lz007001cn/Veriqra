package io.github.lz007001cn.veriqra.web;

import io.github.lz007001cn.veriqra.model.*;
import io.github.lz007001cn.veriqra.service.*;
import io.github.lz007001cn.veriqra.service.auth.AuthenticatedUser;
import org.junit.jupiter.api.*;
import org.junit.jupiter.api.io.TempDir;
import java.net.URI;
import java.net.http.*;
import java.nio.file.Path;
import java.util.*;
import static org.junit.jupiter.api.Assertions.*;

@TestInstance(TestInstance.Lifecycle.PER_CLASS)
class RequirementCoverageWebTest {
    @TempDir static Path directory;
    EmbeddedWebServer server;
    HttpClient client;
    String cookie;
    int reads;
    private static <T> T unused(Class<T> type) {
        return WebFoundationTest.proxy(type, (o, m, a) -> { throw new AssertionError("Unexpected " + m.getName()); });
    }
    @BeforeAll void start() throws Exception {
        AuthService auth = new AuthService() {
            public AuthenticatedUser authenticate(String username, String password) { return current(1L); }
            public AuthenticatedUser current(Long actor) { return new AuthenticatedUser(actor, "tester", SystemRole.USER, UserStatus.ACTIVE); }
        };
        TraceabilityService trace = WebFoundationTest.proxy(TraceabilityService.class, (o, m, a) -> {
            assertEquals("listCoverageByProject", m.getName());
            assertArrayEquals(new Object[]{1L, 7L}, a); reads++;
            return List.of(new RequirementCoverage(10L, 2), new RequirementCoverage(11L, 0));
        });
        server = new EmbeddedWebServer(directory, new WebServices(auth, unused(ProjectService.class), unused(RequirementService.class),
                unused(TestCaseService.class), trace, unused(TestPlanService.class), unused(TestRunService.class),
                unused(TestExecutionService.class), unused(DefectService.class), unused(AutomationService.class), unused(TestImportService.class)));
        client = HttpClient.newHttpClient();
    }
    @AfterAll void stop() throws Exception { if (client != null) client.close(); if (server != null) server.close(); }
    @BeforeEach void login() throws Exception {
        cookie = null; reads = 0;
        var response = call("POST", "/auth/login", "{\"username\":\"tester\",\"password\":\"fixture-only\"}");
        assertEquals(200, response.statusCode());
        cookie = response.headers().firstValue("set-cookie").orElseThrow().split(";", 2)[0];
    }
    HttpResponse<String> call(String method, String path, String body) throws Exception {
        URI address = URI.create(server.base() + "/api" + path);
        var request = HttpRequest.newBuilder(address).header("Origin", "http://" + address.getRawAuthority()).header("X-Veriqra-Request", "1");
        if (cookie != null) request.header("Cookie", cookie);
        if (body != null) request.header("Content-Type", "application/json");
        return client.send(request.method(method, body == null ? HttpRequest.BodyPublishers.noBody() : HttpRequest.BodyPublishers.ofString(body)).build(), HttpResponse.BodyHandlers.ofString());
    }
    @Test void projectCoverageIsOneReadWithStableMinimalNumericRows() throws Exception {
        var response = call("GET", "/projects/7/requirements/coverage", null);
        assertEquals(200, response.statusCode());
        assertEquals("[{\"requirementId\":10,\"confirmedCaseCount\":2},{\"requirementId\":11,\"confirmedCaseCount\":0}]", response.body());
        assertEquals(1, reads);
    }
    @Test void coverageRouteRejectsWritesAndUnsupportedQueriesBeforeDispatch() throws Exception {
        assertEquals(405, call("POST", "/projects/7/requirements/coverage", "{}").statusCode());
        assertEquals(400, call("GET", "/projects/7/requirements/coverage?status=CONFIRMED", null).statusCode());
        assertEquals(0, reads);
    }
}
