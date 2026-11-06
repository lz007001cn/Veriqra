package io.github.lz007001cn.veriqra.service.ai;

import com.fasterxml.jackson.databind.ObjectMapper;
import io.github.lz007001cn.veriqra.service.exception.*;
import io.github.lz007001cn.veriqra.web.*;
import io.github.lz007001cn.veriqra.web.handler.*;
import jakarta.servlet.*;
import jakarta.servlet.http.*;
import java.io.*;
import java.lang.reflect.Proxy;
import java.nio.charset.StandardCharsets;
import java.util.*;
import org.junit.jupiter.api.Test;
import static org.junit.jupiter.api.Assertions.*;

class AiAssistanceHandlerTest {
    static final class Exchange {
        final AiAssistanceServiceTest.Fixture fixture = new AiAssistanceServiceTest.Fixture();
        final ByteArrayOutputStream output = new ByteArrayOutputStream();
        final Map<String, String> headers = new HashMap<>();
        int status;
        boolean configured = true;
        String method = "POST", body = "{\"language\":\"en\"}";
        Map<String, String[]> query = Map.of();
        HttpServletRequest request() {
            var input = new ByteArrayInputStream(body.getBytes(StandardCharsets.UTF_8));
            var context = proxy(ServletContext.class, (name, args) -> name.equals("getAttribute") && configured ? fixture.service() : null);
            return proxy(HttpServletRequest.class, (name, args) -> switch (name) {
                case "getMethod" -> method;
                case "getParameterMap" -> query;
                case "getContentType" -> "application/json";
                case "getServletContext" -> context;
                case "getInputStream" -> new ServletInputStream() {
                    @Override public int read() { return input.read(); }
                    @Override public boolean isFinished() { return input.available() == 0; }
                    @Override public boolean isReady() { return true; }
                    @Override public void setReadListener(ReadListener listener) { }
                };
                default -> throw new AssertionError(name);
            });
        }
        HttpServletResponse response() {
            return proxy(HttpServletResponse.class, (name, args) -> switch (name) {
                case "setStatus" -> { status = (Integer) args[0]; yield null; }
                case "setHeader" -> { headers.put((String) args[0], (String) args[1]); yield null; }
                case "setContentType", "setCharacterEncoding" -> null;
                case "getOutputStream" -> new ServletOutputStream() {
                    @Override public void write(int value) { output.write(value); }
                    @Override public boolean isReady() { return true; }
                    @Override public void setWriteListener(WriteListener listener) { }
                };
                default -> throw new AssertionError(name);
            });
        }
        void call(String resource, String id, String action) throws IOException {
            String[] path = {"api", "projects", "7", resource, id, action};
            if (resource.equals("requirements")) RequirementHandler.handle(request(), response(), null, 1L, 7L, path);
            else DefectHandler.handle(request(), response(), null, 1L, 7L, path);
        }
    }
    interface Invocation { Object call(String method, Object[] args) throws Throwable; }
    @SuppressWarnings("unchecked") static <T> T proxy(Class<T> type, Invocation invocation) {
        return (T) Proxy.newProxyInstance(type.getClassLoader(), new Class<?>[]{type}, (self, method, args) -> invocation.call(method.getName(), args));
    }
    @Test void publicRequirementAndDefectRoutesReturnVersionedStructuredPreviewJson() throws Exception {
        for (String action : List.of("ai-review", "ai-coverage", "ai-analysis")) {
            var x = new Exchange(); boolean defect = action.equals("ai-analysis");
            x.call(defect ? "defects" : "requirements", defect ? "20" : "10", action);
            var json = new ObjectMapper().readTree(x.output.toByteArray());
            assertEquals(200, x.status); assertEquals(defect ? 20 : 10, json.path(defect ? "defectId" : "requirementId").asLong());
            assertEquals(defect ? 6 : 3, json.path("expectedVersion").asInt());
            assertEquals("2026-11-05T01:00:00", json.path("capturedAt").asText());
            assertEquals("2026-11-05T01:00:00", json.path("generatedAt").asText());
            assertTrue(json.path("analysis").isObject()); assertEquals(1, x.fixture.modelCalls);
            if (action.equals("ai-coverage")) { assertEquals(0, json.path("totalLinkedCases").asInt()); assertTrue(json.path("sourceCases").isArray()); }
        }
    }
    @Test void rejectsUnsupportedMethodsPathsBodyAndQueryWithoutModelCalls() throws Exception {
        var x = new Exchange(); x.method = "GET";
        assertEquals(405, assertThrows(HttpFailure.class, () -> x.call("requirements", "10", "ai-review")).status()); assertEquals("POST", x.headers.get("Allow"));
        x.method = "POST"; x.query = Map.of("unrecognized", new String[]{"1"});
        assertEquals(400, assertThrows(HttpFailure.class, () -> x.call("requirements", "10", "ai-review")).status());
        x.query = Map.of(); x.body = "{\"language\":\"en\",\"candidates\":[]}";
        assertEquals("INVALID_JSON", assertThrows(HttpFailure.class, () -> x.call("requirements", "10", "ai-coverage")).code());
        x.body = "{\"language\":\"en\"}";
        assertEquals("INVALID_ID", assertThrows(HttpFailure.class, () -> x.call("defects", "0", "ai-analysis")).code());
        x.body = "{\"language\":\"fr\"}";
        assertThrows(ValidationException.class, () -> x.call("defects", "20", "ai-analysis"));
        assertEquals(0, x.fixture.modelCalls);
    }
    @Test void missingWiringAndDisabledActorsStayExplicitRatherThanReturningFakeAnalysis() {
        var x = new Exchange(); x.configured = false;
        assertEquals("AI_NOT_CONFIGURED", assertThrows(HttpFailure.class, () -> x.call("requirements", "10", "ai-review")).code());
        x.configured = true; x.fixture.disabled = true;
        assertThrows(ForbiddenException.class, () -> x.call("defects", "20", "ai-analysis")); assertEquals(0, x.fixture.modelCalls);
    }
}
