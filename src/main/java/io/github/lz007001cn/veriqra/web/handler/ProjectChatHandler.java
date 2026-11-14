package io.github.lz007001cn.veriqra.web.handler;

import io.github.lz007001cn.veriqra.service.ai.AiUnavailableException;
import io.github.lz007001cn.veriqra.service.ai.ProjectChatService;
import io.github.lz007001cn.veriqra.web.HttpFailure;
import io.github.lz007001cn.veriqra.web.JsonHttp;
import jakarta.servlet.http.HttpServletRequest;
import jakarta.servlet.http.HttpServletResponse;
import java.io.IOException;
import java.util.List;

public final class ProjectChatHandler {
    public record Request(String question, List<ProjectChatService.Message> history, String language) { }

    private ProjectChatHandler() { }

    public static void handle(HttpServletRequest req, HttpServletResponse res, Long actor, Long projectId,
                              String[] path) throws IOException {
        if (path.length != 5 || !path[4].equals("chat")) {
            throw new HttpFailure(404, "NOT_FOUND", "Resource not found");
        }
        JsonHttp.method(res, req.getMethod(), "POST");
        if (!req.getParameterMap().isEmpty()) {
            throw new HttpFailure(400, "INVALID_QUERY", "Invalid query parameters");
        }
        var body = JsonHttp.read(req, Request.class);
        var chat = (ProjectChatService) req.getServletContext().getAttribute(ProjectChatService.class.getName());
        if (chat == null) throw new HttpFailure(503, "AI_NOT_CONFIGURED", "AI is not configured");
        try {
            JsonHttp.write(res, 200, chat.ask(actor, projectId, body.question(), body.history(), body.language()));
        } catch (AiUnavailableException e) {
            throw new HttpFailure(e.code().equals("AI_TIMEOUT") ? 504 : 503, e.code(), "Project chat is unavailable");
        }
    }
}
