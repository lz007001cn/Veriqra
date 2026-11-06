package io.github.lz007001cn.veriqra.web.handler;

import com.fasterxml.jackson.core.JsonFactory;
import com.fasterxml.jackson.core.JsonProcessingException;
import com.fasterxml.jackson.core.StreamReadConstraints;
import com.fasterxml.jackson.core.StreamReadFeature;
import io.github.lz007001cn.veriqra.service.DefectCommentService;
import io.github.lz007001cn.veriqra.web.HttpFailure;
import io.github.lz007001cn.veriqra.web.JsonHttp;
import io.github.lz007001cn.veriqra.web.json.JsonMapperProvider;
import jakarta.servlet.http.HttpServletRequest;
import jakarta.servlet.http.HttpServletResponse;
import java.io.IOException;
import java.nio.ByteBuffer;
import java.nio.charset.CharacterCodingException;
import java.nio.charset.CodingErrorAction;
import java.nio.charset.StandardCharsets;

/** Discussion metadata is JSON. Screenshot reads use the authenticated project route. */
public final class DefectCommentHandler {
    private static final int MAX_BODY = DefectCommentService.MAX_ENCODED_IMAGE + 65_536;
    private static final JsonFactory REQUEST_JSON = JsonFactory.builder()
            .enable(StreamReadFeature.STRICT_DUPLICATE_DETECTION)
            .streamReadConstraints(StreamReadConstraints.builder().maxNestingDepth(8)
                    .maxNumberLength(32).maxStringLength(DefectCommentService.MAX_ENCODED_IMAGE).build())
            .build();
    private DefectCommentHandler() { }

    public record Request(String requestKey, String text, String logUrl, String imageBase64) { }

    public static void handle(HttpServletRequest request, HttpServletResponse response, Long actor, Long project, String[] path) throws IOException {
        long defect = JsonHttp.positiveId(path[4]);
        var service = (DefectCommentService) request.getServletContext().getAttribute(DefectCommentService.class.getName());
        if (service == null) throw new HttpFailure(503, "COMMENTS_UNAVAILABLE", "Defect discussion is unavailable");
        if (path.length == 8 && path[7].equals("image")) {
            JsonHttp.method(response, request.getMethod(), "GET");
            noQuery(request);
            var image = service.image(actor, project, defect, JsonHttp.positiveId(path[6]));
            response.setStatus(200);
            response.setContentType(image.contentType());
            response.setContentLength(image.bytes().length);
            response.setHeader("Cache-Control", "no-store");
            response.setHeader("X-Content-Type-Options", "nosniff");
            response.setHeader("Content-Disposition", image.contentType().equals("image/png") ? "inline; filename=screenshot.png" : "inline; filename=screenshot.jpg");
            response.getOutputStream().write(image.bytes());
            return;
        }
        if (path.length != 6) throw new HttpFailure(404, "NOT_FOUND", "Resource not found");
        JsonHttp.method(response, request.getMethod(), "GET", "POST");
        if (request.getMethod().equals("GET")) {
            JsonHttp.write(response, 200, service.list(actor, project, defect, beforeId(request)));
            return;
        }
        noQuery(request);
        Request body = read(request);
        try {
            var result = service.add(actor, project, defect, body.requestKey(), body.text(), body.logUrl(), body.imageBase64());
            JsonHttp.write(response, result.replayed() ? 200 : 201, result);
        } catch (DefectCommentService.ScreenshotException failure) {
            throw new HttpFailure(failure.tooLarge() ? 413 : 400, failure.tooLarge() ? "SCREENSHOT_TOO_LARGE" : "INVALID_SCREENSHOT", failure.getMessage());
        }
    }

    private static Long beforeId(HttpServletRequest request) {
        var parameters = request.getParameterMap();
        if (parameters.isEmpty()) return null;
        String[] values = parameters.get("beforeId");
        if (parameters.size() != 1 || values == null || values.length != 1) throw invalidQuery();
        return JsonHttp.positiveId(values[0]);
    }

    private static void noQuery(HttpServletRequest request) {
        if (!request.getParameterMap().isEmpty()) throw invalidQuery();
    }

    private static HttpFailure invalidQuery() { return new HttpFailure(400, "INVALID_QUERY", "Invalid discussion query"); }

    private static Request read(HttpServletRequest request) throws IOException {
        String type = request.getContentType();
        if (type == null || !type.split(";", 2)[0].strip().equalsIgnoreCase("application/json"))
            throw new HttpFailure(415, "UNSUPPORTED_MEDIA_TYPE", "Expected application/json");
        if (request.getContentLengthLong() > MAX_BODY) throw oversized();
        byte[] bytes = request.getInputStream().readNBytes(MAX_BODY + 1);
        if (bytes.length > MAX_BODY) throw oversized();
        try {
            String text = StandardCharsets.UTF_8.newDecoder().onMalformedInput(CodingErrorAction.REPORT)
                    .onUnmappableCharacter(CodingErrorAction.REPORT).decode(ByteBuffer.wrap(bytes)).toString();
            try (var parser = REQUEST_JSON.createParser(text)) {
                Request body = JsonMapperProvider.readerFor(Request.class).readValue(parser);
                if (body == null) throw invalidJson();
                return body;
            }
        } catch (JsonProcessingException | CharacterCodingException e) { throw invalidJson(); }
    }

    private static HttpFailure oversized() { return new HttpFailure(413, "PAYLOAD_TOO_LARGE", "Discussion request exceeds its upload limit"); }
    private static HttpFailure invalidJson() { return new HttpFailure(400, "INVALID_JSON", "Malformed JSON, unknown field or invalid field type"); }
}
