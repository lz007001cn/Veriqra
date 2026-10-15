package io.github.lz007001cn.veriqra.integration;

import io.github.lz007001cn.veriqra.bootstrap.R1SchemaGuard;
import org.junit.jupiter.api.*;
import java.nio.file.*;
import java.util.*;
import static org.junit.jupiter.api.Assertions.*;

/** Fresh owned synthetic schema only. No drift repair, DROP, or disabling a real constraint. */
@Tag("mysql")
class R1SchemaGuardIntegrationTest {
    @Test void baselineAndEachPartialMigrationRejectButExactThreeTablesPassWithoutWrites() throws Exception {
        try(var c=R1MysqlTarget.open()) {
            MysqlFixture.requireEmptySchema(c,c.getCatalog());
            var installed=new ArrayList<String>();
            MysqlFixture.installSchema(c,Files.readString(Path.of("database/schema.sql")),installed);
            assertEquals(32,installed.size());
            assertThrows(R1SchemaGuard.IncompatibleSchema.class,()->R1SchemaGuard.verify(c));
            String migration=Files.readString(Path.of("database/migrations/20261014-r1-defect-retest.sql"));
            String[] statements=migration.replaceAll("(?m)^--.*$","").split(";");
            for(String statement:statements)if(!statement.isBlank()) {
                MysqlFixture.installSchema(c,statement,installed);
                if(installed.size()<35)assertThrows(R1SchemaGuard.IncompatibleSchema.class,()->R1SchemaGuard.verify(c));
            }
            assertEquals(35,installed.size());
            assertDoesNotThrow(()->R1SchemaGuard.verify(c));
            c.setReadOnly(true);
            assertDoesNotThrow(()->R1SchemaGuard.verify(c));
            try(var s=c.createStatement();var r=s.executeQuery("SELECT SUM(TABLE_ROWS) FROM information_schema.tables WHERE table_schema=DATABASE() AND table_name IN ('defect_retest_links','defect_closure_receipts','defect_closure_items')")) {
                assertTrue(r.next());assertEquals(0,r.getLong(1));
            }
        }
    }
}
