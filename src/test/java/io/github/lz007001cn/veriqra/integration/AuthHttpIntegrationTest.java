package io.github.lz007001cn.veriqra.integration;

import io.github.lz007001cn.veriqra.dao.jdbc.*;
import io.github.lz007001cn.veriqra.model.*;
import io.github.lz007001cn.veriqra.web.json.JsonMapperProvider;
import org.apache.catalina.Context;
import org.apache.catalina.startup.Tomcat;
import org.junit.jupiter.api.*;
import org.junit.jupiter.api.io.TempDir;
import javax.crypto.SecretKeyFactory;
import javax.crypto.spec.PBEKeySpec;
import java.net.*;
import java.net.http.*;
import java.nio.file.*;
import java.time.Duration;
import java.util.*;
import static org.junit.jupiter.api.Assertions.*;

/** Actual deployment descriptor/listener/Servlet/Service/DAO/MySQL pipeline, on fixture-owned schema only. */
class AuthHttpIntegrationTest extends MysqlFixture {
    @TempDir static Path directory;
    Tomcat tomcat;
    HttpClient client;
    String base;
    String cookie;
    String hash;
    String previousConfig;
    User admin;
    User tester;
    User disabled;

    @BeforeAll void startWebApplication() throws Exception {
        // Fixture already validates local test URL, version, scoped account and empty schema.
        previousConfig = System.getProperty("veriqra.db.config");
        if (System.getenv("VERIQRA_DB_CONFIG") != null
                || System.getenv().keySet().stream().anyMatch(k -> k.startsWith("VERIQRA_DB_"))) {
            throw new IllegalStateException("Remove application DB environment overrides for isolated web tests");
        }
        Properties properties = new Properties();
        properties.setProperty("jdbcUrl", config.jdbcUrl());
        properties.setProperty("username", config.username());
        properties.setProperty("password", config.password());
        properties.setProperty("initialPoolSize", "1");
        properties.setProperty("maxPoolSize", "3");
        properties.setProperty("acquireTimeout", "2000");
        Path external = directory.resolve("database.local.properties");
        try (var writer = Files.newBufferedWriter(external)) { properties.store(writer, "Isolated test only"); }
        System.setProperty("veriqra.db.config", external.toString());
        tomcat = new Tomcat();
        // This API-only embedded runtime has no Jasper/JSP dependency.
        tomcat.setAddDefaultWebXmlToWebapp(false);
        tomcat.setBaseDir(directory.resolve("tomcat").toString());
        tomcat.setPort(0);
        tomcat.getConnector().setProperty("address", "127.0.0.1");
        Context context = tomcat.addWebapp("", Path.of("src/main/webapp").toAbsolutePath().toString());
        context.setParentClassLoader(getClass().getClassLoader());
        Tomcat.addServlet(context, "test-fault", new jakarta.servlet.http.HttpServlet() {
            @Override protected void doGet(jakarta.servlet.http.HttpServletRequest request,
                                           jakarta.servlet.http.HttpServletResponse response)
                    throws jakarta.servlet.ServletException {
                throw new jakarta.servlet.ServletException("Test-only static route failure");
            }
        });
        context.addServletMappingDecoded("/test-fault", "test-fault");
        tomcat.start();
        assertTrue(context.getState().isAvailable(), "Production deployment descriptor must start successfully");
        base = "http://127.0.0.1:" + tomcat.getConnector().getLocalPort() + "/api";
        client = HttpClient.newBuilder().connectTimeout(Duration.ofSeconds(5)).build();
        byte[] salt = new byte[16]; new java.security.SecureRandom().nextBytes(salt);
        PBEKeySpec spec = new PBEKeySpec("fixture-login-password".toCharArray(), salt, 600000, 256);
        try {
            hash = "pbkdf2_sha256$600000$" + HexFormat.of().formatHex(salt) + "$"
                    + HexFormat.of().formatHex(SecretKeyFactory.getInstance("PBKDF2WithHmacSHA256").generateSecret(spec).getEncoded());
        } finally { spec.clearPassword(); }
    }

