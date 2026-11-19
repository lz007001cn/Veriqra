package io.github.lz007001cn.veriqra.web.handler;

import io.github.lz007001cn.veriqra.config.AiConfig;
import io.github.lz007001cn.veriqra.service.ai.AiUnavailableException;
import io.github.lz007001cn.veriqra.service.exception.AuthenticationException;
import io.github.lz007001cn.veriqra.service.ai.ProjectChatService;
import io.github.lz007001cn.veriqra.web.HttpFailure;
import io.github.lz007001cn.veriqra.web.JsonHttp;
import jakarta.servlet.http.HttpServletRequest;
import jakarta.servlet.http.HttpServletResponse;
import jakarta.servlet.http.HttpSession;
import java.io.IOException;
import java.nio.charset.StandardCharsets;
import java.security.MessageDigest;
import java.util.List;
import java.util.Map;
import java.util.UUID;
import java.util.regex.Pattern;

public final class ProjectChatHandler {
    private static final Pattern MODE_COMMAND = Pattern.compile("^/(?:通用|general|项目|project)(?:\\s|$)", Pattern.CASE_INSENSITIVE);
    public record Request(String question, List<ProjectChatService.Message> history, String language,
                          String mode, String passphrase, String grant) { }

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
        if (body.question() != null && MODE_COMMAND.matcher(body.question().stripLeading()).find()) {
            throw new HttpFailure(400, "INVALID_CHAT_MODE", "Send chat commands through the mode control");
        }
        var chat = (ProjectChatService) req.getServletContext().getAttribute(ProjectChatService.class.getName());
        if (chat == null) throw new HttpFailure(503, "AI_NOT_CONFIGURED", "AI is not configured");
        try {
            switch (body.mode() == null ? "project" : body.mode()) {
                case "project" -> JsonHttp.write(res, 200, chat.ask(actor, projectId, body.question(), body.history(), body.language()));
                case "unlock" -> {
                    chat.requireAccess(actor, projectId);
                    var config = (AiConfig) req.getServletContext().getAttribute(AiConfig.class.getName());
                    String expected = config == null ? null : config.generalChatPassphrase();
                    if (expected == null || expected.isBlank())
                        throw new HttpFailure(422, "GENERAL_CHAT_DISABLED", "General chat is not configured");
                    if (!matches(expected, body.passphrase())) throw locked();
                    res.setHeader("Cache-Control", "no-store");
                    JsonHttp.write(res, 200, Map.of("unlocked", true, "grant", sessionGrant(req, projectId, true)));
                }
                case "general" -> {
                    if (!matches(sessionGrant(req, projectId, false), body.grant())) throw locked();
                    JsonHttp.write(res, 200, chat.askGeneral(actor, projectId, body.question(), body.history(), body.language()));
                }
                default -> throw new HttpFailure(400, "INVALID_CHAT_MODE", "Unknown chat mode");
            }
        } catch (AiUnavailableException e) {
            throw new HttpFailure(e.code().equals("AI_TIMEOUT") ? 504 : 503, e.code(), "Project chat is unavailable");
        }
    }

    private static String sessionGrant(HttpServletRequest request, Long projectId, boolean issue) {
        HttpSession session = request.getSession(false);
        if (session == null) throw new AuthenticationException();
        String key = ProjectChatHandler.class.getName() + ".general." + projectId;
        try {
            synchronized (session) {
                String grant = (String) session.getAttribute(key);
                if (issue && grant == null) {
                    grant = UUID.randomUUID().toString();
                    session.setAttribute(key, grant);
                }
                return grant;
            }
        } catch (IllegalStateException expired) {
            throw new AuthenticationException();
        }
    }

    private static boolean matches(String expected, String supplied) {
        return expected != null && supplied != null && MessageDigest.isEqual(
                expected.getBytes(StandardCharsets.UTF_8), supplied.getBytes(StandardCharsets.UTF_8));
    }

    private static HttpFailure locked() {
        return new HttpFailure(422, "GENERAL_CHAT_LOCKED", "General chat is locked");
    }
}
