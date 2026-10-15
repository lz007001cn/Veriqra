package io.github.lz007001cn.veriqra.web;

import io.github.lz007001cn.veriqra.service.exception.*;
import org.junit.jupiter.api.Test;
import static org.junit.jupiter.api.Assertions.*;

class QaErrorDetailsTest {
    @Test void manualQaPathsAreBoundedToProjectModulesAndRespectContextPath() {
        assertTrue(QaErrorDetails.isManualQaPath("/veriqra/api/projects/7/runs/40/cases/50/attempts","/veriqra"));
        assertFalse(QaErrorDetails.isManualQaPath("/api/admin/users",""));
        assertFalse(QaErrorDetails.isManualQaPath("/api/projects/7/tasks",""));
        assertFalse(QaErrorDetails.isManualQaPath("/other/api/projects/7/runs","/veriqra"));
    }
    @Test void knownFieldAndStateErrorsExposeOnlyStableCodesAndWhitelistedField() {
        assertEquals(new QaErrorDetails.Hint("QA_FIELD_REQUIRED","title"),
                QaErrorDetails.forFailure(new ValidationException("title is required"),400));
        assertEquals(new QaErrorDetails.Hint("QA_FIELD_TOO_LONG","name"),
                QaErrorDetails.forFailure(new ValidationException("name exceeds 160 characters"),400));
        assertEquals(new QaErrorDetails.Hint("QA_CASE_NOT_READY","testCaseIds"),
                QaErrorDetails.forFailure(new ConflictException("Only READY test cases can be included in a test run"),409));
        assertEquals(new QaErrorDetails.Hint("QA_STALE_VERSION","expectedVersion"),
                QaErrorDetails.forFailure(new ConflictException("Test case was changed or removed"),409));
        assertEquals(new QaErrorDetails.Hint("QA_FORBIDDEN",null),
                QaErrorDetails.forFailure(new ForbiddenException("private internal permission detail"),403));
    }
    @Test void untrustedMessagesSqlStackAndUnapprovedFieldsNeverBecomeResponseParameters() {
        for (String unsafe : new String[]{"password is required", "SQL SELECT secret FROM private", "title exceeds 10 characters; password=secret", "<script> is required"}) {
            var hint = QaErrorDetails.forFailure(new ValidationException(unsafe),400);
            assertEquals(new QaErrorDetails.Hint("QA_INVALID_INPUT",null),hint);
            assertFalse(hint.toString().contains(unsafe));
        }
        assertNull(QaErrorDetails.forFailure(new IllegalStateException("secret"),500));
        assertNull(QaErrorDetails.forFailure(new NotFoundException("secret"),404));
    }
}