    @AfterAll void stopWebApplication() throws Exception {
        try {
            if (tomcat != null) { try { tomcat.stop(); } finally { tomcat.destroy(); } }
        } finally {
            if (previousConfig == null) System.clearProperty("veriqra.db.config");
            else System.setProperty("veriqra.db.config", previousConfig);
        }
    }

    @BeforeEach void users() {
        cookie = null;
        admin = insert("web_admin", SystemRole.ADMIN, UserStatus.ACTIVE);
        tester = insert("web_tester", SystemRole.USER, UserStatus.ACTIVE);
        disabled = insert("web_disabled", SystemRole.USER, UserStatus.DISABLED);
    }
    User insert(String username, SystemRole role, UserStatus status) {
        return tx.inTransaction(c -> new JdbcUserDao(c).insert(new User(null, username, username, hash,
                role, status, null, null, null)));
    }
    HttpResponse<String> call(String method, String path, String body) throws Exception {
        var request = HttpRequest.newBuilder(URI.create(base + path)).timeout(Duration.ofSeconds(10))
                .header("X-Veriqra-Request", "1");
        request.header("Origin", "http://" + URI.create(base).getRawAuthority());
        if (cookie != null) request.header("Cookie", cookie);
        if (body != null) request.header("Content-Type", "application/json");
        return client.send(request.method(method, body == null ? HttpRequest.BodyPublishers.noBody()
                : HttpRequest.BodyPublishers.ofString(body)).build(), HttpResponse.BodyHandlers.ofString());
    }
    void login(User user) throws Exception {
        var response = call("POST", "/auth/login", "{\"username\":\"" + user.username() + "\",\"password\":\"fixture-login-password\"}");
        assertEquals(200, response.statusCode(), response.body());
        assertFalse(response.body().contains("password")); assertFalse(response.body().contains("lockVersion"));
        assertTrue(response.headers().firstValue("set-cookie").orElseThrow().contains("HttpOnly"));
        assertTrue(response.headers().firstValue("set-cookie").orElseThrow().contains("SameSite=Lax"));
        cookie = response.headers().firstValue("set-cookie").orElseThrow().split(";", 2)[0];
    }
    long createProject() throws Exception {
        login(admin);
        var response = call("POST", "/projects", "{\"projectKey\":\"WEB\",\"name\":\"中文项目\"}");
        assertEquals(201, response.statusCode(), response.body());
        return JsonMapperProvider.readerFor(com.fasterxml.jackson.databind.JsonNode.class)
                .<com.fasterxml.jackson.databind.JsonNode>readValue(response.body()).get("id").asLong();
    }

    @Test void realPasswordsDisabledUsersAndLogout() throws Exception {
        assertEquals(401, call("POST", "/auth/login", "{\"username\":\"非法\",\"password\":\"wrong\"}").statusCode());
        assertEquals(401, call("POST", "/auth/login", "{\"username\":\"web_admin\",\"password\":\"wrong\"}").statusCode());
        assertEquals(401, call("POST", "/auth/login", "{\"username\":\"missing\",\"password\":\"wrong\"}").statusCode());
        assertEquals(401, call("POST", "/auth/login", "{\"username\":\"web_disabled\",\"password\":\"fixture-login-password\"}").statusCode());
        login(admin);
        assertEquals(200, call("GET", "/auth/me", null).statusCode());
        assertEquals(204, call("POST", "/auth/logout", null).statusCode());
        assertEquals(401, call("GET", "/auth/me", null).statusCode());
    }

