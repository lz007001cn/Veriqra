package io.github.lz007001cn.veriqra.web.handler;

import io.github.lz007001cn.veriqra.service.ai.AiAssistanceService;
import io.github.lz007001cn.veriqra.web.*;
import jakarta.servlet.http.*;
import java.io.IOException;

/** Explicit preview endpoints; accepting cases and saving requirements use their existing write routes. */
public final class AiAssistanceHandler {
    private AiAssistanceHandler() { }
    public record Request(String language) { }
    public static void handle(HttpServletRequest req, HttpServletResponse res, Long actor, Long project, String[] path) throws IOException {
        if (path.length != 6 || !(path[3].equals("requirements") && (path[5].equals("ai-review") || path[5].equals("ai-coverage"))
                || path[3].equals("defects") && path[5].equals("ai-analysis")))
            throw new HttpFailure(404, "NOT_FOUND", "Resource not found");
        JsonHttp.method(res, req.getMethod(), "POST");
        if (!req.getParameterMap().isEmpty()) throw new HttpFailure(400, "INVALID_QUERY", "Invalid query parameters");
        Long id = JsonHttp.positiveId(path[4]);
        var body = JsonHttp.read(req, Request.class);
        var service = (AiAssistanceService) req.getServletContext().getAttribute(AiAssistanceService.class.getName());
        if (service == null) throw new HttpFailure(503, "AI_NOT_CONFIGURED", "AI is not configured");
        Object result = switch (path[5]) {
            case "ai-review" -> service.review(actor, project, id, body.language());
            case "ai-coverage" -> service.coverage(actor, project, id, body.language());
            case "ai-analysis" -> service.analyzeDefect(actor, project, id, body.language());
            default -> throw new HttpFailure(404, "NOT_FOUND", "Resource not found");
        };
        JsonHttp.write(res, 200, result);
    }
}
