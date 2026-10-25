package io.github.lz007001cn.veriqra.web.handler;

import io.github.lz007001cn.veriqra.model.ProjectRole;
import io.github.lz007001cn.veriqra.service.ProjectSettingsService;
import io.github.lz007001cn.veriqra.web.*;
import jakarta.servlet.http.*;
import java.io.IOException;

public final class ProjectSettingsHandler {
    private ProjectSettingsHandler() { }
    public record ManagerRequest(Long userId) { }
    public record MemberRequest(String username, ProjectRole projectRole) { }
    public static void handle(HttpServletRequest req,HttpServletResponse res,ProjectSettingsService service,
                              Long actor,Long project,String[] path) throws IOException {
        String method=req.getMethod();
        if(path.length==4) {
            switch(path[3]) {
                case "managers" -> {
                    JsonHttp.method(res, method, "GET", "POST");
                    if (method.equals("GET")) JsonHttp.write(res, 200, service.listManagers(actor, project));
                    else JsonHttp.write(res, 201, service.appointManager(actor, project, JsonHttp.read(req, ManagerRequest.class).userId()));
                }
                case "members" -> {
                    JsonHttp.method(res, method, "GET", "POST");
                    if (method.equals("GET")) JsonHttp.write(res, 200, service.listProjectMembers(actor, project));
                    else {
                        MemberRequest body = JsonHttp.read(req, MemberRequest.class);
                        JsonHttp.write(res, 201, service.addProjectMember(actor, project, body.username(), body.projectRole()));
                    }
                }
                default -> throw new HttpFailure(404,"NOT_FOUND","Resource not found");
            }
            return;
        }
        if(path.length==5 && path[3].equals("managers")) {
            JsonHttp.method(res,method,"DELETE");
            service.revokeManager(actor,project,JsonHttp.positiveId(path[4]));
            res.setStatus(204);return;
        }
        throw new HttpFailure(404,"NOT_FOUND","Resource not found");
    }
}
