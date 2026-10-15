package io.github.lz007001cn.veriqra.integration;

import io.github.lz007001cn.veriqra.dao.*;
import io.github.lz007001cn.veriqra.dao.jdbc.*;
import io.github.lz007001cn.veriqra.exception.DataAccessException;
import io.github.lz007001cn.veriqra.model.*;
import org.junit.jupiter.api.*;
import java.nio.file.*;
import java.sql.*;
import java.time.LocalDateTime;
import java.util.*;
import static org.junit.jupiter.api.Assertions.*;

/** DAO-only facts on a new owned schema. Does not assert Defect close eligibility. */
@Tag("mysql") @TestInstance(TestInstance.Lifecycle.PER_CLASS)
class R1DefectEvidenceDaoIntegrationTest {
    private Connection c;
    private JdbcDefectRetestLinkDao links;
    private JdbcDefectClosureReceiptDao receipts;
    private JdbcDefectClosureItemDao items;
    @BeforeAll void installOwnedFixture() throws Exception {
        c=R1MysqlTarget.open();MysqlFixture.requireEmptySchema(c,c.getCatalog());
        MysqlFixture.installSchema(c,Files.readString(Path.of("database/schema.sql")),new ArrayList<>());
        R1FoundationIntegrationTest.seed(c);
        R1FoundationIntegrationTest.execute(c,"INSERT INTO test_attempts(id,test_run_case_id,attempt_no,status,executed_by,submission_key) VALUES(5,1,3,'PASS',1,UNHEX(LPAD('5',32,'0')))");
        MysqlFixture.installSchema(c,Files.readString(Path.of("database/migrations/20261014-r1-defect-retest.sql")),new ArrayList<>());
        links=new JdbcDefectRetestLinkDao(c);receipts=new JdbcDefectClosureReceiptDao(c);items=new JdbcDefectClosureItemDao(c);
    }
    @BeforeEach void begin() throws SQLException {c.setAutoCommit(false);}
    @AfterEach void rollback() throws SQLException {if(c!=null){if(!c.getAutoCommit())c.rollback();c.setAutoCommit(true);}}
    @AfterAll void retainFixture() throws SQLException {if(c!=null)c.close();}
    @Test void roundTripUsesGeneratedTimesUuidAndExactText() {
        var input=link(1L,1L,2L,UUID.randomUUID());
        var stored=links.insert(input);
        assertNotNull(stored.id());assertNotEquals(input.id(),stored.id());
        assertNotNull(stored.linkedAt());assertNotEquals(input.linkedAt(),stored.linkedAt());
        assertEquals(input.requestKey(),stored.requestKey());assertEquals(input.requestHash(),stored.requestHash());
        assertEquals(input.reviewNote(),stored.reviewNote());assertEquals(stored,links.findById(stored.id()).orElseThrow());
        assertEquals(stored,links.findByLinkRequestKey(input.requestKey()).orElseThrow());
        assertEquals(stored,links.findActive(1L,1L).orElseThrow());
        assertTrue(links.findById(-1L).isEmpty());assertFalse(cIsClosed());
    }
    @Test void duplicateRequestsAndActiveSelectionsFailWithoutImplicitReplay() {
        var stored=links.insert(link(1L,1L,2L,UUID.randomUUID()));
        assertEquals(1062,assertThrows(DataAccessException.class,()->links.insert(link(1L,4L,3L,stored.requestKey()))).getVendorCode());
        assertEquals(1062,assertThrows(DataAccessException.class,()->links.insert(link(1L,1L,3L,UUID.randomUUID()))).getVendorCode());
    }
    @Test void revocationIsOneWayAndPreservesInitialEndpoints() {
        var stored=links.insert(link(1L,1L,2L,UUID.randomUUID()));
        var revocation=revoke(DefectRetestRevocationOperation.REVOKE,UUID.randomUUID());
        assertFalse(links.revoke(stored.id(),2L,revocation));
        assertTrue(links.revoke(stored.id(),1L,revocation));
        assertFalse(links.revoke(stored.id(),1L,revoke(DefectRetestRevocationOperation.REVOKE,UUID.randomUUID())));
        var changed=links.findById(stored.id()).orElseThrow();
        assertEquals(stored.failureAttemptId(),changed.failureAttemptId());assertEquals(stored.passAttemptId(),changed.passAttemptId());
        assertEquals(stored.linkedAt(),changed.linkedAt());assertEquals(stored.requestHash(),changed.requestHash());
        assertEquals(revocation.requestHash(),changed.revocation().requestHash());assertNotNull(changed.revocation().revokedAt());
        assertTrue(links.findActive(1L,1L).isEmpty());
        assertEquals(changed,links.findByRevokeRequestKey(revocation.requestKey()).orElseThrow());
        assertTrue(links.findReplacedByLinkRequestKey(revocation.requestKey()).isEmpty());
    }
    @Test void replacementLookupsCannotMasqueradeAsAnIndependentRevoke() {
        var first=links.insert(link(1L,1L,2L,UUID.randomUUID()));UUID key=UUID.randomUUID();
        assertTrue(links.revoke(first.id(),1L,revoke(DefectRetestRevocationOperation.REPLACE,key)));
        var next=links.insert(link(1L,1L,3L,key));
        assertEquals(next,links.findByLinkRequestKey(key).orElseThrow());
        assertEquals(first.id(),links.findReplacedByLinkRequestKey(key).orElseThrow().id());
        assertTrue(links.findByRevokeRequestKey(key).isEmpty());
        assertEquals(2,links.listByDefect(1L).size());
    }
    @Test void receiptsAndItemsRoundTripBothEvidencePoliciesInSourceOrder() {
        var selected=links.insert(link(1L,4L,3L,UUID.randomUUID()));
        var receipt=receipts.insert(receipt(1L,4,2));
        assertNotNull(receipt.closedAt());assertEquals("Close note ' ? 中文",receipt.resolutionNote());
        items.insert(new DefectClosureItem(receipt.id(),4L,1L,3L,selected.id(),DefectClosureEvidencePolicy.EXACT_SEMANTIC_V1));
        items.insert(new DefectClosureItem(receipt.id(),1L,1L,5L,null,DefectClosureEvidencePolicy.SAME_RUN_CASE_V1));
        assertEquals(List.of(1L,4L),items.listByReceipt(receipt.id()).stream().map(DefectClosureItem::failureAttemptId).toList());
        assertNull(items.listByReceipt(receipt.id()).getFirst().retestLinkId());
        assertEquals(receipt,receipts.findById(receipt.id()).orElseThrow());
        assertEquals(List.of(receipt),receipts.listByDefect(1L));
        assertTrue(receipts.findById(-1L).isEmpty());assertTrue(items.listByReceipt(-1L).isEmpty());
    }
    @Test void foreignKeyFailuresPreserveSqlStateAndVendorCode() {
        var receipt=receipts.insert(receipt(1L,4,1));
        var bad=new DefectClosureItem(receipt.id(),1L,2L,2L,null,DefectClosureEvidencePolicy.SAME_RUN_CASE_V1);
        var error=assertThrows(DataAccessException.class,()->items.insert(bad));
        assertEquals(1452,error.getVendorCode());assertEquals("23000",error.getSqlState());
    }
    @Test void callerRollbackAfterLateFailureRemovesAllPartialNewFacts() throws Exception {
        int l=count("defect_retest_links"),r=count("defect_closure_receipts"),i=count("defect_closure_items");
        var selected=links.insert(link(1L,1L,2L,UUID.randomUUID()));
        var receipt=receipts.insert(receipt(1L,4,1));
        assertThrows(DataAccessException.class,()->items.insert(new DefectClosureItem(receipt.id(),4L,1L,2L,selected.id(),DefectClosureEvidencePolicy.EXACT_SEMANTIC_V1)));
        c.rollback();
        assertEquals(l,count("defect_retest_links"));assertEquals(r,count("defect_closure_receipts"));assertEquals(i,count("defect_closure_items"));
        assertFalse(c.getAutoCommit());assertFalse(c.isClosed());
    }
    @Test void allWritesAndLockingRejectAutocommitBeforeAnyStatement() throws Exception {
        c.setAutoCommit(true);
        assertEquals("25000",assertThrows(DataAccessException.class,()->links.insert(link(1L,1L,2L,UUID.randomUUID()))).getSqlState());
        assertThrows(DataAccessException.class,()->links.revoke(1L,1L,revoke(DefectRetestRevocationOperation.REVOKE,UUID.randomUUID())));
        assertThrows(DataAccessException.class,()->receipts.insert(receipt(1L,4,1)));
        assertThrows(DataAccessException.class,()->items.insert(new DefectClosureItem(1L,1L,1L,2L,null,DefectClosureEvidencePolicy.SAME_RUN_CASE_V1)));
        assertThrows(DataAccessException.class,()->links.findByIdForUpdate(1L));
        assertThrows(DataAccessException.class,()->links.listByDefectForUpdate(1L));
        assertFalse(c.isClosed());
    }
    @Test void malformedFoundationInputsCannotInventPoliciesRevocationsOrTimes() {
        var value=link(1L,1L,2L,UUID.randomUUID());
        assertThrows(IllegalArgumentException.class,()->links.insert(new DefectRetestLink(null,1L,1L,2L,"unknown",1L,null,"note",value.timingBasis(),value.requestKey(),value.requestHash(),3,null)));
        assertThrows(IllegalArgumentException.class,()->links.insert(new DefectRetestLink(null,1L,1L,2L,DefectRetestLink.POLICY,1L,null,"note",value.timingBasis(),value.requestKey(),value.requestHash(),3,revoke(DefectRetestRevocationOperation.REVOKE,UUID.randomUUID()))));
        assertThrows(IllegalArgumentException.class,()->links.revoke(1L,1L,new DefectRetestRevocation(1L,LocalDateTime.of(2000,1,1,0,0),"note",DefectRetestRevocationOperation.REVOKE,UUID.randomUUID(),digest(),4)));
        assertThrows(IllegalArgumentException.class,()->receipts.insert(receipt(1L,-1,1)));
    }
    @Test void lockingReadsUseOuterTransactionAndReturnedCollectionsAreImmutable() {
        var stored=links.insert(link(1L,1L,2L,UUID.randomUUID()));
        assertEquals(stored,links.findByIdForUpdate(stored.id()).orElseThrow());
        assertEquals(List.of(stored),links.listByDefectForUpdate(1L));
        assertThrows(UnsupportedOperationException.class,()->links.listByDefect(1L).clear());
        assertThrows(UnsupportedOperationException.class,()->receipts.listByDefect(1L).clear());
        assertThrows(UnsupportedOperationException.class,()->items.listByReceipt(-1L).clear());
        // Actual competing writer/current-read behavior belongs to the later service milestone.
    }
    @Test void callerCommitControlsVisibilityAndReceiptEvidenceStaysRetained() throws Exception {
        try(Connection observer=R1MysqlTarget.observer()) {
            var selected=links.insert(link(2L,1L,2L,UUID.randomUUID()));
            var receipt=receipts.insert(receipt(2L,55,1));
            items.insert(new DefectClosureItem(receipt.id(),1L,2L,2L,selected.id(),DefectClosureEvidencePolicy.EXACT_SEMANTIC_V1));
            var read=new JdbcDefectRetestLinkDao(observer);
            assertTrue(read.findById(selected.id()).isEmpty());
            c.commit();
            assertEquals(selected,read.findById(selected.id()).orElseThrow());
            assertEquals(receipt,new JdbcDefectClosureReceiptDao(observer).findById(receipt.id()).orElseThrow());
            assertEquals(1,new JdbcDefectClosureItemDao(observer).listByReceipt(receipt.id()).size());
            assertFalse(c.isClosed());assertFalse(c.getAutoCommit());
        }
    }
    @Test void appendOnlyInterfacesExposeNoUpdateOrDeleteOperations() {
        for(Class<?> type:List.of(DefectClosureReceiptDao.class,DefectClosureItemDao.class))
            for(var method:type.getMethods())assertFalse(Set.of("update","delete","remove").contains(method.getName()));
    }
    private DefectRetestLink link(Long defect,Long failure,Long pass,UUID key) {
        return new DefectRetestLink(999L,defect,failure,pass,DefectRetestLink.POLICY,1L,LocalDateTime.of(2000,1,1,0,0),"Review ' ? 中文",DefectRetestTimingBasis.MANUAL_SERVER_RECORD,key,digest(),3,null);
    }
    private DefectClosureReceipt receipt(Long defect,int version,int count) {
        return new DefectClosureReceipt(999L,defect,version,1L,LocalDateTime.of(2000,1,1,0,0),DefectClosureReceipt.POLICY,"Close note ' ? 中文",count);
    }
    private DefectRetestRevocation revoke(DefectRetestRevocationOperation operation,UUID key) {
        return new DefectRetestRevocation(1L,null,"Reason ' ? 中文",operation,key,digest(),4);
    }
    private Sha256Digest digest(){byte[] bytes=new byte[32];bytes[0]=12;bytes[31]=42;return new Sha256Digest(bytes);}
    private boolean cIsClosed(){try{return c.isClosed();}catch(SQLException e){throw new AssertionError(e);}}
    private int count(String table)throws SQLException {
        if(!Set.of("defect_retest_links","defect_closure_receipts","defect_closure_items").contains(table))throw new IllegalArgumentException();
        return R1FoundationIntegrationTest.scalar(c,"SELECT COUNT(*) FROM "+table);
    }
}
