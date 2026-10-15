package io.github.lz007001cn.veriqra.web.handler;
import io.github.lz007001cn.veriqra.model.DefectStatus;
import io.github.lz007001cn.veriqra.service.command.*;
import io.github.lz007001cn.veriqra.web.*;
import io.github.lz007001cn.veriqra.web.dto.*;
import jakarta.servlet.http.*;
import java.io.IOException;
import java.util.Set;
import java.util.UUID;

public final class DefectHandler {
    private DefectHandler() { }
    public static void handle(HttpServletRequest req, HttpServletResponse res, WebServices s,
                              Long actor, Long project, String[] path) throws IOException {
        String method = req.getMethod();
        if (path.length == 4) {
            JsonHttp.method(res, method, "GET", "POST");
            if (method.equals("GET")) {
                JsonHttp.write(res, 200, s.defects().listByProject(actor, project).stream().map(DefectResponse::from).toList());
            } else {
                var b = JsonHttp.read(req, CreateDefectRequest.class);
                var value = s.defects().create(actor, new CreateDefectCommand(project, b.failureAttemptId(), b.title(),
                        b.description(), b.severity(), b.priority(), b.assigneeId()));
                res.setHeader("Location", req.getContextPath() + "/api/projects/" + project + "/defects/" + value.id());
                JsonHttp.write(res, 201, DefectResponse.from(value));
            }
            return;
        }
        if (path.length == 5) {
            Long id = JsonHttp.positiveId(path[4]);
            JsonHttp.method(res, method, "GET", "PUT");
            if (method.equals("GET")) {
                JsonHttp.write(res, 200, DefectDetailResponse.from(s.defects().getDetails(actor, project, id)));
            } else {
                var b = JsonHttp.read(req, UpdateDefectRequest.class);
                JsonHttp.write(res, 200, DefectResponse.from(s.defects().update(actor, project,
                        new UpdateDefectCommand(id, b.title(), b.description(), b.severity(), b.priority(), b.assigneeId(), b.expectedVersion()))));
            }
            return;
        }
        if (path.length == 6) {
            Long id = JsonHttp.positiveId(path[4]);
            switch (path[5]) {
                case "closure-eligibility" -> {
                    JsonHttp.method(res, method, "GET");
                    queryFields(req);
                    JsonHttp.write(res, 200, s.defects().closureEligibility(actor, project, id));
                    return;
                }
                case "retest-candidates" -> {
                    JsonHttp.method(res, method, "GET");
                    queryFields(req, "failureAttemptId", "cursor", "pageSize");
                    Long failure = JsonHttp.positiveId(query(req, "failureAttemptId", true));
                    String cursor = query(req, "cursor", false), size = query(req, "pageSize", false);
                    Long after = cursor == null ? null : JsonHttp.positiveId(cursor);
                    long pageSize = size == null ? 25 : JsonHttp.positiveId(size);
                    if (pageSize > 100) throw invalidQuery();
                    JsonHttp.write(res, 200, s.defects().retestCandidates(actor, project, id, failure, after, (int) pageSize));
                    return;
                }
                case "retests" -> {
                    JsonHttp.method(res, method, "POST");
                    var b = JsonHttp.read(req, LinkRetestRequest.class);
                    JsonHttp.write(res, 200, s.defects().linkRetest(actor, project,
                            new LinkRetestCommand(id, b.failureAttemptId(), b.passAttemptId(), b.expectedVersion(),
                                    b.parsedRequestKey(), b.reviewNote(), b.timingBasis(), b.oldLinkId(), b.revokeReason())));
                    return;
                }
                default -> { }
            }
            switch (path[5]) {
                case "start", "close" -> {
                    JsonHttp.method(res, method, "POST");
                    var b = JsonHttp.read(req, ExpectedVersionRequest.class);
                    s.defects().transition(actor, project, new TransitionDefectCommand(id,
                            path[5].equals("start") ? DefectStatus.IN_PROGRESS : DefectStatus.CLOSED, null, b.expectedVersion()));
                }
                case "resolve" -> {
                    JsonHttp.method(res, method, "POST");
                    var b = JsonHttp.read(req, ResolveDefectRequest.class);
                    s.defects().transition(actor, project, new TransitionDefectCommand(id, DefectStatus.RESOLVED, b.resolutionNote(), b.expectedVersion()));
                }
                case "reopen" -> {
                    JsonHttp.method(res, method, "POST");
                    var b = JsonHttp.read(req, ReopenDefectRequest.class);
                    s.defects().reopen(actor, project, new ReopenDefectCommand(id, b.failureAttemptId(), b.assigneeId(), b.expectedVersion()));
                }
                case "evidence" -> {
                    JsonHttp.method(res, method, "POST");
                    var b = JsonHttp.read(req, AddEvidenceRequest.class);
                    s.defects().addEvidence(actor, project, id, b.failureAttemptId(), b.expectedVersion());
                }
                default -> throw new HttpFailure(404, "NOT_FOUND", "Resource not found");
            }
            res.setStatus(204);
            return;
        }
        if (path.length == 7 && path[5].equals("retest-operations")) {
            Long id = JsonHttp.positiveId(path[4]);
            JsonHttp.method(res, method, "GET");
            queryFields(req, "action");
            String action = query(req, "action", true);
            if (!action.equals("LINK") && !action.equals("REVOKE")) throw invalidQuery();
            var result = s.defects().recoverRetestOperation(actor, project, id, requestKey(path[6]), action)
                    .orElseThrow(() -> new HttpFailure(404, "NOT_FOUND", "Resource not found"));
            JsonHttp.write(res, 200, result);
            return;
        }
        if (path.length == 8 && path[5].equals("retests") && path[7].equals("revoke")) {
            Long id = JsonHttp.positiveId(path[4]), link = JsonHttp.positiveId(path[6]);
            JsonHttp.method(res, method, "POST");
            var b = JsonHttp.read(req, RevokeRetestRequest.class);
            JsonHttp.write(res, 200, s.defects().revokeRetest(actor, project,
                    new RevokeRetestCommand(id, link, b.expectedVersion(), b.parsedRequestKey(), b.reason())));
            return;
        }
        // Explicit correction action follows the existing relation-removal API convention.
        if (path.length == 8 && path[5].equals("evidence") && path[7].equals("remove")) {
            Long id = JsonHttp.positiveId(path[4]), attempt = JsonHttp.positiveId(path[6]);
            JsonHttp.method(res, method, "POST");
            var b = JsonHttp.read(req, RemoveEvidenceRequest.class);
            s.defects().removeEvidence(actor, project, id, attempt, b.expectedVersion());
            res.setStatus(204);
            return;
        }
        throw new HttpFailure(404, "NOT_FOUND", "Resource not found");
    }

    private static void queryFields(HttpServletRequest req, String... allowed) {
        Set<String> fields = Set.of(allowed);
        if (!fields.containsAll(req.getParameterMap().keySet())) throw invalidQuery();
    }
    private static String query(HttpServletRequest req, String field, boolean required) {
        String[] values = req.getParameterValues(field);
        if (values == null) {
            if (required) throw invalidQuery();
            return null;
        }
        if (values.length != 1 || values[0].isEmpty()) throw invalidQuery();
        return values[0];
    }
    private static UUID requestKey(String value) {
        if (!value.matches("[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}"))
            throw new HttpFailure(400, "INVALID_REQUEST_KEY", "Expected a canonical UUID request key");
        return UUID.fromString(value);
    }
    private static HttpFailure invalidQuery() {
        return new HttpFailure(400, "INVALID_QUERY", "Invalid query parameters");
    }
}
