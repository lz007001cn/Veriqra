package io.github.lz007001cn.veriqra.service.exception;

/** A project membership change needs an explicit correction before it can be retried. */
public final class MembershipConflictException extends ConflictException {
    private final String code;

    public MembershipConflictException(String code, String message) {
        super(message);
        this.code = code;
    }

    public String code() { return code; }
}
