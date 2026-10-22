package io.github.lz007001cn.veriqra.web.handler;

import io.github.lz007001cn.veriqra.service.ai.*;
import io.github.lz007001cn.veriqra.web.*;
import io.github.lz007001cn.veriqra.web.dto.TestCaseResponse;
import jakarta.servlet.http.*;
import java.io.IOException;
import java.util.List;

public final class AiCaseHandler {
    private AiCaseHandler() { }
    public record GenerateRequest(String instruction) { }
    public record AcceptRequest(Integer expectedVersion, List<AiCandidate> candidates) { }
    public static void handle(HttpServletRequest req, HttpServletResponse res, Long actor, Long project, String[] path) throws IOException {
        if (path.length != 7 || (!path[6].equals("preview") && !path[6].equals("accept"))) throw new HttpFailure(404, "NOT_FOUND", "Resource not found");
        JsonHttp.method(res, req.getMethod(), "POST");
        var service = (AiCaseService) req.getServletContext().getAttribute(AiCaseService.class.getName());
        if (service == null) throw new HttpFailure(503, "AI_NOT_CONFIGURED", "AI is not configured");
        Long requirement = JsonHttp.positiveId(path[4]);
        if (path[6].equals("preview")) {
            var body = JsonHttp.read(req, GenerateRequest.class);
            JsonHttp.write(res, 200, service.generate(actor, project, requirement, body.instruction()));
        } else {
            var body = JsonHttp.read(req, AcceptRequest.class);
            JsonHttp.write(res, 201, service.accept(actor, project, requirement, body.expectedVersion(), body.candidates())
                    .stream().map(TestCaseResponse::from).toList());
        }
    }
}