    @Test void frontendResourcesAndNamedContextUseRealAuthAndProjectApi() throws Exception {
        String root = "http://127.0.0.1:" + tomcat.getConnector().getLocalPort();
        assertFrontendResources(root);
        long projectId = createProject();
        Tomcat named = new Tomcat();
        named.setAddDefaultWebXmlToWebapp(false);
        named.setBaseDir(directory.resolve("named-tomcat").toString());
        named.setPort(0);
        named.getConnector().setProperty("address", "127.0.0.1");
        Context context = named.addWebapp("/veriqra", Path.of("src/main/webapp").toAbsolutePath().toString());
        context.setParentClassLoader(getClass().getClassLoader());
        try {
            named.start();
            assertTrue(context.getState().isAvailable());
            String origin = "http://127.0.0.1:" + named.getConnector().getLocalPort();
            String namedBase = origin + "/veriqra";
            assertFrontendResources(namedBase);
            var wrong = client.send(HttpRequest.newBuilder(URI.create(namedBase + "/api/auth/login"))
                    .header("Origin", origin).header("X-Veriqra-Request", "1")
                    .header("Content-Type", "application/json")
                    .POST(HttpRequest.BodyPublishers.ofString("{\"username\":\"web_admin\",\"password\":\"wrong\"}"))
                    .build(), HttpResponse.BodyHandlers.ofString());
            assertEquals(401, wrong.statusCode());
            assertFalse(wrong.body().contains("web_admin"));
            var login = client.send(HttpRequest.newBuilder(URI.create(namedBase + "/api/auth/login"))
                    .header("Origin", origin).header("X-Veriqra-Request", "1")
                    .header("Content-Type", "application/json")
                    .POST(HttpRequest.BodyPublishers.ofString("{\"username\":\"web_admin\",\"password\":\"fixture-login-password\"}"))
                    .build(), HttpResponse.BodyHandlers.ofString());
            assertEquals(200, login.statusCode(), login.body());
            String setCookie = login.headers().firstValue("Set-Cookie").orElseThrow();
            assertTrue(setCookie.contains("Path=/veriqra"));
            String session = setCookie.split(";", 2)[0];
            var me = client.send(HttpRequest.newBuilder(URI.create(namedBase + "/api/auth/me"))
                    .header("Cookie", session).GET().build(), HttpResponse.BodyHandlers.ofString());
            assertEquals(200, me.statusCode());
            assertTrue(me.body().contains("web_admin"));
            var projects = client.send(HttpRequest.newBuilder(URI.create(namedBase + "/api/projects"))
                    .header("Cookie", session).GET().build(), HttpResponse.BodyHandlers.ofString());
            assertEquals(200, projects.statusCode());
            assertTrue(projects.body().contains("中文项目"));
            var detail = client.send(HttpRequest.newBuilder(URI.create(namedBase + "/api/projects/" + projectId))
                    .header("Cookie", session).GET().build(), HttpResponse.BodyHandlers.ofString());
            assertEquals(200, detail.statusCode());
            var logout = client.send(HttpRequest.newBuilder(URI.create(namedBase + "/api/auth/logout"))
                    .header("Cookie", session).header("Origin", origin).header("X-Veriqra-Request", "1")
                    .POST(HttpRequest.BodyPublishers.noBody()).build(), HttpResponse.BodyHandlers.ofString());
            assertEquals(204, logout.statusCode());
            var after = client.send(HttpRequest.newBuilder(URI.create(namedBase + "/api/auth/me"))
                    .header("Cookie", session).GET().build(), HttpResponse.BodyHandlers.ofString());
            assertEquals(401, after.statusCode());
        } finally { try { named.stop(); } finally { named.destroy(); } }
    }

