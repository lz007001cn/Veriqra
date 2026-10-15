package io.github.lz007001cn.veriqra.web.handler;
import io.github.lz007001cn.veriqra.service.command.*;
import io.github.lz007001cn.veriqra.web.*;
import io.github.lz007001cn.veriqra.web.dto.*;
import jakarta.servlet.http.*;
import java.io.IOException;

public final class TestRunHandler {
    private TestRunHandler() { }
    public static void handle(HttpServletRequest req, HttpServletResponse res, WebServices s,
                              Long actor, Long project, String[] path) throws IOException {
        String method = req.getMethod();
        if (path.length == 4) {
            JsonHttp.method(res, method, "GET", "POST");
            if (method.equals("GET")) {
                JsonHttp.write(res, 200, s.testRuns().listByProject(actor, project).stream().map(RunResponse::from).toList());
            } else {
                var b = JsonHttp.read(req, CreateRunRequest.class);
                var value = b.testPlanId() != null
                        ? s.testRuns().createFromPlan(actor, new CreatePlanRunCommand(project, b.testPlanId(), b.name(), b.environment(), b.buildVersion()))
                        : s.testRuns().createAdHoc(actor, new CreateAdHocRunCommand(project, b.name(), b.environment(), b.buildVersion(), b.testCaseIds()));
                res.setHeader("Location", req.getContextPath() + "/api/projects/" + project + "/runs/" + value.id());
                JsonHttp.write(res, 201, RunResponse.from(value));
            }
            return;
        }
        if (path.length == 5) {
            Long run = JsonHttp.positiveId(path[4]);
            JsonHttp.method(res, method, "GET");
            JsonHttp.write(res, 200, RunDetailResponse.from(s.testRuns().getDetails(actor, project, run)));
            return;
        }
        if (path.length == 6 && (path[5].equals("complete") || path[5].equals("cancel"))) {
            Long run = JsonHttp.positiveId(path[4]);
            JsonHttp.method(res, method, "POST");
            var b = JsonHttp.read(req, ExpectedVersionRequest.class);
            if (path[5].equals("complete")) s.testRuns().complete(actor, project, run, b.expectedVersion());
            else s.testRuns().cancel(actor, project, run, b.expectedVersion());
            res.setStatus(204);
            return;
        }
        if (path.length == 6 && path[5].equals("completion-impact")) {
            Long run = JsonHttp.positiveId(path[4]);
            JsonHttp.method(res, method, "GET");
            if (!req.getParameterMap().isEmpty())
                throw new HttpFailure(400, "INVALID_QUERY", "Invalid query parameters");
            JsonHttp.write(res, 200, s.testRuns().completionImpact(actor, project, run));
            return;
        }
        if (path.length == 8 && path[5].equals("cases") && path[7].equals("attempts")) {
            Long run = JsonHttp.positiveId(path[4]), runCase = JsonHttp.positiveId(path[6]);
            JsonHttp.method(res, method, "GET", "POST");
            if (method.equals("GET")) {
                JsonHttp.write(res, 200, s.execution().listAttempts(actor, project, run, runCase).stream().map(AttemptResponse::from).toList());
            } else {
                var b = JsonHttp.read(req, RecordAttemptRequest.class);
                var value = s.execution().recordAttempt(actor, project, run, new RecordAttemptCommand(runCase,
                        b.outcome(), b.durationMs(), b.comment(), b.failureMessage(), b.submissionKey()));
                JsonHttp.write(res, 201, AttemptResponse.from(value));
            }
            return;
        }
        if (path.length == 10 && path[5].equals("cases") && path[7].equals("attempts") && path[9].equals("defects")) {
            JsonHttp.method(res, method, "GET");
            if (!req.getParameterMap().isEmpty())
                throw new HttpFailure(400, "INVALID_QUERY", "Invalid query parameters");
            JsonHttp.write(res, 200, s.defects().listForAttempt(actor, project,
                    JsonHttp.positiveId(path[4]), JsonHttp.positiveId(path[6]), JsonHttp.positiveId(path[8]))
                    .stream().map(DefectResponse::from).toList());
            return;
        }
        throw new HttpFailure(404, "NOT_FOUND", "Resource not found");
    }
}
