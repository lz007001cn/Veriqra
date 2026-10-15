package io.github.lz007001cn.veriqra.web.handler;
import io.github.lz007001cn.veriqra.service.command.*;
import io.github.lz007001cn.veriqra.web.*;
import io.github.lz007001cn.veriqra.web.dto.*;
import jakarta.servlet.http.*;
import java.io.IOException;

public final class TestCaseHandler {
    private TestCaseHandler() { }
    public static void handle(HttpServletRequest req, HttpServletResponse res, WebServices s,
                              Long actor, Long project, String[] path) throws IOException {
        String method = req.getMethod();
        if (path.length == 4) {
            JsonHttp.method(res, method, "GET", "POST");
            if (method.equals("GET")) {
                JsonHttp.write(res, 200, s.testCases().listByProject(actor, project).stream().map(TestCaseResponse::from).toList());
            } else {
                var b = JsonHttp.read(req, CreateTestCaseRequest.class);
                var value = s.testCases().create(actor, new CreateTestCaseCommand(project, b.title(), b.description(),
                        b.preconditions(), b.priority(), b.steps().stream().map(TestStepRequest::toInput).toList()));
                res.setHeader("Location", req.getContextPath() + "/api/projects/" + project + "/test-cases/" + value.id());
                JsonHttp.write(res, 201, TestCaseResponse.from(value));
            }
            return;
        }
        if (path.length == 5) {
            Long id = JsonHttp.positiveId(path[4]);
            JsonHttp.method(res, method, "GET", "PUT");
            if (method.equals("GET")) {
                JsonHttp.write(res, 200, TestCaseDetailResponse.from(s.testCases().getDetails(actor, project, id)));
            } else {
                var b = JsonHttp.read(req, UpdateTestCaseRequest.class);
                JsonHttp.write(res, 200, TestCaseResponse.from(s.testCases().update(actor, project,
                        new UpdateTestCaseCommand(id, b.title(), b.description(), b.preconditions(), b.priority(),
                                b.status(), b.expectedVersion(), b.steps().stream().map(TestStepRequest::toInput).toList()))));
            }
            return;
        }
        if (path.length == 6 && path[5].equals("requirements")) {
            JsonHttp.method(res, method, "GET");
            if (!req.getParameterMap().isEmpty())
                throw new HttpFailure(400, "INVALID_QUERY", "Invalid query parameters");
            JsonHttp.write(res, 200, s.traceability().listByTestCase(actor, project, JsonHttp.positiveId(path[4]))
                    .stream().map(CaseRequirementResponse::from).toList());
            return;
        }
        throw new HttpFailure(404, "NOT_FOUND", "Resource not found");
    }
}
