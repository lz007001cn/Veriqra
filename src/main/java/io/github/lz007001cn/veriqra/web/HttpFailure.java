package io.github.lz007001cn.veriqra.web;

/** HTTP transport failure; deliberately kept outside the Service exception hierarchy. */
public final class HttpFailure extends RuntimeException {
    private final int status;
    private final String code;
    private final QaErrorDetails.Hint hint;
    public HttpFailure(int status, String code, String message) {
        this(status, code, message, null);
    }
    HttpFailure(int status, String code, String message, QaErrorDetails.Hint hint) {
        super(message); this.status = status; this.code = code; this.hint = hint;
    }
    public int status() { return status; }
    public String code() { return code; }
    QaErrorDetails.Hint hint() { return hint; }
}
