package io.github.lz007001cn.veriqra.web.dto;

public record ApiError(Error error) {
    public record Error(String code, String message, String reasonCode, String field) { }
    public static ApiError of(String code, String message) { return of(code, message, null); }
    public static ApiError of(String code, String message, String reasonCode) {
        return of(code, message, reasonCode, null);
    }
    public static ApiError of(String code, String message, String reasonCode, String field) {
        return new ApiError(new Error(code, message, reasonCode, field));
    }
}
