package io.github.lz007001cn.veriqra.web;

import io.github.lz007001cn.veriqra.service.command.*;
import io.github.lz007001cn.veriqra.web.dto.*;
import io.github.lz007001cn.veriqra.web.handler.*;
import io.github.lz007001cn.veriqra.admin.AdminServices;
import jakarta.servlet.http.*;
import java.io.IOException;

/** Small explicit route table; all business work is delegated to Service interfaces. */
public final class ApiServlet extends HttpServlet {
    private final io.github.lz007001cn.veriqra.web.security.LoginRateLimiter loginLimiter =
            new io.github.lz007001cn.veriqra.web.security.LoginRateLimiter();
    @Override protected void service(HttpServletRequest request, HttpServletResponse response) throws IOException {
        WebServices services = WebServices.from(getServletContext());
        String path = request.getPathInfo() == null ? "" : request.getPathInfo();
        String method = request.getMethod();
        switch (path) {
            case "/auth/login" -> {
                method(response, method, "POST");
                LoginRequest body = JsonHttp.read(request, LoginRequest.class);
                try (var permit = loginLimiter.acquire(request.getRemoteAddr(), body.username())) {
                    try {
                        var user = services.auth().authenticate(body.username(), body.password());
                        permit.success();
                        SessionIdentity.login(request, user.id());
                        logLogin(request, user.id(), body.username(), "SUCCESS", null);
                        JsonHttp.write(response, 200, UserResponse.from(user));
                    } catch (io.github.lz007001cn.veriqra.service.exception.AuthenticationException e) {
                        permit.failure();
                        logLogin(request, null, body.username(), "FAILURE", "INVALID_CREDENTIALS");
                        throw e;
                    }
                } catch (io.github.lz007001cn.veriqra.web.security.LoginRateLimiter.Limited e) {
                    logLogin(request, null, body.username(), "RATE_LIMITED", "RATE_LIMITED");
                    throw e;
                }
            }
            case "/auth/logout" -> {
                method(response, method, "POST");
                SessionIdentity.logout(request);
                response.setStatus(204);
            }
            case "/auth/me" -> {
                method(response, method, "GET");
                JsonHttp.write(response, 200, UserResponse.from(services.auth().current(SessionIdentity.require(request))));
            }
            case "/projects" -> {
                Long actor = SessionIdentity.require(request);
                if (method.equals("GET")) {
                    JsonHttp.write(response, 200, services.projects().list(actor).stream().map(ProjectResponse::from).toList());
                } else {
                    method(response, method, "GET", "POST");
                    CreateProjectRequest body = JsonHttp.read(request, CreateProjectRequest.class);
                    var project = services.projects().create(actor,
                            new CreateProjectCommand(body.projectKey(), body.name(), body.description(), null, null));
                    response.setHeader("Location", request.getContextPath() + "/api/projects/" + project.id());
                    JsonHttp.write(response, 201, ProjectResponse.from(project));
                }
            }
            default -> {
                String[] parts = path.split("/", -1);
                if (path.equals("/admin") || path.startsWith("/admin/")) {
                    AdminHandler.handle(request, response, AdminServices.from(getServletContext()),
                            SessionIdentity.require(request), parts);
                } else if (parts.length >= 4 && parts[1].equals("automation") && parts[2].equals("identities")) {
                    AutomationHandler.handle(request, response, services, SessionIdentity.require(request), parts);
                } else {
                    projectRoute(request, response, services, path, method);
                }
            }
        }
    }

    private void projectRoute(HttpServletRequest request, HttpServletResponse response, WebServices services,
                              String path, String method) throws IOException {
        String[] parts = path.split("/", -1);
        if (parts.length >= 3 && parts[1].equals("projects")) {
            long projectId = JsonHttp.positiveId(parts[2]);
            Long actor = SessionIdentity.require(request);
            if (parts.length == 3) {
                method(response, method, "GET");
                JsonHttp.write(response, 200, ProjectResponse.from(services.projects().get(actor, projectId)));
                return;
            }
            switch (parts[3]) {
                case "runs" -> TestRunHandler.handle(request, response, services, actor, projectId, parts);
                case "defects" -> DefectHandler.handle(request, response, services, actor, projectId, parts);
                case "requirements" -> RequirementHandler.handle(request, response, services, actor, projectId, parts);
                case "test-cases" -> TestCaseHandler.handle(request, response, services, actor, projectId, parts);
                case "test-plans" -> TestPlanHandler.handle(request, response, services, actor, projectId, parts);
                case "automation" -> AutomationHandler.handleProject(request, response, services, actor, projectId, parts);
                case "imports" -> TestImportHandler.handle(request, response, services, actor, projectId, parts);
                case "managers", "members" -> ProjectSettingsHandler.handle(
                        request, response,
                        java.util.Objects.requireNonNull((io.github.lz007001cn.veriqra.service.ProjectSettingsService)
                                getServletContext().getAttribute(io.github.lz007001cn.veriqra.service.ProjectSettingsService.class.getName()),
                                "Project settings service not initialized"), actor, projectId, parts);
                default -> throw new HttpFailure(404, "NOT_FOUND", "Resource not found");
            }
            return;
        }
        throw new HttpFailure(404, "NOT_FOUND", "Resource not found");
    }

    private static void method(HttpServletResponse response, String actual, String... allowed) {
        JsonHttp.method(response, actual, allowed);
    }

    private void logLogin(HttpServletRequest request, Long userId, String username, String result, String reason) {
        try {
            Object value=getServletContext().getAttribute(AdminServices.ATTRIBUTE);
            if(value instanceof AdminServices admin) admin.telemetry().login(userId,username,request.getRemoteAddr(),
                    request.getHeader("User-Agent"),result,reason);
        } catch(RuntimeException ignored) { getServletContext().log("Login telemetry unavailable"); }
    }
}
