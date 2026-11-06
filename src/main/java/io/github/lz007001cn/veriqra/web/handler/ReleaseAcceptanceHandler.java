package io.github.lz007001cn.veriqra.web.handler;

import io.github.lz007001cn.veriqra.service.release.ReleaseAcceptanceService;
import io.github.lz007001cn.veriqra.web.HttpFailure;
import io.github.lz007001cn.veriqra.web.JsonHttp;
import jakarta.servlet.http.HttpServletRequest;
import jakarta.servlet.http.HttpServletResponse;
import java.io.IOException;
import java.util.Set;

public final class ReleaseAcceptanceHandler {
    private ReleaseAcceptanceHandler() { }

    public static void handle(HttpServletRequest request, HttpServletResponse response, Long actor, long project, String[] path)
            throws IOException {
        var service = (ReleaseAcceptanceService) request.getServletContext().getAttribute(ReleaseAcceptanceService.class.getName());
        if (service == null) throw new HttpFailure(503, "RELEASE_ACCEPTANCE_UNAVAILABLE", "Release acceptance is unavailable");
        try {
            route(request, response, actor, project, path, service);
        } catch (ReleaseAcceptanceService.EvidenceLimitExceeded e) {
            throw new HttpFailure(409, "RELEASE_ACCEPTANCE_EVIDENCE_TOO_LARGE", e.getMessage());
        } catch (ReleaseAcceptanceService.EvidenceChanged e) {
            throw new HttpFailure(409, "RELEASE_ACCEPTANCE_EVIDENCE_CHANGED", e.getMessage());
        }
    }

    private static void route(HttpServletRequest request, HttpServletResponse response, Long actor, long project,
            String[] path, ReleaseAcceptanceService service) throws IOException {
        if (path.length == 4) {
            JsonHttp.method(response, request.getMethod(), "GET", "POST");
            if (request.getMethod().equals("GET")) {
                JsonHttp.write(response, 200, service.list(actor, project, beforeId(request)));
                return;
            }
            requireNoQuery(request);
            var input = JsonHttp.read(request, ReleaseAcceptanceService.CreateRequest.class);
            var saved = service.create(actor, project, input);
            response.setHeader("Location", request.getContextPath() + "/api/projects/" + project + "/release-acceptances/" + saved.id());
            JsonHttp.write(response, 201, saved);
            return;
        }
        if (path.length == 5 && path[4].equals("preview")) {
            JsonHttp.method(response, request.getMethod(), "POST");
            requireNoQuery(request);
            var input = JsonHttp.read(request, ReleaseAcceptanceService.PreviewRequest.class);
            JsonHttp.write(response, 200, service.preview(actor, project, input));
            return;
        }
        if (path.length == 5) {
            JsonHttp.method(response, request.getMethod(), "GET");
            requireNoQuery(request);
            JsonHttp.write(response, 200, service.get(actor, project, JsonHttp.positiveId(path[4])));
            return;
        }
        throw new HttpFailure(404, "NOT_FOUND", "Resource not found");
    }

    private static Long beforeId(HttpServletRequest request) {
        if (!Set.of("beforeId").containsAll(request.getParameterMap().keySet())) throw invalidQuery();
        String[] values = request.getParameterValues("beforeId");
        if (values == null) return null;
        if (values.length != 1) throw invalidQuery();
        return JsonHttp.positiveId(values[0]);
    }

    private static void requireNoQuery(HttpServletRequest request) {
        if (!request.getParameterMap().isEmpty()) throw invalidQuery();
    }

    private static HttpFailure invalidQuery() { return new HttpFailure(400, "INVALID_QUERY", "Invalid query parameters"); }
}
