package io.github.lz007001cn.veriqra.web.handler;

import io.github.lz007001cn.veriqra.service.command.*;
import io.github.lz007001cn.veriqra.web.*;
import io.github.lz007001cn.veriqra.web.dto.*;
import jakarta.servlet.http.*;
import java.io.IOException;

public final class TestImportHandler {
    private TestImportHandler() { }

    public static void handle(HttpServletRequest req, HttpServletResponse res, WebServices services,
                              Long actor, Long projectId, String[] path) throws IOException {
        try { execute(req,res,services,actor,projectId,path); }
        catch (io.github.lz007001cn.veriqra.service.exception.ValidationException failure) {
            String code = switch (failure.getMessage()) {
                case "Invalid or unsafe JUnit XML" -> "IMPORT_XML_INVALID";
                case "JUnit XML root must be testsuite or testsuites" -> "IMPORT_XML_ROOT";
                case "JUnit XML contains no testcase entries", "JUnit XML payload is required" -> "IMPORT_XML_EMPTY";
                case "JUnit XML contains too many testcase entries" -> "IMPORT_XML_TOO_MANY";
                default -> "IMPORT_INPUT_INVALID";
            };
            throw new HttpFailure(400,code,"Check the JUnit report and import fields");
        }
    }
    private static void execute(HttpServletRequest req, HttpServletResponse res, WebServices services,
                                Long actor, Long projectId, String[] path) throws IOException {
        if (req.getMethod().equals("GET")) {
            if (path.length == 4) {
                String run = req.getParameter("runId");
                JsonHttp.write(res, 200, services.imports().list(actor, projectId, run == null ? null : JsonHttp.positiveId(run))
                        .stream().map(ImportExecutionResponse.ImportRecordResponse::from).toList());
                return;
            }
            if (path.length == 5 && !path[4].equals("preview")) {
                JsonHttp.write(res, 200, ImportExecutionResponse.from(services.imports().get(actor, projectId,
                        JsonHttp.positiveId(path[4]), null)));
                return;
            }
            if (path.length == 6 && path[4].equals("requests")) {
                java.util.UUID key;
                try { key = java.util.UUID.fromString(path[5]); }
                catch (IllegalArgumentException e) { throw new HttpFailure(400, "VALIDATION", "Invalid request key"); }
                JsonHttp.write(res, 200, ImportExecutionResponse.from(services.imports().get(actor, projectId, null, key)));
                return;
            }
        }
        JsonHttp.method(res, req.getMethod(), "POST");
        if (path.length == 5 && path[4].equals("preview")) {
            byte[] payload = XmlHttp.read(req);
            var preview = services.imports().analyzeImport(actor,
                    new AnalyzeTestImportCommand(projectId,
                            XmlHttp.requiredParameter(req, "sourceNamespace"), payload));
            JsonHttp.write(res, 200, ImportPreviewResponse.from(preview));
            return;
        }
        if (path.length == 4) {
            byte[] payload = XmlHttp.read(req);
            var result = services.imports().importReport(actor, new ImportTestResultsCommand(projectId,
                    XmlHttp.requiredUuidParameter(req, "requestKey"),
                    XmlHttp.requiredParameter(req, "sourceNamespace"),
                    XmlHttp.requiredParameter(req, "originalFilename"),
                    XmlHttp.requiredParameter(req, "runName"),
                    XmlHttp.optionalParameter(req, "environment"),
                    XmlHttp.optionalParameter(req, "buildVersion"), payload));
            res.setHeader("Location", req.getContextPath() + "/api/projects/" + projectId + "/runs/"
                    + result.testRun().id());
            JsonHttp.write(res, result.replayed() ? 200 : 201, ImportExecutionResponse.from(result));
            return;
        }
        throw new HttpFailure(404, "NOT_FOUND", "Resource not found");
    }
}
