package io.github.lz007001cn.veriqra.web;

import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import io.github.lz007001cn.veriqra.admin.*;
import io.github.lz007001cn.veriqra.config.AiConfig;
import io.github.lz007001cn.veriqra.model.*;
import io.github.lz007001cn.veriqra.service.ai.*;
import io.github.lz007001cn.veriqra.service.auth.PasswordVerifier;
import io.github.lz007001cn.veriqra.service.support.ServiceTransaction;
import io.github.lz007001cn.veriqra.web.handler.AdminHandler;
import jakarta.servlet.*;
import jakarta.servlet.http.*;
import java.io.*;
import java.lang.reflect.InvocationHandler;
import java.lang.reflect.Proxy;
import java.net.URI;
import java.net.URLDecoder;
import java.nio.charset.StandardCharsets;
import java.nio.file.*;
import java.sql.*;
import java.time.*;
import java.util.*;
import java.util.concurrent.CopyOnWriteArrayList;
import java.util.concurrent.atomic.*;
import java.util.stream.Stream;
import org.junit.jupiter.api.*;
import org.junit.jupiter.api.io.TempDir;
import org.junit.jupiter.params.ParameterizedTest;
import org.junit.jupiter.params.provider.*;
import static org.junit.jupiter.api.Assertions.*;

/** Public administration entrypoint, real authorization policy and JSON transport; no database or server. */
class AdminAiHandlerTest {
    @TempDir Path temporary;
    private static final long ACTOR = 17;
    private static final String PRIVATE_KEY = "PRIVATE_KEY_MUST_NEVER_APPEAR_IN_API_JSON";
    private final ObjectMapper json = new ObjectMapper();
    private final AtomicReference<User> actor = new AtomicReference<>(user(SystemRole.ADMIN, UserStatus.ACTIVE));
    private final AtomicInteger userLookups = new AtomicInteger();
    private final List<URI> googleReads = new CopyOnWriteArrayList<>();
    private Path settingsPath;
    private Path credentialsPath;
    private AiSettingsManager settings;
    private VertexAiProvider provider;
    private AdminServices admin;
    private ServletContext context;

    @BeforeEach void setUp() throws Exception {
        settingsPath = temporary.resolve("settings/ai-settings.local.properties");
        credentialsPath = temporary.resolve("private-credentials-for-test.json");
        // Deliberately invalid RSA material guarantees even the explicit check cannot perform an OAuth request.
        Files.writeString(credentialsPath, json.writeValueAsString(Map.of("client_email", "private-test@example.invalid", "private_key", PRIVATE_KEY)));
        AiConfig config = new AiConfig("server-project", "global", "gemini-2.5-flash", credentialsPath.toString());
        settings = new AiSettingsManager(config, settingsPath);
        provider = new VertexAiProvider(config, settings);
        var dashboard = new GoogleAiDashboard(uri -> {
            googleReads.add(uri);
            if (uri.getHost().equals("cloudresourcemanager.googleapis.com")) return node("{\"projectNumber\":\"123456\"}");
            if (uri.getHost().equals("cloudbilling.googleapis.com")) return node("{\"billingEnabled\":false}");
            return node("{}");
        }, Clock.fixed(Instant.parse("2026-11-03T00:00:00Z"), ZoneOffset.UTC));
        Map<String,Object> attributes = Map.of(AiSettingsManager.class.getName(), settings,
                VertexAiProvider.class.getName(), provider, GoogleAiDashboard.ATTRIBUTE, dashboard);
        context = proxy(ServletContext.class, (self, method, args) -> switch (method.getName()) {
            case "getAttribute" -> attributes.get((String) args[0]);
            default -> throw unexpected(method.getName());
        });
        Connection connection = userConnection();
        ServiceTransaction tx = new ServiceTransaction() {
            @Override public <T> T execute(Work<T> work) { return work.execute(connection); }
        };
        var policy = new AdminAccessPolicy();
        admin = new AdminServices(new AdminUserService(tx, policy, new PasswordVerifier()),
                new AdminLogService(tx, policy), new TelemetryService(tx), 0);
    }

    @AfterEach void closeProvider() { if (provider != null) provider.close(); }

