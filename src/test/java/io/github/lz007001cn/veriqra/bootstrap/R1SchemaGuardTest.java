package io.github.lz007001cn.veriqra.bootstrap;

import org.junit.jupiter.api.Test;
import static org.junit.jupiter.api.Assertions.*;

class R1SchemaGuardTest {
    @Test void mysqlFormattingAndCharsetIntroducersPreserveTheApprovedExpression() {
        assertEquals(R1SchemaGuard.expression("policy_version = 'EXACT_SEMANTIC_V1'"),
                R1SchemaGuard.expression("((`policy_version` = _ascii'EXACT_SEMANTIC_V1'))"));
        assertEquals(R1SchemaGuard.expression("policy_version = 'EXACT_SEMANTIC_V1'"),
                R1SchemaGuard.expression("((`policy_version` = _utf8mb4\\'EXACT_SEMANTIC_V1\\'))"));
        assertEquals(R1SchemaGuard.expression("CASE WHEN revoked_at IS NULL THEN failure_attempt_id ELSE NULL END"),
                R1SchemaGuard.expression("(case when (`revoked_at` is null) then `failure_attempt_id` else NULL end)"));
    }
    @Test void changedLiteralOrBooleanGroupingCannotMasqueradeAsApproved() {
        assertNotEquals(R1SchemaGuard.expression("policy_version='EXACT_SEMANTIC_V1'"),R1SchemaGuard.expression("policy_version='exact_semantic_v1'"));
        assertNotEquals(R1SchemaGuard.expression("a IS NULL AND b IS NULL OR c > 0"),R1SchemaGuard.expression("a IS NULL AND (b IS NULL OR c > 0)"));
    }
    @Test void unsupportedExpressionFailsClosedWithSafeMessage() {
        var error=assertThrows(R1SchemaGuard.IncompatibleSchema.class,()->R1SchemaGuard.expression("a + 1 > 0"));
        assertEquals(R1SchemaGuard.SAFE_MESSAGE,error.getMessage());
    }
}
