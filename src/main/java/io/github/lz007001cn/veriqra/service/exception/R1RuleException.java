package io.github.lz007001cn.veriqra.service.exception;

/** Stable, safe reason only. HTTP translates this without exposing internal exception text. */
public final class R1RuleException extends ConflictException {
    private final String reasonCode;
    public R1RuleException(String reasonCode) {
        super("R1 workflow constraint");
        if(reasonCode==null || !reasonCode.matches("[A-Z_]{3,64}"))throw new IllegalArgumentException("Invalid R1 reason");
        this.reasonCode=reasonCode;
    }
    public String reasonCode(){return reasonCode;}
}