    static Stream<Arguments> forbiddenActors() {
        return Stream.of(Arguments.of(SystemRole.USER, UserStatus.ACTIVE, true),
                Arguments.of(SystemRole.ADMIN, UserStatus.DISABLED, true),
                Arguments.of(SystemRole.USER, UserStatus.DISABLED, true),
                Arguments.of(SystemRole.ADMIN, UserStatus.ACTIVE, false));
    }

    @ParameterizedTest @MethodSource("forbiddenActors")
    void everyAiOperationRequiresTheCurrentActiveAdministratorBeforeAnyAiAccess(SystemRole role, UserStatus status, boolean exists) throws Exception {
        actor.set(exists ? user(role, status) : null);
        var original = settings.get();
        for (String[] operation : List.of(new String[]{"GET", "/admin/ai"}, new String[]{"PUT", "/admin/ai"},
                new String[]{"POST", "/admin/ai/refresh"}, new String[]{"POST", "/admin/ai/check-model"})) {
            var response = call(operation[0], operation[1], "{\"model\":\"gemini-forged\",\"expectedRevision\":0}");
            assertEquals(403, response.status, response.text());
            assertEquals("FORBIDDEN", response.body().path("error").path("code").asText());
            assertEquals(0, response.contextReads, "Authorization must happen before retrieving any AI component");
            assertEquals(0, response.bodyReads, "A denied request must not consume the mutation payload");
        }
        assertEquals(4, userLookups.get());
        assertTrue(googleReads.isEmpty());
        assertEquals(original, settings.get());
        assertFalse(Files.exists(settingsPath));
    }

    @Test void authorizationIsRecheckedWhenAnAdministratorIsDemotedOrDisabledBetweenRequests() throws Exception {
        assertEquals(200, call("GET", "/admin/ai", null).status);
        actor.set(user(SystemRole.USER, UserStatus.ACTIVE));
        assertEquals(403, call("PUT", "/admin/ai", "{\"model\":\"gemini-forged\",\"expectedRevision\":0}").status);
        actor.set(user(SystemRole.ADMIN, UserStatus.ACTIVE));
        assertEquals(200, call("GET", "/admin/ai", null).status);
        actor.set(user(SystemRole.ADMIN, UserStatus.DISABLED));
        assertEquals(403, call("POST", "/admin/ai/refresh", "{}").status);
        assertEquals(4, userLookups.get());
        assertTrue(googleReads.isEmpty());
        assertFalse(Files.exists(settingsPath));
    }

    @Test void getReturnsSafeSettingsWithoutReadingCredentialsOrRefreshingGoogle() throws Exception {
        var response = call("GET", "/admin/ai", null);
        assertEquals(200, response.status);
        assertEquals("gemini-2.5-flash", response.body().path("model").asText());
        assertEquals("server-project", response.body().path("project").asText());
        assertTrue(response.body().path("configured").asBoolean());
        assertEquals(0, response.body().path("revision").asLong());
        assertTrue(response.body().path("models").isArray());
        assertFalse(response.body().has("credentials"));
        assertFalse(response.text().contains("private_key"));
        assertFalse(response.text().contains(PRIVATE_KEY));
        assertFalse(response.text().contains(credentialsPath.getFileName().toString()));
        assertFalse(response.text().contains(settingsPath.getFileName().toString()));
        assertTrue(googleReads.isEmpty());
        assertEquals(0, response.bodyReads);
        assertFalse(Files.exists(settingsPath));
    }

    @Test void putRequiresARevisionAndPersistsAnAcceptedUpdateWhileRejectingAStaleSave() throws Exception {
        var missing = call("PUT", "/admin/ai", "{\"model\":\"gemini-server-saved\"}");
        assertEquals(400, missing.status);
        assertEquals("AI_MODEL_INVALID", missing.body().path("error").path("code").asText());
        assertFalse(Files.exists(settingsPath));
        var saved = call("PUT", "/admin/ai", "{\"model\":\"gemini-server-saved\",\"expectedRevision\":0}");
        assertEquals(200, saved.status, saved.text());
        assertEquals("gemini-server-saved", saved.body().path("model").asText());
        assertEquals(1, saved.body().path("revision").asLong());
        assertEquals("gemini-server-saved", new AiSettingsManager(new AiConfig("server-project", "global", "gemini-2.5-flash", credentialsPath.toString()), settingsPath).get().model());
        byte[] persisted = Files.readAllBytes(settingsPath);
        var stale = call("PUT", "/admin/ai", "{\"model\":\"gemini-stale-overwrite\",\"expectedRevision\":0}");
        assertEquals(409, stale.status);
        assertEquals("AI_SETTINGS_CONFLICT", stale.body().path("error").path("code").asText());
        assertArrayEquals(persisted, Files.readAllBytes(settingsPath));
        assertEquals("gemini-server-saved", call("GET", "/admin/ai", null).body().path("model").asText());
        assertEquals(1, settings.get().revision());
        assertTrue(googleReads.isEmpty());
    }

