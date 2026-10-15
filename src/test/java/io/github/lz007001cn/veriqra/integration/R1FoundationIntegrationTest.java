package io.github.lz007001cn.veriqra.integration;

import com.fasterxml.jackson.databind.ObjectMapper;
import org.junit.jupiter.api.*;
import java.nio.file.*;
import java.security.MessageDigest;
import java.sql.*;
import java.util.*;
import static org.junit.jupiter.api.Assertions.*;

/** One-shot migration on an empty owned schema. No DROP/reset or automatic retry. */
@Tag("mysql") @TestInstance(TestInstance.Lifecycle.PER_CLASS)
class R1FoundationIntegrationTest {
    private Connection c;
    private List<String> baseline;
    private Map<String,String> before;
    @BeforeAll void installFreshFixture() throws Exception {
        c=R1MysqlTarget.open(); MysqlFixture.requireEmptySchema(c,c.getCatalog());
        baseline=new ArrayList<>();
        MysqlFixture.installSchema(c,Files.readString(Path.of("database/schema.sql")),baseline);
        assertEquals(32,baseline.size()); seed(c); before=fingerprint(c,baseline);
        List<String> added=new ArrayList<>();
        MysqlFixture.installSchema(c,Files.readString(Path.of("database/migrations/20261014-r1-defect-retest.sql")),added);
        assertEquals(List.of("defect_retest_links","defect_closure_receipts","defect_closure_items"),added);
        Map<String,String> after=fingerprint(c,baseline);
        assertEquals(before,after,"All old structures and rows must be unchanged");
        String evidence=System.getProperty("r1.migration.evidence");
        if(evidence!=null)new ObjectMapper().writerWithDefaultPrettyPrinter().writeValue(Path.of(evidence).toFile(),
            Map.of("schema",c.getCatalog(),"tablesBefore",32,"tablesAfter",35,"before",before,"after",after,"oldTablesUnchanged",true));
    }
    @BeforeEach void begin() throws SQLException {c.setAutoCommit(false);}
    @AfterEach void rollback() throws SQLException {if(c!=null){c.rollback();c.setAutoCommit(true);}}
    @AfterAll void retainFixture() throws SQLException {if(c!=null)c.close();}
    @Test void migrationPreservesAll32OriginalTablesAndFrozenFacts() throws Exception {
        assertEquals(35,scalar(c,"SELECT COUNT(*) FROM information_schema.tables WHERE table_schema=DATABASE()"));
        assertEquals(before,fingerprint(c,baseline));
        for(String t:List.of("defect_retest_links","defect_closure_receipts","defect_closure_items"))assertEquals(0,scalar(c,"SELECT COUNT(*) FROM "+t));
    }
    @Test void primaryKeysAreVerifiedWithoutAnotherConstraintCollision() {
        executeUnchecked(linkSql(1,1,1,2));
        rejected(linkSql(1,1,4,3).replace("LPAD('1',32,'0')","LPAD('77',32,'0')"),1062,"PRIMARY");
        executeUnchecked(receiptSql(1,1,4));
        rejected(receiptSql(1,2,5),1062,"PRIMARY");
        executeUnchecked(itemSql(1,1,1,2,1L,"EXACT_SEMANTIC_V1"));
        rejected(itemSql(1,1,1,2,1L,"EXACT_SEMANTIC_V1"),1062,"PRIMARY");
    }
    @Test void eachCompositeForeignKeyRejectsUnmatchedEndpoints() {
        rejected(linkSql(1,2,4,2),1452,"fk_retests_source");
        rejected(linkSql(2,1,1,999),1452,"fk_retests_pass");
        executeUnchecked(linkSql(3,1,1,2)); executeUnchecked(receiptSql(1,1,4));
        // (FAIL1,Defect2) exists: only receipt owner is wrong; no PK collision.
        rejected(itemSql(1,1,2,2,null,"SAME_RUN_CASE_V1"),1452,"fk_closure_items_owner");
        // (FAIL4,Defect1) exists: link source is wrong.
        rejected(itemSql(1,4,1,2,3L,"EXACT_SEMANTIC_V1"),1452,"fk_closure_items_link");
        rejected(itemSql(1,4,1,999,null,"SAME_RUN_CASE_V1"),1452,"fk_closure_items_pass");
        rejected(itemSql(1,999,1,2,null,"SAME_RUN_CASE_V1"),1452,"fk_closure_items_source");
    }
    @Test void sourceAndReceiptDeletionIsRestricted() {
        executeUnchecked(linkSql(1,1,1,2)); executeUnchecked(receiptSql(1,1,4));
        executeUnchecked(itemSql(1,1,1,2,1L,"EXACT_SEMANTIC_V1"));
        rejected("DELETE FROM test_attempt_defects WHERE attempt_id=1 AND defect_id=1",1451,"fk_");
        rejected("DELETE FROM defect_retest_links WHERE id=1",1451,"fk_closure_items_link");
        rejected("DELETE FROM defect_closure_receipts WHERE id=1",1451,"fk_closure_items_owner");
    }
    @Test void uniqueIndexesAreVerifiedWithDistinctPrimaryKeys() {
        executeUnchecked(linkSql(1,1,1,2));
        rejected(linkSql(2,1,1,3),1062,"uq_retests_active_source");
        rejected(linkSql(3,1,4,3).replace("LPAD('3',32,'0')","LPAD('1',32,'0')"),1062,"uq_retests_request");
        executeUnchecked(receiptSql(1,1,4));
        rejected(receiptSql(2,1,4),1062,"uq_closures_defect_version");
    }
    @Test void revocationAllowsHistoryAndExactlyOneActiveSelection() {
        executeUnchecked(linkSql(1,1,1,2)); executeUnchecked(revokeSql(1,90,"REPLACE"));
        executeUnchecked(linkSql(2,1,1,3));
        assertEquals(1,scalarUnchecked("SELECT COUNT(*) FROM defect_retest_links WHERE active_failure_id=1"));
        executeUnchecked(revokeSql(2,91,"REVOKE"));
        assertEquals(2,scalarUnchecked("SELECT COUNT(*) FROM defect_retest_links WHERE active_failure_id IS NULL"));
        executeUnchecked(linkSql(3,1,4,3));
        rejected(revokeSql(3,91,"REVOKE"),1062,"uq_retests_revoke_request");
    }
    @Test void checkPoliciesRejectUnknownOrIncompatibleShapes() {
        rejected(linkSql(1,1,1,1),3819,"ck_retests_different_attempts");
        rejected(linkSql(2,1,1,2).replace("EXACT_SEMANTIC_V1","unknown"),3819,"ck_retests_policy");
        rejected(linkSql(3,1,1,2).replace("Synthetic reviewed retest"," "),3819,"ck_retests_note");
        rejected(linkSql(4,1,1,2).replace("MANUAL_SERVER_RECORD","unknown"),3819,"ck_retests_timing");
        executeUnchecked(linkSql(5,1,1,2));
        rejected("UPDATE defect_retest_links SET revoked_at=NOW(6) WHERE id=5",3819,"ck_retests_revocation");
        rejected(revokeSql(5,92,"unknown"),3819,"ck_retests_revocation");
        rejected(revokeSql(5,93,"REVOKE").replace("revoked_at=NOW(6)","revoked_at=DATE_SUB(linked_at,INTERVAL 1 SECOND)"),3819,"ck_retests_revocation");
    }
    @Test void checkReceiptsAndItemsDoNotPassThroughNullPolicyBranches() {
        rejected(receiptSql(1,1,4).replace("R1_CLOSURE_V1","unknown"),3819,"ck_closures_policy");
        rejected(receiptSql(2,1,5).replace("Synthetic closure evidence"," "),3819,"ck_closures_note");
        rejected(receiptSql(3,1,6).replace("evidence',1)","evidence',0)"),3819,"ck_closures_count");
        executeUnchecked(receiptSql(4,1,7));
        executeUnchecked(linkSql(1,1,1,2));
        rejected(itemSql(4,1,1,2,null,"EXACT_SEMANTIC_V1"),3819,"ck_closure_items_policy");
        rejected(itemSql(4,1,1,2,1L,"SAME_RUN_CASE_V1"),3819,"ck_closure_items_policy");
        rejected(itemSql(4,1,1,2,null,"unknown"),3819,"ck_closure_items_policy");
        rejected(itemSql(4,1,1,1,null,"SAME_RUN_CASE_V1"),3819,"ck_closure_items_different");
        executeUnchecked(itemSql(4,1,1,2,null,"SAME_RUN_CASE_V1"));
    }
    @Test void actorForeignKeysRejectUnknownUsersWithOtherwiseValidRows() {
        rejected(linkSql(1,1,1,2).replace("V1',1,'Synthetic","V1',999,'Synthetic"),1452,"fk_retests_linked_by");
        executeUnchecked(linkSql(2,1,1,2));
        rejected(revokeSql(2,94,"REVOKE").replace("revoked_by=1","revoked_by=999"),1452,"fk_retests_revoked_by");
        rejected(receiptSql(1,1,4).replace(",4,1,'R1_CLOSURE",",4,999,'R1_CLOSURE"),1452,"fk_closures_actor");
    }
    @Test void metadataContainsAllApprovedRestrictiveKeysAndChecks() {
        assertEquals(11,scalarUnchecked("SELECT COUNT(*) FROM information_schema.referential_constraints WHERE constraint_schema=DATABASE() AND table_name IN ('defect_retest_links','defect_closure_receipts','defect_closure_items') AND delete_rule='RESTRICT' AND update_rule='RESTRICT'"));
        assertEquals(10,scalarUnchecked("SELECT COUNT(*) FROM information_schema.table_constraints WHERE constraint_schema=DATABASE() AND table_name IN ('defect_retest_links','defect_closure_receipts','defect_closure_items') AND constraint_type='CHECK' AND enforced='YES'"));
        assertEquals(9,scalarUnchecked("SELECT COUNT(*) FROM information_schema.table_constraints WHERE constraint_schema=DATABASE() AND table_name IN ('defect_retest_links','defect_closure_receipts','defect_closure_items') AND constraint_type IN ('PRIMARY KEY','UNIQUE')"));
    }
    private void rejected(String sql,int code,String name) {
        SQLException error=assertThrows(SQLException.class,()->execute(c,sql));
        assertEquals(code,error.getErrorCode());assertTrue(error.getMessage().contains(name),error.getMessage());
    }
    private void executeUnchecked(String sql){try{execute(c,sql);}catch(SQLException e){throw new AssertionError(e);}}
    private int scalarUnchecked(String sql){try{return scalar(c,sql);}catch(SQLException e){throw new AssertionError(e);}}
    static String linkSql(long id,long defect,long fail,long pass) {
        return "INSERT INTO defect_retest_links(id,defect_id,failure_attempt_id,pass_attempt_id,policy_version,linked_by,review_note,timing_basis,request_key,request_hash,result_defect_version) VALUES("+id+","+defect+","+fail+","+pass+",'EXACT_SEMANTIC_V1',1,'Synthetic reviewed retest','MANUAL_SERVER_RECORD',UNHEX(LPAD('"+id+"',32,'0')),UNHEX(REPEAT('ab',32)),3)";
    }
    static String receiptSql(long id,long defect,int version) {
        return "INSERT INTO defect_closure_receipts(id,defect_id,closed_defect_version,closed_by,policy_version,resolution_note,evidence_count) VALUES("+id+","+defect+","+version+",1,'R1_CLOSURE_V1','Synthetic closure evidence',1)";
    }
    static String revokeSql(long id,long key,String op) {
        return "UPDATE defect_retest_links SET revoked_by=1,revoked_at=NOW(6),revoke_reason='Synthetic revoke',revocation_operation='"+op+"',revoke_request_key=UNHEX(LPAD('"+key+"',32,'0')),revoke_request_hash=UNHEX(REPEAT('12',32)),revoke_result_version=5 WHERE id="+id;
    }
    static String itemSql(long receipt,long fail,long defect,long pass,Long link,String policy) {
        return "INSERT INTO defect_closure_items(receipt_id,failure_attempt_id,defect_id,pass_attempt_id,retest_link_id,evidence_policy) VALUES("+receipt+","+fail+","+defect+","+pass+","+(link==null?"NULL":link)+",'"+policy+"')";
    }
    static void execute(Connection c,String sql)throws SQLException{try(var s=c.createStatement()){s.executeUpdate(sql);}}
    static int scalar(Connection c,String sql)throws SQLException{try(var s=c.createStatement();var r=s.executeQuery(sql)){assertTrue(r.next());return r.getInt(1);}}
    static Map<String,String> fingerprint(Connection c,List<String> tables)throws Exception {
        Map<String,String> out=new TreeMap<>();
        for(String t:tables){
            if(!t.matches("[a-z_]+"))throw new IllegalArgumentException("Unsafe table");
            MessageDigest d=MessageDigest.getInstance("SHA-256");
            try(var s=c.createStatement();var r=s.executeQuery("SHOW CREATE TABLE `"+t+"`")){assertTrue(r.next());d.update(r.getString(2).getBytes(java.nio.charset.StandardCharsets.UTF_8));}
            List<String> rows=new ArrayList<>();
            try(var s=c.createStatement();var r=s.executeQuery("SELECT * FROM `"+t+"`")){
                while(r.next()){StringBuilder row=new StringBuilder();for(int i=1;i<=r.getMetaData().getColumnCount();i++){
                    byte[] value=r.getBytes(i);row.append(value==null?"NULL":Base64.getEncoder().encodeToString(value)).append('|');
                }rows.add(row.toString());}
            }
            Collections.sort(rows);for(String row:rows)d.update(row.getBytes(java.nio.charset.StandardCharsets.UTF_8));
            out.put(t,HexFormat.of().formatHex(d.digest()));
        }return Map.copyOf(out);
    }
    static void seed(Connection c)throws SQLException {
        execute(c,"INSERT INTO users(id,username,display_name,password_hash,system_role,status) VALUES(1,'r1_synthetic','R1 Synthetic','non-login-fixture','USER','ACTIVE')");
        execute(c,"INSERT INTO projects(id,project_key,name,created_by) VALUES(1,'R1SYNTH','R1 synthetic',1)");
        execute(c,"INSERT INTO test_cases(id,project_id,key_no,title,created_by) VALUES(1,1,1,'Frozen synthetic case',1)");
        execute(c,"INSERT INTO test_runs(id,project_id,name,created_by) VALUES(1,1,'Synthetic original',1),(2,1,'Synthetic retest',1)");
        execute(c,"INSERT INTO test_run_cases(id,test_run_id,test_case_id,snapshot_title,snapshot_priority) VALUES(1,1,1,'Frozen synthetic case','MEDIUM'),(2,2,1,'Frozen synthetic case','MEDIUM')");
        execute(c,"INSERT INTO test_run_case_steps VALUES(1,1,'Synthetic action','Synthetic expected'),(2,1,'Synthetic action','Synthetic expected')");
        execute(c,"INSERT INTO test_attempts(id,test_run_case_id,attempt_no,status,executed_by,submission_key) VALUES(1,1,1,'FAIL',1,UNHEX(LPAD('1',32,'0'))),(2,2,1,'PASS',1,UNHEX(LPAD('2',32,'0'))),(3,2,2,'PASS',1,UNHEX(LPAD('3',32,'0'))),(4,1,2,'FAIL',1,UNHEX(LPAD('4',32,'0')))");
        execute(c,"INSERT INTO defects(id,project_id,key_no,title,reporter_id) VALUES(1,1,1,'Synthetic defect',1),(2,1,2,'Synthetic other defect',1)");
        execute(c,"INSERT INTO test_attempt_defects VALUES(1,1,1,NOW(6)),(1,2,1,NOW(6)),(4,1,1,NOW(6))");
    }
}