    void assertFrontendResources(String baseUrl) throws Exception {
        for (String path : List.of("/", "/login.html", "/index.html", "/assets/css/app.css",
                "/assets/js/api.js", "/assets/js/login.js", "/assets/js/app.js", "/assets/js/test-assets.js", "/assets/js/execution.js",
                "/assets/js/defects.js", "/assets/js/automation-imports.js",
                "/assets/vendor/jquery-3.7.1.min.js", "/assets/vendor/bootstrap-5.3.8.min.css",
                "/assets/vendor/bootstrap-5.3.8.bundle.min.js",
                "/admin/index.html", "/admin/users.html",
                "/admin/admin.css", "/admin/admin.js")) {
            var result = client.send(HttpRequest.newBuilder(URI.create(baseUrl + path)).GET().build(),
                    HttpResponse.BodyHandlers.ofString());
            assertEquals(200, result.statusCode(), path);
            assertFalse(result.body().isBlank(), path);
            if (path.endsWith(".html") || path.equals("/")) {
                assertTrue(result.headers().firstValue("Content-Type").orElse("").startsWith("text/html"), path);
            } else if (path.endsWith(".css")) {
                assertTrue(result.headers().firstValue("Content-Type").orElse("").startsWith("text/css"), path);
            } else if (path.endsWith(".js")) {
                assertTrue(result.headers().firstValue("Content-Type").orElse("").startsWith("application/javascript"), path);
            }
            if (path.endsWith(".html")) {
                assertFalse(result.body().contains("href=\"/api"));
                assertFalse(result.body().contains("src=\"/veriqra"));
            }
        }
        var apiJs = client.send(HttpRequest.newBuilder(URI.create(baseUrl + "/assets/js/api.js")).GET().build(),
                HttpResponse.BodyHandlers.ofString()).body();
        assertTrue(apiJs.contains("'X-Veriqra-Request': '1'"));
        assertTrue(apiJs.contains("new URL('api/'"));
        assertTrue(apiJs.contains("contentType: 'application/xml'"));
        assertTrue(apiJs.contains("processData: false"));
        assertFalse(apiJs.contains("'/api/"));
        var page = client.send(HttpRequest.newBuilder(URI.create(baseUrl + "/index.html")).GET().build(),
                HttpResponse.BodyHandlers.ofString()).body();
        assertTrue(page.contains("assets/js/test-assets.js"));
        assertTrue(page.contains("data-view=\"requirements\""));
        assertTrue(page.contains("data-view=\"test-cases\""));
        assertTrue(page.contains("assets/js/execution.js"));
        assertTrue(page.contains("data-view=\"test-plans\""));
        assertTrue(page.contains("data-view=\"runs\""));
        assertTrue(page.contains("assets/js/defects.js"));
        assertTrue(page.contains("assets/js/automation-imports.js"));
        assertTrue(page.contains("data-view=\"defects\""));
        assertTrue(page.contains("data-view=\"automation\""));
        assertTrue(page.contains("id=\"admin-entry\""));
        var assetsJs = client.send(HttpRequest.newBuilder(URI.create(baseUrl + "/assets/js/test-assets.js")).GET().build(),
                HttpResponse.BodyHandlers.ofString()).body();
        assertTrue(assetsJs.contains("window.VeriqraApi"));
        assertFalse(assetsJs.contains("'/api/"));
        assertFalse(assetsJs.contains("'/veriqra"));
        assertFalse(assetsJs.contains("innerHTML"));
        assertFalse(assetsJs.contains(".html("));
        var executionJs = client.send(HttpRequest.newBuilder(URI.create(baseUrl + "/assets/js/execution.js")).GET().build(),
                HttpResponse.BodyHandlers.ofString()).body();
        assertTrue(executionJs.contains("window.VeriqraApi"));
        assertTrue(executionJs.contains("snapshotTitle"));
        assertTrue(executionJs.contains("submissionKey"));
        assertFalse(executionJs.contains("'/api/"));
        assertFalse(executionJs.contains("'/veriqra"));
        assertFalse(executionJs.contains("innerHTML"));
        assertFalse(executionJs.contains(".html("));
        for (String script : List.of("defects.js", "automation-imports.js")) {
            var source = client.send(HttpRequest.newBuilder(URI.create(baseUrl + "/assets/js/" + script)).GET().build(),
                    HttpResponse.BodyHandlers.ofString()).body();
            assertTrue(source.contains("window.VeriqraApi"), script);
            assertFalse(source.contains("'/api/"), script);
            assertFalse(source.contains("innerHTML"), script);
            assertFalse(source.contains(".html("), script);
        }
        var adminJs = client.send(HttpRequest.newBuilder(URI.create(baseUrl + "/admin/admin.js")).GET().build(),
                HttpResponse.BodyHandlers.ofString()).body();
        assertTrue(adminJs.contains("window.VeriqraApi"));
        assertFalse(adminJs.contains("innerHTML"));
        assertFalse(adminJs.contains(".html("));
        assertFalse(adminJs.contains("'/api/"));
    }