    @Test void getCannotTriggerRefreshOrModelCheck() throws Exception {
        for (String path : List.of("/admin/ai/refresh", "/admin/ai/check-model")) {
            var response = call("GET", path, null);
            assertEquals(405, response.status);
            assertEquals("METHOD_NOT_ALLOWED", response.body().path("error").path("code").asText());
            assertEquals("POST", response.headers.get("Allow"));
            assertEquals(0, response.bodyReads);
        }
        assertTrue(googleReads.isEmpty());
        assertEquals(0, settings.get().revision());
        assertFalse(Files.exists(settingsPath));
    }

    @Test void postRefreshUsesTheServerSelectionAndIgnoresClientModelProjectAndRevision() throws Exception {
        var saved = settings.update("gemini-server-selection", 0);
        byte[] persisted = Files.readAllBytes(settingsPath);
        var response = call("POST", "/admin/ai/refresh", "{\"model\":\"gemini-client-forged\",\"project\":\"client-project\",\"expectedRevision\":700}");
        assertEquals(200, response.status, response.text());
        assertEquals("gemini-server-selection", response.body().path("model").asText());
        assertEquals("server-project", response.body().path("project").asText());
        assertEquals(1, response.body().path("revision").asLong());
        assertTrue(googleReads.stream().anyMatch(uri -> uri.getHost().equals("monitoring.googleapis.com")));
        for (URI uri : googleReads) {
            String decoded = URLDecoder.decode(uri.toString(), StandardCharsets.UTF_8);
            assertFalse(decoded.contains("gemini-client-forged"));
            assertFalse(decoded.contains("client-project"));
            if (uri.getHost().equals("monitoring.googleapis.com")) assertTrue(decoded.contains("gemini-server-selection"));
        }
        assertEquals(0, response.bodyReads);
        assertEquals(saved, settings.get());
        assertArrayEquals(persisted, Files.readAllBytes(settingsPath));
    }

    @Test void anActiveAdministratorCanExplicitlyCheckAModelAndReceivesOnlySanitizedFailureFields() throws Exception {
        var response = call("POST", "/admin/ai/check-model", "{\"model\":\"gemini-client-forged\"}");
        assertEquals(200, response.status, response.text());
        assertEquals("gemini-2.5-flash", response.body().path("model").asText());
        assertEquals("UNAVAILABLE", response.body().path("status").asText());
        assertEquals("CREDENTIALS_UNAVAILABLE", response.body().path("code").asText());
        assertFalse(response.text().contains(PRIVATE_KEY));
        assertFalse(response.text().contains(credentialsPath.getFileName().toString()));
        assertEquals(0, response.bodyReads);
        assertTrue(googleReads.isEmpty());
        assertEquals(0, settings.get().revision());
        assertFalse(Files.exists(settingsPath));
    }

    private Exchange call(String method, String path, String body) throws Exception {
        Exchange exchange = new Exchange();
        byte[] bytes = Objects.toString(body, "").getBytes(StandardCharsets.UTF_8);
        var input = new ByteArrayInputStream(bytes);
        var request = proxy(HttpServletRequest.class, (self, called, args) -> switch (called.getName()) {
            case "getMethod" -> method;
            case "getRequestURI" -> "/api" + path;
            case "getContextPath" -> "";
            case "getContentType" -> "application/json";
            case "setCharacterEncoding" -> null;
            case "getServletContext" -> { exchange.contextReads++; yield context; }
            case "getInputStream" -> {
                exchange.bodyReads++;
                yield new ServletInputStream() {
                    @Override public int read() { return input.read(); }
                    @Override public boolean isFinished() { return input.available() == 0; }
                    @Override public boolean isReady() { return true; }
                    @Override public void setReadListener(ReadListener listener) { throw new UnsupportedOperationException(); }
                };
            }
            default -> throw unexpected(called.getName());
        });
        new ApiExceptionFilter().doFilter(request, exchange.response,
                (incoming, outgoing) -> AdminHandler.handle((HttpServletRequest) incoming, (HttpServletResponse) outgoing,
                        admin, ACTOR, path.split("/", -1)));
        return exchange;
    }

