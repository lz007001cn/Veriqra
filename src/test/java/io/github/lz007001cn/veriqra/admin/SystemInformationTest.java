package io.github.lz007001cn.veriqra.admin;

import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import io.github.lz007001cn.veriqra.config.AiConfig;
import io.github.lz007001cn.veriqra.config.DatabaseConfig;
import io.github.lz007001cn.veriqra.exception.DataAccessException;
import io.github.lz007001cn.veriqra.service.ai.AiSettingsManager;
import io.github.lz007001cn.veriqra.service.auth.PasswordVerifier;
import io.github.lz007001cn.veriqra.service.exception.ForbiddenException;
import io.github.lz007001cn.veriqra.service.support.ServiceTransaction;
import io.github.lz007001cn.veriqra.web.HttpFailure;
import io.github.lz007001cn.veriqra.web.handler.AdminHandler;
import jakarta.servlet.ServletContext;
import jakarta.servlet.ServletOutputStream;
import jakarta.servlet.SessionCookieConfig;
import jakarta.servlet.WriteListener;
import jakarta.servlet.http.HttpServletRequest;
import jakarta.servlet.http.HttpServletResponse;
import java.io.ByteArrayOutputStream;
import java.lang.reflect.InvocationHandler;
import java.lang.reflect.Proxy;
import java.nio.charset.StandardCharsets;
import java.nio.file.Path;
import java.sql.Connection;
import java.sql.PreparedStatement;
import java.sql.ResultSet;
import java.time.Duration;
import java.time.Instant;
import java.util.Map;
import java.util.concurrent.atomic.AtomicBoolean;
import java.util.concurrent.atomic.AtomicInteger;
import java.util.concurrent.atomic.AtomicReference;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.io.TempDir;
import static org.junit.jupiter.api.Assertions.*;

class SystemInformationTest {
    @TempDir Path temporary;
    private final ObjectMapper json = new ObjectMapper();
    private final DatabaseConfig database = new DatabaseConfig("jdbc:mysql://private-host/private_db?password=private-query", "private-db-user", "private-db-password", 2, 9, Duration.ofMillis(4321));

    @Test void snapshotPreservesExistingFieldsAndOnlyExposesAllowlistedEffectiveConfiguration() throws Exception {
        var captured = SystemInformation.capture(database, Map.of("VERIQRA_DB_PASSWORD", "private-db-password", "VERIQRA_PUBLIC_ORIGIN", "https://example.invalid", "UNRELATED_SECRET", "private-extra"), null, true);
        var settings = new AiSettingsManager(new AiConfig("example-project", "global", "gemini-4-argon", "private-key-location.json"), temporary.resolve("private-model-settings.properties"));
        var attributes = Map.<String,Object>of(SystemInformation.ATTRIBUTE, captured, AiSettingsManager.class.getName(), settings);
        var value = captured.snapshot(context(attributes, true), System.currentTimeMillis() - 2500, () -> "8.4.7", () -> 35);
        JsonNode body = json.valueToTree(value);
        assertEquals("UP", body.path("applicationStatus").asText());
        assertEquals("UP", body.path("databaseStatus").asText());
        assertEquals("8.4.7", body.path("databaseVersion").asText());
        assertEquals(35, body.path("databaseTableCount").asInt());
        assertTrue(body.path("uptimeSeconds").asLong() >= 2);
        assertDoesNotThrow(() -> Instant.parse(body.path("serverTime").asText()));
        assertEquals("Asia/Shanghai (UTC+8)", body.path("applicationTimeZone").asText());
        assertEquals("Test Tomcat", body.path("tomcatVersion").asText());
        assertEquals("/veriqra", body.path("configuration").path("contextPath").asText());
        assertEquals(30, body.path("configuration").path("sessionTimeoutMinutes").asInt());
        assertTrue(body.path("configuration").path("sessionCookieSecure").asBoolean());
        assertTrue(body.path("configuration").path("publicOriginConfigured").asBoolean());
        var db = body.path("configuration").path("database");
        assertEquals(2, db.path("initialPoolSize").asInt());
        assertEquals(9, db.path("maxPoolSize").asInt());
        assertEquals(4321, db.path("acquireTimeoutMillis").asLong());
        assertEquals("ENVIRONMENT", db.path("source").asText());
        assertTrue(body.path("runtime").path("availableProcessors").asInt() > 0);
        assertTrue(body.path("runtime").path("heapUsedBytes").asLong() >= 0);
        assertTrue(body.path("runtime").path("heapCommittedBytes").asLong() > 0);
        assertFalse(body.path("runtime").path("jvmTimeZone").asText().isBlank());
        assertEquals("gemini-4-argon", body.path("ai").path("model").asText());
        assertTrue(body.path("ai").path("configured").asBoolean());
        String serialized = json.writeValueAsString(value);
        for (String hidden : new String[]{"private-host", "private_db", "private-query", "private-db-user", "private-db-password", "private-extra", "private-key-location", "private-model-settings", temporary.toString()})
            assertFalse(serialized.contains(hidden), hidden);
    }