    private static com.fasterxml.jackson.databind.JsonNode json(HttpResponse<String> response) throws Exception {
        return JsonMapperProvider.readerFor(com.fasterxml.jackson.databind.JsonNode.class)
                .readValue(response.body());
    }

    @Test void administrationRequiresLiveAdminAndProtectsUserSecrets() throws Exception {
        assertEquals(401, call("GET", "/admin/users", null).statusCode());
        login(tester);
        assertEquals(403, call("GET", "/admin/users", null).statusCode());
        assertEquals(403, call("POST", "/admin/users", "{}").statusCode());
        login(admin);
        var listing = call("GET", "/admin/users?pageSize=2", null);
        assertEquals(200, listing.statusCode(), listing.body());
        assertEquals(2, json(listing).get("items").size());
        assertFalse(listing.body().contains("passwordHash"));
        assertFalse(listing.body().contains("fixture-login-password"));
        var create = call("POST", "/admin/users", "{\"username\":\"web_created\",\"displayName\":\"Created User\",\"password\":\"new-user-password\",\"systemRole\":\"USER\",\"status\":\"ACTIVE\"}");
        assertEquals(201, create.statusCode(), create.body());
        assertFalse(create.body().contains("password"));
        assertFalse(json(create).has("creditBalance"));
        String requestId = create.headers().firstValue("X-Request-ID").orElseThrow();
        assertEquals(requestId, tx.inTransaction(c -> {
            try (var statement = c.prepareStatement("SELECT request_id FROM audit_logs WHERE action='USER_CREATED'" )) {
                try (var rows = statement.executeQuery()) { assertTrue(rows.next()); return rows.getString(1); }
            }
        }));
        assertEquals(409, call("POST", "/admin/users", "{\"username\":\"web_created\",\"displayName\":\"Duplicate\",\"password\":\"new-user-password\",\"systemRole\":\"USER\",\"status\":\"ACTIVE\"}").statusCode());
        long userId = json(create).get("id").asLong();
        var update = call("PATCH", "/admin/users/" + userId,
                "{\"displayName\":\"Renamed\",\"systemRole\":\"USER\",\"status\":\"DISABLED\",\"lockVersion\":0}");
        assertEquals(200, update.statusCode(), update.body());
        assertEquals("DISABLED", json(update).get("status").asText());
        assertEquals(409, call("PATCH", "/admin/users/" + admin.id(),
                "{\"displayName\":\"Admin\",\"systemRole\":\"USER\",\"status\":\"ACTIVE\",\"lockVersion\":0}").statusCode());
    }

    @Test void administrationKeepsUserMaintenanceAndBuildMetadataOnly() throws Exception {
        login(admin);
        for (String retired : List.of("dashboard", "credits", "login-history", "access-logs", "audit-logs", "sessions", "security")) {
            assertEquals(404, call("GET", "/admin/" + retired, null).statusCode(), retired);
        }
        assertEquals(404, call("POST", "/admin/users/" + tester.id() + "/credits/grant", "{\"amount\":100}").statusCode());
        var system = call("GET", "/admin/system", null);
        assertEquals(200, system.statusCode());
        var runtime = json(system);
        assertEquals(io.github.lz007001cn.veriqra.web.BuildInfo.current().version(), runtime.get("veriqraVersion").asText());
        assertTrue(runtime.get("buildCommit").asText().matches("[0-9a-f]{40}"));
        assertDoesNotThrow(() -> java.time.Instant.parse(runtime.get("buildTime").asText()));
        assertEquals("UP", runtime.get("databaseStatus").asText());
        assertEquals(35, runtime.get("databaseTableCount").asInt());
        assertEquals("Asia/Shanghai (UTC+8)", runtime.get("applicationTimeZone").asText());
        assertFalse(system.body().contains("jdbc:mysql"));
        assertFalse(system.body().contains("fixture-login-password"));
        login(tester);
        assertEquals(403, call("GET", "/admin/system", null).statusCode());
    }

