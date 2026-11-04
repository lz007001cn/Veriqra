package io.github.lz007001cn.veriqra.service.ai;

/** Sanitized upstream failure. Neither response bodies, URLs nor credential details are retained. */
public final class GoogleApiException extends RuntimeException {
    private final int status;
    private final String code;

    public GoogleApiException(int status, String code) {
        super("Google API request failed: " + code);
        this.status = status;
        this.code = code;
    }

    public int status() { return status; }
    public String code() { return code; }
}