    @Test void startupSourcesAreCapturedWhileModelSelectionRemainsLive() {
        var captured = SystemInformation.capture(database, Map.of(), "/private/database-file.properties", true);
        var settings = new AiSettingsManager(new AiConfig("example-project", "global", "gemini-2.5-flash", "private-credentials"), temporary.resolve("model.properties"));
        ServletContext context = context(Map.of(AiSettingsManager.class.getName(), settings), false);
        var first = json.valueToTree(captured.snapshot(context, 0, () -> "8.0", () -> 35));
        settings.update("gemini-4-argon", 0);
        var second = json.valueToTree(captured.snapshot(context, 0, () -> "8.0", () -> 35));
        assertEquals("gemini-2.5-flash", first.path("ai").path("model").asText());
        assertEquals("gemini-4-argon", second.path("ai").path("model").asText());
        assertEquals("local-settings", second.path("ai").path("settingsSource").asText());
        assertTrue(second.path("ai").path("settingsWritable").asBoolean());
        assertEquals("JVM_PROPERTY", second.path("configuration").path("database").path("source").asText());
        assertEquals(9, second.path("configuration").path("database").path("maxPoolSize").asInt());
    }

    @Test void databaseFailureRemainsUnavailableWithoutLeakingTheExceptionOrInventingHealthyMetadata() throws Exception {
        var captured = SystemInformation.capture(database, Map.of(), null, false);
        var result = captured.snapshot(context(Map.of(), false), 0, () -> { throw new DataAccessException("private-sql-details"); }, () -> 35);
        assertEquals("UNAVAILABLE", result.get("databaseStatus"));
        assertNull(result.get("databaseVersion")); assertNull(result.get("databaseTableCount"));
        assertFalse(json.writeValueAsString(result).contains("private-sql-details"));
        var unknown = captured.snapshot(context(Map.of(), false), 0, () -> "", () -> 0);
        assertEquals("UNAVAILABLE", unknown.get("databaseStatus"));
        assertNull(unknown.get("databaseVersion"));
        assertNull(((Map<?,?>) result.get("ai")).get("configured"));
    }

    @Test void configurationSourceDistinguishesExternalFileJvmAndDefaultsWithoutExposingTheirPaths() {
        for (var example : new Object[][] {
                {Map.of("VERIQRA_DB_CONFIG", "/private/file.properties"), null, false, "EXTERNAL_FILE"},
                {Map.of(), "/private/file.properties", false, "JVM_PROPERTY"},
                {Map.of(), null, true, "EXTERNAL_FILE"},
                {Map.of(), null, false, "DEFAULTS"}}) {
            @SuppressWarnings("unchecked") var environment = (Map<String,String>) example[0];
            var captured = SystemInformation.capture(database, environment, (String) example[1], (boolean) example[2]);
            var body = json.valueToTree(captured.snapshot(context(Map.of(), false), 0, () -> "8.0", () -> 35));
            assertEquals(example[3], body.path("configuration").path("database").path("source").asText());
            assertFalse(body.toString().contains("/private/file"));
        }
    }

    @Test void currentActiveAdministratorIsRequiredBeforeAnySystemContextReadsAndWritesAreRejected() throws Exception {
        AtomicReference<String> role = new AtomicReference<>("USER");
        AtomicReference<String> status = new AtomicReference<>("ACTIVE");
        var admin = services(role, status);
        AtomicInteger contextReads = new AtomicInteger();
        ServletContext deniedContext = proxy(ServletContext.class, (self, method, args) -> { contextReads.incrementAndGet(); throw new AssertionError("Denied system request read context"); });
        var request = request("GET", deniedContext);
        var response = response(new ByteArrayOutputStream());
        assertThrows(ForbiddenException.class, () -> AdminHandler.handle(request, response, admin, 1, new String[]{"", "admin", "system"}));
        role.set("ADMIN"); status.set("DISABLED");
        assertThrows(ForbiddenException.class, () -> AdminHandler.handle(request, response, admin, 1, new String[]{"", "admin", "system"}));
        status.set("ACTIVE");
        var failure = assertThrows(HttpFailure.class, () -> AdminHandler.handle(request("POST", deniedContext), response, admin, 1, new String[]{"", "admin", "system"}));
        assertEquals(405, failure.status());
        assertEquals(0, contextReads.get());
    }