    @Test void accessLogRecordsContainerGenerated500ForUncaughtStaticFailure() throws Exception {
        var failed = client.send(HttpRequest.newBuilder(URI.create(base.substring(0,base.length()-4) + "/test-fault"))
                .GET().build(), HttpResponse.BodyHandlers.ofString());
        assertEquals(500, failed.statusCode());
        tx.inTransaction(c -> {
            try (var statement = c.prepareStatement("SELECT request_path,status_code FROM access_logs WHERE status_code=500");
                 var rows = statement.executeQuery()) {
                assertTrue(rows.next());
                assertEquals("/test-fault", rows.getString(1));
                assertEquals(500, rows.getInt(2));
                assertFalse(rows.next());
            }
            return null;
        });
    }

    @Test void administrationWritesKeepOriginAndMarkerGate() throws Exception {
        login(admin);
        String uri = base + "/admin/users/" + tester.id() + "/reset-password";
        String payload = "{\"password\":\"replacement-user-password\"}";
        var noOrigin = client.send(HttpRequest.newBuilder(URI.create(uri))
                .header("Cookie", cookie).header("X-Veriqra-Request", "1")
                .header("Content-Type", "application/json")
                .POST(HttpRequest.BodyPublishers.ofString(payload)).build(), HttpResponse.BodyHandlers.ofString());
        assertEquals(403, noOrigin.statusCode());
        var wrongOrigin = client.send(HttpRequest.newBuilder(URI.create(uri))
                .header("Cookie", cookie).header("X-Veriqra-Request", "1").header("Origin", "https://example.invalid")
                .header("Content-Type", "application/json")
                .POST(HttpRequest.BodyPublishers.ofString(payload)).build(), HttpResponse.BodyHandlers.ofString());
        assertEquals(403, wrongOrigin.statusCode());
        var noMarker = client.send(HttpRequest.newBuilder(URI.create(uri))
                .header("Cookie", cookie).header("Origin", "http://" + URI.create(base).getRawAuthority())
                .header("Content-Type", "application/json")
                .POST(HttpRequest.BodyPublishers.ofString(payload)).build(), HttpResponse.BodyHandlers.ofString());
        assertEquals(403, noMarker.statusCode());
        assertEquals(204, call("POST", "/admin/users/" + tester.id() + "/reset-password", payload).statusCode());
        assertEquals(200, call("POST", "/auth/login", "{\"username\":\"web_tester\",\"password\":\"replacement-user-password\"}").statusCode());
    }

    @Test void loginTelemetryRecordsFailureAndRateLimitWithoutPassword() throws Exception {
        for (int attempt = 0; attempt < 5; attempt++) {
            assertEquals(401, call("POST", "/auth/login",
                    "{\"username\":\"rate_probe\",\"password\":\"never-log-this-password\"}").statusCode());
        }
        assertEquals(429, call("POST", "/auth/login",
                "{\"username\":\"rate_probe\",\"password\":\"never-log-this-password\"}").statusCode());
        tx.inTransaction(c -> {
            try (var statement = c.prepareStatement("SELECT result,failure_reason FROM login_events WHERE username_attempted='rate_probe'");
                 var rows = statement.executeQuery()) {
                List<String> results = new ArrayList<>();
                while (rows.next()) {
                    results.add(rows.getString(1));
                    assertFalse(Objects.toString(rows.getString(2), "").contains("never-log-this-password"));
                }
                assertEquals(6, results.size());
                assertTrue(results.contains("RATE_LIMITED"));
                assertTrue(results.contains("FAILURE"));
            }
            return null;
        });
    }

