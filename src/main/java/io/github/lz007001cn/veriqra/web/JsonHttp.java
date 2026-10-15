package io.github.lz007001cn.veriqra.web;

import io.github.lz007001cn.veriqra.web.json.JsonMapperProvider;
import jakarta.servlet.http.*;
import java.io.*;
import java.nio.*;
import java.nio.charset.*;

public final class JsonHttp {
    private static final int MAX_BODY = 65536;
    private JsonHttp() { }

    public static <T> T read(HttpServletRequest request, Class<T> type) throws IOException {
        String contentType = request.getContentType();
        if (contentType == null || !contentType.split(";", 2)[0].strip().equalsIgnoreCase("application/json")) {
            throw new HttpFailure(415, "UNSUPPORTED_MEDIA_TYPE", "Expected application/json");
        }
        byte[] bytes = request.getInputStream().readNBytes(MAX_BODY + 1);
        if (bytes.length > MAX_BODY) throw new HttpFailure(413, "PAYLOAD_TOO_LARGE", "JSON body exceeds 64 KiB");
        try {
            String text = StandardCharsets.UTF_8.newDecoder().onMalformedInput(CodingErrorAction.REPORT)
                    .onUnmappableCharacter(CodingErrorAction.REPORT).decode(ByteBuffer.wrap(bytes)).toString();
            T value = JsonMapperProvider.readerFor(type).readValue(text);
            if (value == null) throw new HttpFailure(400, "INVALID_JSON", "Expected a JSON object");
            return value;
        } catch (com.fasterxml.jackson.core.JsonProcessingException e) {
            // Jackson messages can include caller-supplied secrets. Never expose or log the parse exception.
            throw new HttpFailure(400, "INVALID_JSON", "Malformed JSON, unknown field or invalid field type",
                    QaErrorDetails.forJsonFailure(e));
        } catch (CharacterCodingException e) {
            throw new HttpFailure(400, "INVALID_JSON", "Malformed JSON, unknown field or invalid field type");
        }
    }

    public static void write(HttpServletResponse response, int status, Object body) throws IOException {
        // Serialize before committing headers, so a serialization failure can still become a JSON 500.
        byte[] bytes = JsonMapperProvider.writer().writeValueAsBytes(body);
        response.setStatus(status);
        response.setContentType("application/json;charset=UTF-8");
        response.setCharacterEncoding("UTF-8");
        response.getOutputStream().write(bytes);
    }

    public static void method(HttpServletResponse response, String actual, String... allowed) {
        for (String candidate : allowed) if (candidate.equals(actual)) return;
        response.setHeader("Allow", String.join(", ", allowed));
        throw new HttpFailure(405, "METHOD_NOT_ALLOWED", "HTTP method not allowed");
    }

    public static long positiveId(String text) {
        try {
            if (!text.matches("[1-9][0-9]*")) throw new NumberFormatException();
            return Long.parseLong(text);
        } catch (NumberFormatException e) {
            throw new HttpFailure(400, "INVALID_ID", "Expected a positive integer ID");
        }
    }
}
