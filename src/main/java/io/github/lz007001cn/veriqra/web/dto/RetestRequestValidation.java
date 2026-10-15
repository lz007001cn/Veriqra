package io.github.lz007001cn.veriqra.web.dto;

import java.util.Objects;
import java.util.UUID;

/** Field validation only. The Service remains authoritative for evidence and permissions. */
final class RetestRequestValidation {
    private RetestRequestValidation() { }

    static void positiveId(Long value, String field) {
        Objects.requireNonNull(value, field);
        if (value < 1) throw new IllegalArgumentException(field + " must be positive");
    }

    static void note(String value, String field) {
        text(value, field, 2000);
    }

    static void text(String value, String field, int maximum) {
        Objects.requireNonNull(value, field);
        if (value.isBlank() || value.codePointCount(0, value.length()) > maximum)
            throw new IllegalArgumentException(field + " exceeds permitted text bounds");
    }

    static UUID requestKey(String value) {
        Objects.requireNonNull(value, "requestKey");
        if (!value.matches("[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}"))
            throw new IllegalArgumentException("requestKey must be a canonical UUID");
        return UUID.fromString(value);
    }
}
