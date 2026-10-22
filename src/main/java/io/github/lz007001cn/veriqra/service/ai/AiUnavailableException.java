package io.github.lz007001cn.veriqra.service.ai;

public final class AiUnavailableException extends RuntimeException {
    private final String code;
    public AiUnavailableException(String code) { super(code); this.code = code; }
    public String code() { return code; }
}