    private Connection userConnection() {
        return proxy(Connection.class, (self, method, args) -> {
            if (!method.getName().equals("prepareStatement")) throw unexpected(method.getName());
            String sql = (String) args[0];
            assertTrue(sql.contains("FROM users WHERE id=?"), sql);
            var bound = new AtomicReference<Object>();
            return proxy(PreparedStatement.class, (statement, called, values) -> switch (called.getName()) {
                case "setObject" -> { assertEquals(1, values[0]); bound.set(values[1]); yield null; }
                case "close" -> null;
                case "executeQuery" -> {
                    userLookups.incrementAndGet();
                    assertEquals(ACTOR, bound.get());
                    User current = actor.get();
                    AtomicBoolean first = new AtomicBoolean(true);
                    yield proxy(ResultSet.class, (result, read, fields) -> switch (read.getName()) {
                        case "next" -> first.getAndSet(false) && current != null;
                        case "close" -> null;
                        case "getObject" -> switch ((String) fields[0]) {
                            case "id" -> current.id();
                            case "created_at" -> current.createdAt();
                            case "updated_at" -> current.updatedAt();
                            default -> throw unexpected((String) fields[0]);
                        };
                        case "getString" -> switch ((String) fields[0]) {
                            case "username" -> current.username();
                            case "display_name" -> current.displayName();
                            case "password_hash" -> current.passwordHash();
                            case "system_role" -> current.systemRole().name();
                            case "status" -> current.status().name();
                            default -> throw unexpected((String) fields[0]);
                        };
                        case "getLong" -> { assertEquals("lock_version", fields[0]); yield current.lockVersion().longValue(); }
                        default -> throw unexpected(read.getName());
                    });
                }
                default -> throw unexpected(called.getName());
            });
        });
    }

    private static User user(SystemRole role, UserStatus status) {
        return new User(ACTOR, "admin-test", "Administrator", "test-password-hash", role, status, null, null, 0);
    }

    private JsonNode node(String body) {
        try { return json.readTree(body); } catch (IOException invalid) { throw new AssertionError(invalid); }
    }

    private static AssertionError unexpected(String method) { return new AssertionError("Unexpected test fixture call: " + method); }

    @SuppressWarnings("unchecked")
    private static <T> T proxy(Class<T> type, InvocationHandler handler) {
        return (T) Proxy.newProxyInstance(type.getClassLoader(), new Class<?>[]{type}, (self, method, args) -> {
            if (method.getDeclaringClass() == Object.class) return switch (method.getName()) {
                case "toString" -> "Test proxy for " + type.getSimpleName();
                case "hashCode" -> System.identityHashCode(self);
                case "equals" -> self == args[0];
                default -> throw unexpected(method.getName());
            };
            return handler.invoke(self, method, args);
        });
    }

    private final class Exchange {
        int status = 200;
        int contextReads;
        int bodyReads;
        final Map<String,String> headers = new HashMap<>();
        final ByteArrayOutputStream output = new ByteArrayOutputStream();
        final HttpServletResponse response = proxy(HttpServletResponse.class, (self, method, args) -> switch (method.getName()) {
            case "setStatus" -> { status = (int) args[0]; yield null; }
            case "getStatus" -> status;
            case "setHeader" -> { headers.put((String) args[0], (String) args[1]); yield null; }
            case "setContentType", "setCharacterEncoding" -> null;
            case "isCommitted" -> false;
            case "resetBuffer" -> { output.reset(); yield null; }
            case "getOutputStream" -> new ServletOutputStream() {
                @Override public void write(int value) { output.write(value); }
                @Override public boolean isReady() { return true; }
                @Override public void setWriteListener(WriteListener listener) { throw new UnsupportedOperationException(); }
            };
            default -> throw unexpected(method.getName());
        });
        String text() { return output.toString(StandardCharsets.UTF_8); }
        JsonNode body() { return node(text()); }
    }
}
