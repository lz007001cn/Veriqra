package io.github.lz007001cn.veriqra.web.handler;
import io.github.lz007001cn.veriqra.service.command.*;
import io.github.lz007001cn.veriqra.web.*;
import io.github.lz007001cn.veriqra.web.dto.*;
import jakarta.servlet.http.*;
import java.io.IOException;

public final class RequirementHandler {
    private RequirementHandler() { }
    public static void handle(HttpServletRequest req, HttpServletResponse res, WebServices s,
                              Long actor, Long project, String[] path) throws IOException {
        String method = req.getMethod();
        if (path.length >= 6 && path[5].equals("ai-cases")) {
            AiCaseHandler.handle(req, res, actor, project, path);
            return;
        }
        if (path.length == 4) {
            JsonHttp.method(res, method, "GET", "POST");
            if (method.equals("GET")) {
                JsonHttp.write(res, 200, s.requirements().listByProject(actor, project).stream().map(RequirementResponse::from).toList());
            } else {
                var b = JsonHttp.read(req, CreateRequirementRequest.class);
                var value = s.requirements().create(actor, new CreateRequirementCommand(project, b.title(), b.description(), b.priority()));
                res.setHeader("Location", req.getContextPath() + "/api/projects/" + project + "/requirements/" + value.id());
                JsonHttp.write(res, 201, RequirementResponse.from(value));
            }
            return;
        }
        if (path.length == 5) {
            Long id = JsonHttp.positiveId(path[4]);
            JsonHttp.method(res, method, "GET", "PUT");
            if (method.equals("GET")) {
                JsonHttp.write(res, 200, RequirementResponse.from(s.requirements().get(actor, project, id)));
            } else {
                var b = JsonHttp.read(req, UpdateRequirementRequest.class);
                JsonHttp.write(res, 200, RequirementResponse.from(s.requirements().update(actor, project,
                        new UpdateRequirementCommand(id, b.title(), b.description(), b.priority(), b.status(), b.expectedVersion()))));
            }
            return;
        }
        if (path.length >= 6 && path[5].equals("test-cases")) {
            Long requirement = JsonHttp.positiveId(path[4]);
            if (path.length == 6) {
                JsonHttp.method(res, method, "GET");
                JsonHttp.write(res, 200, s.traceability().listByRequirement(actor, project, requirement)
                        .stream().map(TraceabilityResponse::from).toList());
                return;
            }
            if (path.length == 7 || (path.length == 8 && (path[7].equals("confirm") || path[7].equals("remove")))) {
                Long testCase = JsonHttp.positiveId(path[6]);
                JsonHttp.method(res, method, "POST");
                JsonHttp.read(req, EmptyActionRequest.class);
                if (path.length == 7) s.traceability().attach(actor, project, requirement, testCase);
                else if (path[7].equals("confirm")) s.traceability().confirm(actor, project, requirement, testCase);
                else s.traceability().remove(actor, project, requirement, testCase);
                res.setStatus(204);
                return;
            }
        }
        throw new HttpFailure(404, "NOT_FOUND", "Resource not found");
    }
}
