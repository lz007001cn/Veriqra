package io.github.lz007001cn.veriqra.web;

import io.github.lz007001cn.veriqra.service.exception.*;
import java.util.Map;
import java.util.Set;

/** Safe presentation hints for the manual QA API. Never serializes exception text or input values. */
final class QaErrorDetails {
    record Hint(String reasonCode, String field) { }
    private static final Set<String> FIELDS = Set.of("title", "name", "priority", "severity", "status",
            "steps", "step", "projectId", "requirementId", "testCaseId", "testPlanId", "testCaseIds",
            "runId", "runCaseId", "attemptId", "failureAttemptId", "assigneeId", "resolutionNote",
            "lockVersion", "expectedVersion", "planLockVersion", "outcome", "durationMs", "submissionKey");
    private static final Map<String, Hint> FIXED = Map.ofEntries(
            Map.entry("READY test case requires at least one step", hint("QA_CASE_STEPS_REQUIRED", "steps")),
            Map.entry("Only READY test cases can be included in a test run", hint("QA_CASE_NOT_READY", "testCaseIds")),
            Map.entry("READY test plan requires every test case to be READY", hint("QA_CASE_NOT_READY", "testCaseIds")),
            Map.entry("Only a READY test plan can create a run", hint("QA_PLAN_NOT_READY", "testPlanId")),
            Map.entry("Executable test plan cannot be empty", hint("QA_PLAN_EMPTY", "testCaseIds")),
            Map.entry("READY test plan requires at least one test case", hint("QA_PLAN_EMPTY", "testCaseIds")),
            Map.entry("Test plan scope changed during run creation", hint("QA_SCOPE_CHANGED", "testCaseIds")),
            Map.entry("Test plan scope changed during update", hint("QA_SCOPE_CHANGED", "testCaseIds")),
            Map.entry("Test plan scope changed during removal", hint("QA_SCOPE_CHANGED", "testCaseIds")),
            Map.entry("stepOrder must be contiguous from 1", hint("QA_STEPS_INVALID", "steps")),
            Map.entry("step action is required", hint("QA_FIELD_REQUIRED", "steps")),
            Map.entry("step expectedResult is required", hint("QA_FIELD_REQUIRED", "steps")),
            Map.entry("steps is required; use an empty list for a draft without steps", hint("QA_FIELD_REQUIRED", "steps")),
            Map.entry("testCaseIds is required; use an empty list for no initial scope", hint("QA_FIELD_REQUIRED", "testCaseIds")),
            Map.entry("Ad-hoc run requires testCaseIds", hint("QA_FIELD_REQUIRED", "testCaseIds")),
            Map.entry("Duplicate testCaseId is not allowed", hint("QA_INVALID_RELATION", "testCaseIds")),
            Map.entry("Resource does not belong to the requested project", hint("QA_INVALID_RELATION", null)),
            Map.entry("Requirement and test case must belong to the same project", hint("QA_INVALID_RELATION", null)),
            Map.entry("Failure attempt belongs to another project", hint("QA_INVALID_RELATION", "failureAttemptId")),
            Map.entry("Test case belongs to another project", hint("QA_INVALID_RELATION", "testCaseIds")),
            Map.entry("Test plan belongs to another project", hint("QA_INVALID_RELATION", "testPlanId")),
            Map.entry("Defect evidence must be a FAIL attempt", hint("QA_INVALID_RELATION", "failureAttemptId")),
            Map.entry("expectedVersion must be nonnegative", hint("QA_INVALID_INPUT", "expectedVersion")));

    private QaErrorDetails() { }
    static boolean isManualQaPath(String requestUri, String contextPath) {
        if (requestUri == null || contextPath == null || !requestUri.startsWith(contextPath)) return false;
        return requestUri.substring(contextPath.length())
                .matches("/api/projects/[1-9][0-9]*/(?:requirements|test-cases|test-plans|runs|defects)(?:/.*)?");
    }
    static Hint forFailure(Throwable failure, int status) {
        if (failure instanceof ForbiddenException || status == 403) return hint("QA_FORBIDDEN", null);
        if (status != 400 && status != 409) return null;
        if (failure instanceof HttpFailure transport && transport.hint() != null) return transport.hint();
        // Only explicit, fixed Service diagnostics are eligible; no arbitrary HttpFailure message mapping.
        if (failure instanceof ValidationException || failure instanceof ConflictException) {
            String message = failure.getMessage();
            Hint fixed = FIXED.get(message == null ? "" : message);
            if (fixed != null) return fixed;
            for (String field : FIELDS) {
                if ((field + " is required").equals(message)) return hint("QA_FIELD_REQUIRED", field);
                if (message != null && message.matches(field + " exceeds [0-9]+ characters"))
                    return hint("QA_FIELD_TOO_LONG", field);
            }
            if (Set.of("Archived project is read-only", "Archived test case is read-only", "Archived test plan is read-only",
                    "Archived assets cannot change traceability", "Archived test case cannot be added to a test plan")
                    .contains(message == null ? "" : message)) return hint("QA_ARCHIVED_READ_ONLY", null);
            if (Set.of("Requirement was changed or removed", "Test case was changed or removed", "Test plan was changed or removed",
                    "Test run was changed or removed", "Defect was changed or removed").contains(message == null ? "" : message))
                return hint("QA_STALE_VERSION", "expectedVersion");
        }
        return hint(status == 400 ? "QA_INVALID_INPUT" : "QA_STATE_CONFLICT", null);
    }
    static Hint forJsonFailure(com.fasterxml.jackson.core.JsonProcessingException failure) {
        // DTO constructors use fixed field labels in requireNonNull; never emit the cause message itself.
        Throwable cause = failure.getCause();
        if (cause instanceof NullPointerException && FIELDS.contains(cause.getMessage() == null ? "" : cause.getMessage()))
            return hint("QA_FIELD_REQUIRED", cause.getMessage());
        if (failure instanceof com.fasterxml.jackson.databind.JsonMappingException mapping) {
            for (var reference : mapping.getPath()) {
                String field = reference.getFieldName();
                if (field != null && FIELDS.contains(field)) return hint("QA_INVALID_INPUT", field);
            }
        }
        return hint("QA_INVALID_INPUT", null);
    }
    private static Hint hint(String reasonCode, String field) { return new Hint(reasonCode, field); }
}
