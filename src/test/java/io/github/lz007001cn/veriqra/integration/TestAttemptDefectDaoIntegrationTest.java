package io.github.lz007001cn.veriqra.integration;

import io.github.lz007001cn.veriqra.dao.jdbc.*;
import io.github.lz007001cn.veriqra.exception.DataAccessException;
import io.github.lz007001cn.veriqra.model.*;
import org.junit.jupiter.api.Test;
import java.util.List;
import static org.junit.jupiter.api.Assertions.*;

class TestAttemptDefectDaoIntegrationTest extends ExecutionFixture {
    @Test void summaryQueryDeduplicatesHistoricalFailuresAndExcludesOtherRunsPassAndOtherProjects() {
        tx.inTransaction(c -> {
            var e = execution(c); var attempts = new JdbcTestAttemptDao(c); var defects = new JdbcDefectDao(c);
            var dao = new JdbcTestAttemptDefectDao(c);
            var fail1 = attempts.insert(attempt(e,1,TestAttemptStatus.FAIL));
            var fail2 = attempts.insert(attempt(e,2,TestAttemptStatus.FAIL));
            var pass = attempts.insert(attempt(e,3,TestAttemptStatus.PASS));
            var bug = defects.insert(defect(e.parents(),1)); var notFail = defects.insert(defect(e.parents(),2));
            dao.add(new TestAttemptDefect(fail1.id(),bug.id(),e.parents().userId(),null));
            dao.add(new TestAttemptDefect(fail2.id(),bug.id(),e.parents().userId(),null));
            dao.add(new TestAttemptDefect(pass.id(),notFail.id(),e.parents().userId(),null));
            var other = new JdbcProjectDao(c).insert(project("OTHERSUM",e.parents().userId()));
            var crossProject = defects.insert(defect(new Parents(e.parents().userId(),other.id()),1));
            dao.add(new TestAttemptDefect(fail1.id(),crossProject.id(),e.parents().userId(),null));
            var anotherRun = new JdbcTestRunDao(c).insert(run(e.parents(),null));
            assertEquals(List.of(bug.id()),dao.listDefectIdsByRun(e.run().id()));
            assertTrue(dao.listDefectIdsByRun(anotherRun.id()).isEmpty());
            assertTrue(dao.listDefectIdsByRun(-1L).isEmpty());
            return null;
        });
    }
    @Test void manyToManyQueriesAndRemovingOnlyErroneousEvidenceLink() {
        tx.inTransaction(c -> {
            var e = execution(c); var attempts = new JdbcTestAttemptDao(c); var defects = new JdbcDefectDao(c);
            var fail1 = attempts.insert(attempt(e, 1, TestAttemptStatus.FAIL)); var fail2 = attempts.insert(attempt(e, 2, TestAttemptStatus.FAIL));
            var bug1 = defects.insert(defect(e.parents(), 1)); var bug2 = defects.insert(defect(e.parents(), 2));
            var dao = new JdbcTestAttemptDefectDao(c);
            assertFalse(dao.existsRecord(fail1.id(), bug1.id()));
            var link12 = dao.add(new TestAttemptDefect(fail1.id(), bug2.id(), e.parents().userId(), null));
            var link11 = dao.add(new TestAttemptDefect(fail1.id(), bug1.id(), e.parents().userId(), null));
            var link21 = dao.add(new TestAttemptDefect(fail2.id(), bug1.id(), e.parents().userId(), null));
            assertNotNull(link11.linkedAt()); assertEquals(link11, dao.find(fail1.id(), bug1.id()).orElseThrow());
            assertEquals(List.of(link11, link12), dao.listDefectsByAttempt(fail1.id()));
            assertEquals(List.of(link11, link21), dao.listAttemptsByDefect(bug1.id()));
            assertEquals(List.of(link11, link21), dao.listAttemptsByDefectForUpdate(bug1.id()));
            attempts.insert(attempt(e, 3, TestAttemptStatus.PASS));
            assertTrue(dao.existsRecord(fail1.id(), bug1.id())); assertEquals(DefectStatus.OPEN, defects.findById(bug1.id()).orElseThrow().status());
            assertTrue(dao.remove(fail1.id(), bug1.id())); assertFalse(dao.remove(fail1.id(), bug1.id()));
            assertFalse(dao.existsRecord(fail1.id(), bug1.id()));
            assertEquals(fail1, attempts.findById(fail1.id()).orElseThrow()); assertEquals(bug1, defects.findById(bug1.id()).orElseThrow());
            assertTrue(dao.listDefectsByAttempt(-1L).isEmpty()); assertTrue(dao.listAttemptsByDefect(-1L).isEmpty()); return null;
        });
    }

    @Test void primaryKeyForeignKeysAndDeleteRestrictPreserveEndpoints() {
        tx.inTransaction(c -> {
            var e = execution(c); var fail = new JdbcTestAttemptDao(c).insert(attempt(e, 1, TestAttemptStatus.FAIL));
            var bug = new JdbcDefectDao(c).insert(defect(e.parents(), 1)); var dao = new JdbcTestAttemptDefectDao(c);
            var link = dao.add(new TestAttemptDefect(fail.id(), bug.id(), e.parents().userId(), null));
            assertEquals(1062, assertThrows(DataAccessException.class, () -> dao.add(link)).getVendorCode());
            assertEquals(1452, assertThrows(DataAccessException.class, () -> dao.add(new TestAttemptDefect(-1L, bug.id(), e.parents().userId(), null))).getVendorCode());
            assertEquals(1452, assertThrows(DataAccessException.class, () -> dao.add(new TestAttemptDefect(fail.id(), -1L, e.parents().userId(), null))).getVendorCode());
            var other = new JdbcDefectDao(c).insert(defect(e.parents(), 2));
            assertEquals(1452, assertThrows(DataAccessException.class, () -> dao.add(new TestAttemptDefect(fail.id(), other.id(), -1L, null))).getVendorCode());
            try (var s = c.prepareStatement("DELETE FROM defects WHERE id=?")) {
                s.setLong(1, bug.id()); assertEquals(1451, assertThrows(java.sql.SQLException.class, s::executeUpdate).getErrorCode());
            }
            try (var s = c.prepareStatement("DELETE FROM test_attempts WHERE id=?")) {
                s.setLong(1, fail.id()); assertEquals(1451, assertThrows(java.sql.SQLException.class, s::executeUpdate).getErrorCode());
            }
            return null;
        });
    }

    @Test void crossProjectAndNonFailEvidenceAreServiceInvariantsAndProbeRollsBack() throws Exception {
        var e = tx.inTransaction(this::execution);
        assertThrows(IllegalStateException.class, () -> tx.inTransaction(c -> {
            var other = new JdbcProjectDao(c).insert(project("OTHER", e.parents().userId()));
            var bug = new JdbcDefectDao(c).insert(defect(new Parents(e.parents().userId(), other.id()), 1));
            var pass = new JdbcTestAttemptDao(c).insert(attempt(e, 1, TestAttemptStatus.PASS));
            var link = new JdbcTestAttemptDefectDao(c).add(new TestAttemptDefect(pass.id(), bug.id(), e.parents().userId(), null));
            assertNotNull(link.linkedAt()); // Database accepts both; Service must reject them.
            throw new IllegalStateException("rollback invariant probe");
        }));
        try (var c = pool.borrow()) {
            assertTrue(new JdbcTestAttemptDao(c).listByRunCase(e.runCase().id()).isEmpty());
            assertTrue(new JdbcProjectDao(c).findByKey("OTHER").isEmpty());
        }
    }
}
