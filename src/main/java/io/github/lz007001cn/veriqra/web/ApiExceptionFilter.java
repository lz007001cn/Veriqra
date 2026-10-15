package io.github.lz007001cn.veriqra.web;

import io.github.lz007001cn.veriqra.service.exception.*;
import io.github.lz007001cn.veriqra.web.dto.ApiError;
import io.github.lz007001cn.veriqra.admin.AdminConflictException;
import jakarta.servlet.*;
import jakarta.servlet.http.*;
import java.io.IOException;
import java.util.Set;

public final class ApiExceptionFilter implements Filter {
    private static final Set<String> WORKFLOW_CODES = Set.of("INSUFFICIENT_CREDIT", "CREDIT_BALANCE_OVERFLOW",
            "TRANSFER_SELF_NOT_ALLOWED", "TRANSFER_REQUEST_CONFLICT", "HANDOFF_SELF_NOT_ALLOWED",
            "HANDOFF_NOT_ALLOWED", "HANDOFF_ALREADY_RESOLVED", "HANDOFF_ASSIGNEE_CHANGED",
            "HANDOFF_PENDING_EXISTS", "HANDOFF_REQUEST_CONFLICT", "CREDIT_ACCOUNT_MISSING",
            "TASK_REWARD_LOCKED", "INVALID_OPERATION_ID", "INVALID_MONTH");
    @Override public void doFilter(ServletRequest input, ServletResponse output, FilterChain chain)
            throws IOException, ServletException {
        HttpServletRequest request = (HttpServletRequest) input;
        HttpServletResponse response = (HttpServletResponse) output;
        request.setCharacterEncoding("UTF-8");
        response.setHeader("Cache-Control", "no-store");
        response.setHeader("X-Content-Type-Options", "nosniff");
        try {
            chain.doFilter(input, output);
        } catch (Throwable failure) {
            int status = 500;
            String code = "INTERNAL_ERROR";
            String message = "An internal error occurred";
            String reasonCode = null;
            if (failure instanceof HttpFailure f) { status = f.status(); code = f.code(); message = f.getMessage(); }
            else if (failure instanceof AdminConflictException f) { status = 409; code = f.code(); message = f.getMessage(); }
            else if (failure instanceof io.github.lz007001cn.veriqra.web.security.LoginRateLimiter.Limited f) {
                status = 429; code = "TOO_MANY_REQUESTS"; message = "Login temporarily unavailable; retry later";
                response.setHeader("Retry-After", Long.toString(f.retryAfter()));
            }
            else if (failure instanceof AuthenticationException) { status = 401; code = "UNAUTHENTICATED"; message = "Authentication required or credentials invalid"; }
            else if (failure instanceof R1RuleException f) {
                status = 409; code = "CONFLICT"; message = "Request conflicts with current state";
                reasonCode = f.reasonCode();
            }
            else if (failure instanceof ValidationException) { status = 400; code = workflowCode(failure, "VALIDATION"); message = "Request validation failed"; }
            else if (failure instanceof NotFoundException) { status = 404; code = "NOT_FOUND"; message = "Resource not found"; }
            else if (failure instanceof ForbiddenException) { status = 403; code = "FORBIDDEN"; message = "Operation is not permitted"; }
            else if (failure instanceof ConflictException) { status = 409; code = workflowCode(failure, "CONFLICT"); message = "Request conflicts with current state"; }
            if (status == 500) {
                // Do not log exception messages/causes: a JDBC or JSON message may contain secrets.
                StringBuilder trace = new StringBuilder("Unhandled API failure: ").append(failure.getClass().getName());
                for (StackTraceElement frame : failure.getStackTrace()) trace.append("\n at ").append(frame);
                request.getServletContext().log(trace.toString());
            }
            if (!response.isCommitted()) {
                response.resetBuffer();
                String field = null;
                // Existing R1 reason codes remain authoritative and byte-for-byte unchanged.
                if (reasonCode == null && QaErrorDetails.isManualQaPath(request.getRequestURI(), request.getContextPath())) {
                    QaErrorDetails.Hint hint = QaErrorDetails.forFailure(failure, status);
                    if (hint != null) { reasonCode = hint.reasonCode(); field = hint.field(); }
                }
                JsonHttp.write(response, status, ApiError.of(code, message, reasonCode, field));
            }
            if (failure instanceof VirtualMachineError fatal) throw fatal;
            if (failure instanceof ThreadDeath fatal) throw fatal;
        }
    }
    private static String workflowCode(Throwable failure, String fallback) {
        return WORKFLOW_CODES.contains(failure.getMessage()) ? failure.getMessage() : fallback;
    }
}
