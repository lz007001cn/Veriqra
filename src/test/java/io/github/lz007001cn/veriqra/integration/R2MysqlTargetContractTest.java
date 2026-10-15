package io.github.lz007001cn.veriqra.integration;

import org.junit.jupiter.api.Test;
import java.nio.file.Path;
import java.util.Properties;
import static org.junit.jupiter.api.Assertions.*;

/** Pure pre-connection guard checks. No JDBC connection, credential or fixture data is used. */
class R2MysqlTargetContractTest {
    Properties valid() {
        Properties properties = new Properties();
        properties.setProperty("jdbcUrl","jdbc:mysql://127.0.0.1:17307/veriqra_test_r2_contract_20261015");
        properties.setProperty("username","r2_contract");
        properties.setProperty("r2.expectedPort","17307");
        properties.setProperty("r2.expectedDataDir",Path.of("target/r2-fixture-guard-only").toAbsolutePath().toString());
        properties.setProperty("r2.expectedServerUuid","12345678-1234-1234-1234-123456789abc");
        return properties;
    }
    @Test void explicitR2ContractSchemaAndLoopbackIdentityAreAccepted() {
        assertEquals("veriqra_test_r2_contract_20261015",R2MysqlTarget.validate(valid()));
    }
    @Test void rejectsDailyR1RootRemoteAndMissingIdentityBeforeOpeningAnyConnection() {
        for (String[] change : new String[][]{
                {"jdbcUrl","jdbc:mysql://127.0.0.1:17307/veriqra"},
                {"jdbcUrl","jdbc:mysql://127.0.0.1:17307/veriqra_test_r1_foundation"},
                {"jdbcUrl","jdbc:mysql://192.0.2.1:17307/veriqra_test_r2_contract_20261015"},
                {"jdbcUrl","jdbc:mysql://127.0.0.1:17307/veriqra_test_r2_contract_20261015?allowMultiQueries=true"},
                {"username","root"},{"username","r1_foundation"},
                {"r2.expectedPort","13307"},{"r2.expectedDataDir","relative/path"},
                {"r2.expectedServerUuid",""}}) {
            Properties properties=valid(); properties.setProperty(change[0],change[1]);
            assertThrows(RuntimeException.class,() -> R2MysqlTarget.validate(properties),change[0]);
        }
    }
}