    @Test void realProjectRequirementValidationAndCurrentMembership() throws Exception {
        long project = createProject();
        assertEquals(409, call("POST", "/projects", "{\"projectKey\":\"WEB\",\"name\":\"duplicate\"}").statusCode());
        assertEquals(400, call("POST", "/projects", "{\"projectKey\":\"bad-key\",\"name\":\"x\"}").statusCode());
        assertEquals(404, call("GET", "/projects/9999999", null).statusCode());
        assertTrue(call("GET", "/projects", null).body().contains("中文项目"));
        tx.inTransaction(c -> new JdbcProjectMemberDao(c).add(new ProjectMember(project, tester.id(),
                ProjectRole.TESTER, MembershipStatus.ACTIVE, null, null, null)));
        login(tester);
        assertEquals(403, call("POST", "/projects", "{\"projectKey\":\"BAD\",\"name\":\"x\"}").statusCode());
        assertTrue(call("GET", "/projects", null).body().contains("中文项目"));
        assertEquals(201, call("POST", "/projects/" + project + "/requirements", "{\"title\":\"中文需求\",\"priority\":\"HIGH\"}").statusCode());
        assertTrue(call("GET", "/projects/" + project + "/requirements", null).body().contains("中文需求"));
        assertEquals(400, call("POST", "/projects/" + project + "/requirements", "{\"title\":\"\",\"priority\":\"HIGH\"}").statusCode());
        assertEquals(400, call("POST", "/projects/" + project + "/requirements",
                "{\"title\":\"forged\",\"priority\":\"HIGH\",\"actorUserId\":" + admin.id() + "}").statusCode());
        tx.inTransaction(c -> {
            var dao = new JdbcProjectMemberDao(c);
            var member = dao.find(project, tester.id()).orElseThrow();
            dao.update(new ProjectMember(project, tester.id(), ProjectRole.TESTER, MembershipStatus.INACTIVE,
                    member.joinedAt(), member.updatedAt(), member.lockVersion()));
            return null;
        });
        assertEquals("[]", call("GET", "/projects", null).body());
        assertEquals(403, call("GET", "/projects/" + project, null).statusCode());
        assertEquals(403, call("POST", "/projects/" + project + "/requirements", "{\"title\":\"blocked\",\"priority\":\"HIGH\"}").statusCode());
    }

    @Test void sessionDoesNotCacheSystemRoleOrUserStatus() throws Exception {
        login(admin);
        tx.inTransaction(c -> {
            var dao = new JdbcUserDao(c);
            var user = dao.findById(admin.id()).orElseThrow();
            dao.update(new User(user.id(), user.username(), user.displayName(), user.passwordHash(), SystemRole.USER,
                    UserStatus.ACTIVE, user.createdAt(), user.updatedAt(), user.lockVersion()));
            return null;
        });
        assertTrue(call("GET", "/auth/me", null).body().contains("\"systemRole\":\"USER\""));
        assertEquals(403, call("POST", "/projects", "{\"projectKey\":\"DENIED\",\"name\":\"x\"}").statusCode());
        tx.inTransaction(c -> {
            var dao = new JdbcUserDao(c);
            var user = dao.findById(admin.id()).orElseThrow();
            dao.update(new User(user.id(), user.username(), user.displayName(), user.passwordHash(), user.systemRole(),
                    UserStatus.DISABLED, user.createdAt(), user.updatedAt(), user.lockVersion()));
            return null;
        });
        assertEquals(401, call("GET", "/auth/me", null).statusCode());
        assertEquals(401, call("GET", "/projects", null).statusCode());
    }
}
