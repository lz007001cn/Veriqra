package io.github.lz007001cn.veriqra.web.handler;

import io.github.lz007001cn.veriqra.admin.GoogleAiDashboard;
import io.github.lz007001cn.veriqra.service.ai.*;
import io.github.lz007001cn.veriqra.web.*;
import jakarta.servlet.http.*;
import java.io.IOException;
import java.time.Instant;
import java.util.LinkedHashMap;
import java.util.Map;

/** Called only after AdminHandler has verified the current administrator. */
public final class AdminAiHandler {
    private AdminAiHandler() { }
    public record UpdateModel(String model, Long expectedRevision) { }

    public static void handle(HttpServletRequest request, HttpServletResponse response, String[] parts) throws IOException {
        var context = request.getServletContext();
        var settings = (AiSettingsManager)context.getAttribute(AiSettingsManager.class.getName());
        var dashboard = (GoogleAiDashboard)context.getAttribute(GoogleAiDashboard.ATTRIBUTE);
        var provider = (VertexAiProvider)context.getAttribute(VertexAiProvider.class.getName());
        if (settings == null || dashboard == null || provider == null)
            throw new HttpFailure(503, "AI_ADMIN_UNAVAILABLE", "AI administration is unavailable");
        if (parts.length == 3) {
            JsonHttp.method(response, request.getMethod(), "GET", "PUT");
            AiSettingsManager.Settings current;
            if (request.getMethod().equals("PUT")) {
                UpdateModel body = JsonHttp.read(request, UpdateModel.class);
                if (body.expectedRevision() == null) throw new HttpFailure(400, "AI_MODEL_INVALID", "Settings revision is required");
                current = settings.update(body.model(), body.expectedRevision());
            } else current = settings.get();
            JsonHttp.write(response, 200, view(current));
            return;
        }
        if (parts.length == 4 && parts[3].equals("refresh")) {
            JsonHttp.method(response, request.getMethod(), "POST");
            JsonHttp.write(response, 200, dashboard.refresh(settings.get()));
            return;
        }
        if (parts.length == 4 && parts[3].equals("check-model")) {
            JsonHttp.method(response, request.getMethod(), "POST");
            Map<String,Object> result = new LinkedHashMap<>();
            result.put("checkedAt", Instant.now());
            String checkedModel = settings.get().model();
            result.put("model", checkedModel);
            try {
                var check = provider.checkModel(checkedModel);
                result.put("model", check.model()); result.put("totalTokens", check.totalTokens());
                result.put("status", "OK"); result.put("code", null);
            } catch (GoogleApiException failure) {
                result.put("status", switch (failure.code()) {
                    case "NOT_CONFIGURED" -> "NOT_CONFIGURED";
                    case "PERMISSION_DENIED", "IAM_PERMISSION_DENIED", "ACCESS_TOKEN_SCOPE_INSUFFICIENT" -> "PERMISSION_DENIED";
                    case "SERVICE_DISABLED" -> "API_DISABLED";
                    default -> "UNAVAILABLE";
                });
                result.put("code", failure.code());
            }
            JsonHttp.write(response, 200, result);
            return;
        }
        throw new HttpFailure(404, "NOT_FOUND", "Resource not found");
    }

    private static Map<String,Object> view(AiSettingsManager.Settings settings) {
        Map<String,Object> result = new LinkedHashMap<>();
        result.put("project", settings.project()); result.put("location", settings.location());
        result.put("model", settings.model()); result.put("configured", settings.configured());
        result.put("writable", settings.writable()); result.put("source", settings.source());
        result.put("revision", settings.revision()); result.put("models", settings.models());
        result.put("links", GoogleAiDashboard.links(settings.project()));
        return result;
    }
}