    @Test void systemGetSerializesTheStartupSnapshotThroughThePublicAdminHandler() throws Exception {
        var captured = SystemInformation.capture(database, Map.of(), null, true);
        var context = context(Map.of(SystemInformation.ATTRIBUTE, captured), false);
        var output = new ByteArrayOutputStream();
        AdminHandler.handle(request("GET", context), response(output),
                services(new AtomicReference<>("ADMIN"), new AtomicReference<>("ACTIVE")), 1,
                new String[]{"", "admin", "system"});
        var body = json.readTree(output.toString(StandardCharsets.UTF_8));
        assertEquals("UP", body.path("databaseStatus").asText());
        assertEquals(35, body.path("databaseTableCount").asInt());
        assertEquals(9, body.path("configuration").path("database").path("maxPoolSize").asInt());
        assertFalse(body.path("configuration").path("sessionCookieSecure").asBoolean());
        assertTrue(body.path("ai").path("configured").isNull());
        assertFalse(output.toString(StandardCharsets.UTF_8).contains("private-user-value"));
        assertFalse(output.toString(StandardCharsets.UTF_8).contains("private-db-password"));
    }

    private ServletContext context(Map<String,Object> attributes, boolean secure) {
        SessionCookieConfig cookie = proxy(SessionCookieConfig.class, (self, method, args) -> switch (method.getName()) {
            case "isSecure" -> secure;
            default -> throw new AssertionError(method.getName());
        });
        return proxy(ServletContext.class, (self, method, args) -> switch (method.getName()) {
            case "getAttribute" -> attributes.get((String) args[0]);
            case "getContextPath" -> "/veriqra";
            case "getSessionTimeout" -> 30;
            case "getSessionCookieConfig" -> cookie;
            case "getServerInfo" -> "Test Tomcat";
            default -> throw new AssertionError(method.getName());
        });
    }

    private AdminServices services(AtomicReference<String> role, AtomicReference<String> status) {
        Connection connection = proxy(Connection.class, (self, method, args) -> {
            if (!method.getName().equals("prepareStatement")) throw new AssertionError(method.getName());
            String sql = (String) args[0];
            assertTrue(sql.contains("FROM users") || sql.equals("SELECT VERSION()") || sql.contains("information_schema.tables"));
            return proxy(PreparedStatement.class, (statement, called, values) -> switch (called.getName()) {
                case "close", "setObject" -> null;
                case "executeQuery" -> {
                    AtomicBoolean first = new AtomicBoolean(true);
                    yield proxy(ResultSet.class, (rows, read, fields) -> switch (read.getName()) {
                        case "next" -> first.getAndSet(false);
                        case "close" -> null;
                        case "getObject" -> fields[0].equals("id") ? 1L : null;
                        case "getLong" -> 0L;
                        case "getInt" -> { assertTrue(sql.contains("information_schema.tables")); yield 35; }
                        case "getString" -> fields[0] instanceof Integer ? "8.4.7" : switch ((String) fields[0]) {
                            case "system_role" -> role.get();
                            case "status" -> status.get();
                            default -> "private-user-value";
                        };
                        default -> throw new AssertionError(read.getName());
                    });
                }
                default -> throw new AssertionError(called.getName());
            });
        });
        ServiceTransaction tx = new ServiceTransaction() {
            @Override public <T> T execute(Work<T> work) { return work.execute(connection); }
        };
        var policy = new AdminAccessPolicy();
        return new AdminServices(new AdminUserService(tx, policy, new PasswordVerifier()), new AdminLogService(tx, policy), new TelemetryService(tx), 0);
    }

    private static HttpServletRequest request(String verb, ServletContext context) {
        return proxy(HttpServletRequest.class, (self, method, args) -> switch (method.getName()) {
            case "getMethod" -> verb;
            case "getServletContext" -> context;
            default -> throw new AssertionError(method.getName());
        });
    }

    private static HttpServletResponse response(ByteArrayOutputStream output) {
        return proxy(HttpServletResponse.class, (self, method, args) -> switch (method.getName()) {
            case "setHeader", "setStatus", "setContentType", "setCharacterEncoding" -> null;
            case "getOutputStream" -> new ServletOutputStream() {
                @Override public void write(int value) { output.write(value); }
                @Override public boolean isReady() { return true; }
                @Override public void setWriteListener(WriteListener listener) { throw new UnsupportedOperationException(); }
            };
            default -> throw new AssertionError(method.getName());
        });
    }

    @SuppressWarnings("unchecked") private static <T> T proxy(Class<T> type, InvocationHandler handler) {
        return (T) Proxy.newProxyInstance(type.getClassLoader(), new Class<?>[]{type}, handler);
    }
}
