package io.github.lz007001cn.veriqra.web.handler;

import io.github.lz007001cn.veriqra.admin.*;
import io.github.lz007001cn.veriqra.model.*;
import io.github.lz007001cn.veriqra.web.*;
import jakarta.servlet.http.*;
import java.io.IOException;
import java.util.*;

/** Basic user maintenance and build metadata. */
public final class AdminHandler {
    private AdminHandler() { }
    public record CreateUser(String username, String displayName, String password, SystemRole systemRole, UserStatus status) { }
    public record UpdateUser(String displayName, SystemRole systemRole, UserStatus status, Integer lockVersion) { }
    public record ResetPassword(String password) { }

    public static void handle(HttpServletRequest request, HttpServletResponse response, AdminServices admin,
                              long actor, String[] parts) throws IOException {
        admin.logs().requireAdmin(actor);
        if (parts.length >= 3 && parts[2].equals("users")) {
            users(request, response, admin, actor, parts);
            return;
        }
        if (parts.length == 3 && parts[2].equals("system")) {
            JsonHttp.method(response, request.getMethod(), "GET");
            BuildInfo build = BuildInfo.current();
            Map<String, Object> data = new LinkedHashMap<>();
            data.put("veriqraVersion", build.version()); data.put("buildCommit", build.commit());
            data.put("buildTime", build.buildTime()); data.put("applicationStatus", "UP");
            data.put("databaseStatus", "UP"); data.put("databaseVersion", admin.logs().databaseVersion(actor));
            data.put("databaseTableCount", admin.logs().databaseTableCount(actor));
            data.put("javaVersion", System.getProperty("java.version"));
            data.put("tomcatVersion", request.getServletContext().getServerInfo());
            data.put("uptimeSeconds", Math.max(0, (System.currentTimeMillis() - admin.startedAtMillis()) / 1000));
            data.put("serverTime", java.time.Instant.now().toString());
            data.put("applicationTimeZone", "Asia/Shanghai (UTC+8)");
            JsonHttp.write(response, 200, data);
            return;
        }
        throw new HttpFailure(404, "NOT_FOUND", "Resource not found");
    }

    private static void users(HttpServletRequest request, HttpServletResponse response, AdminServices admin,
                              long actor, String[] parts) throws IOException {
        String method = request.getMethod();
        AdminContext context = context(request, actor);
        if (parts.length == 3) {
            JsonHttp.method(response, method, "GET", "POST");
            if (method.equals("GET")) {
                JsonHttp.write(response, 200, admin.users().list(actor, new AdminUserQuery(
                        page(request, "page", 1, 1_000_000), page(request, "pageSize", 25, 100),
                        request.getParameter("search"), filter(request, "systemRole", SystemRole.class),
                        filter(request, "status", UserStatus.class), request.getParameter("sort"), request.getParameter("order"))));
                return;
            }
            CreateUser body = JsonHttp.read(request, CreateUser.class);
            var created = admin.users().create(context, body.username(), body.displayName(), body.password(), body.systemRole(), body.status());
            response.setHeader("Location", request.getContextPath() + "/api/admin/users/" + created.id());
            JsonHttp.write(response, 201, created);
            return;
        }
        if (parts.length < 4) throw new HttpFailure(404, "NOT_FOUND", "Resource not found");
        long id = JsonHttp.positiveId(parts[3]);
        if (parts.length == 4) {
            JsonHttp.method(response, method, "GET", "PATCH");
            if (method.equals("GET")) { JsonHttp.write(response, 200, admin.users().get(actor, id)); return; }
            UpdateUser body = JsonHttp.read(request, UpdateUser.class);
            if (body.lockVersion() == null) throw new HttpFailure(400, "VALIDATION", "lockVersion is required");
            JsonHttp.write(response, 200, admin.users().update(context, id, body.displayName(), body.systemRole(), body.status(), body.lockVersion()));
            return;
        }
        if (parts.length == 5 && parts[4].equals("reset-password")) {
            JsonHttp.method(response, method, "POST");
            admin.users().resetPassword(context, id, JsonHttp.read(request, ResetPassword.class).password());
            response.setStatus(204);
            return;
        }
        throw new HttpFailure(404, "NOT_FOUND", "Resource not found");
    }

    private static AdminContext context(HttpServletRequest request, long actor) {
        Object value = request.getAttribute(AccessLogFilter.REQUEST_ID);
        return new AdminContext(actor, request.getRemoteAddr(), value instanceof String id ? id : UUID.randomUUID().toString());
    }
    private static int page(HttpServletRequest request, String name, int fallback, int maximum) {
        String raw = request.getParameter(name);
        if (raw == null) return fallback;
        try {
            int value = Integer.parseInt(raw);
            if (value < 1 || value > maximum) throw new NumberFormatException();
            return value;
        } catch (NumberFormatException e) { throw new HttpFailure(400, "INVALID_PAGE", "Invalid pagination value"); }
    }
    private static <E extends Enum<E>> E filter(HttpServletRequest request, String name, Class<E> type) {
        String value = request.getParameter(name);
        if (value == null || value.isEmpty()) return null;
        try { return Enum.valueOf(type, value); }
        catch (IllegalArgumentException e) { throw new HttpFailure(400, "VALIDATION", "Invalid user filter"); }
    }
}
