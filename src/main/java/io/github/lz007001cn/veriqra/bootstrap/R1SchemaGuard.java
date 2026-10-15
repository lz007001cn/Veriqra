package io.github.lz007001cn.veriqra.bootstrap;

import java.sql.*;
import java.util.*;

/** Read-only startup verification of the three approved R1 tables. Never installs or repairs schema. */
public final class R1SchemaGuard {
    public static final String SAFE_MESSAGE = "R1 schema is missing or incompatible; apply the approved migration before startup";
    private static final String SCOPE = " AND TABLE_NAME IN ('defect_retest_links','defect_closure_receipts','defect_closure_items')";
    private static final Map<String, Definition> APPROVED = approved();
    private R1SchemaGuard() { }

    public static void verify(Connection connection) throws SQLException {
        String schema = connection.getCatalog();
        if (schema == null || schema.isBlank()) throw incompatible();
        var tables = new HashSet<String>();
        try (var statement = query(connection, schema,
                "SELECT TABLE_NAME,TABLE_TYPE,ENGINE,ROW_FORMAT,TABLE_COLLATION FROM information_schema.TABLES WHERE TABLE_SCHEMA=?" + SCOPE);
             var rows = statement.executeQuery()) {
            while (rows.next()) {
                if (!"BASE TABLE".equals(rows.getString(2)) || !"InnoDB".equals(rows.getString(3))
                        || !"Dynamic".equals(rows.getString(4)) || !"utf8mb4_0900_ai_ci".equals(rows.getString(5))) throw incompatible();
                tables.add(rows.getString(1));
            }
        }
        if (!tables.equals(APPROVED.keySet())) throw incompatible();
        var columns = groupedLists();
        try (var statement = query(connection, schema,
                "SELECT TABLE_NAME,COLUMN_NAME,COLUMN_TYPE,IS_NULLABLE,CHARACTER_SET_NAME,COLLATION_NAME,COLUMN_DEFAULT,EXTRA,GENERATION_EXPRESSION FROM information_schema.COLUMNS WHERE TABLE_SCHEMA=?" + SCOPE + " ORDER BY TABLE_NAME,ORDINAL_POSITION");
             var rows = statement.executeQuery()) {
            while (rows.next()) columns.get(rows.getString(1)).add(new Column(rows.getString(2), rows.getString(3),
                    "YES".equals(rows.getString(4)), rows.getString(5), rows.getString(6), lower(rows.getString(7)),
                    lower(rows.getString(8)), expression(rows.getString(9))));
        }
        for (var table : APPROVED.entrySet()) if (!table.getValue().columns().equals(columns.get(table.getKey()))) throw incompatible();
        verifyIndexes(connection, schema);
        verifyForeignKeys(connection, schema);
        verifyChecks(connection, schema);
    }

    private static void verifyIndexes(Connection connection, String schema) throws SQLException {
        var actual = groupedMaps();
        try (var statement = query(connection, schema,
                "SELECT TABLE_NAME,INDEX_NAME,NON_UNIQUE,COLUMN_NAME,SUB_PART,INDEX_TYPE,IS_VISIBLE,EXPRESSION,COLLATION FROM information_schema.STATISTICS WHERE TABLE_SCHEMA=?" + SCOPE + " ORDER BY TABLE_NAME,INDEX_NAME,SEQ_IN_INDEX");
             var rows = statement.executeQuery()) {
            while (rows.next()) {
                if (rows.getObject(5) != null || !"BTREE".equals(rows.getString(6)) || !"YES".equals(rows.getString(7))
                        || rows.getObject(8) != null || !"A".equals(rows.getString(9))) throw incompatible();
                var key = rows.getString(2); var table = actual.get(rows.getString(1));
                String component = (rows.getInt(3) == 0 ? "U:" : "N:") + rows.getString(4);
                table.merge(key, component, (a,b) -> a + "," + b);
            }
        }
        for (var table : APPROVED.entrySet()) if (!table.getValue().indexes().equals(actual.get(table.getKey()))) throw incompatible();
    }
    private static void verifyForeignKeys(Connection connection, String schema) throws SQLException {
        var actual = groupedMaps();
        String sql = "SELECT k.TABLE_NAME,k.CONSTRAINT_NAME,k.COLUMN_NAME,k.REFERENCED_TABLE_SCHEMA,k.REFERENCED_TABLE_NAME,k.REFERENCED_COLUMN_NAME,r.DELETE_RULE,r.UPDATE_RULE,r.MATCH_OPTION "
                + "FROM information_schema.KEY_COLUMN_USAGE k JOIN information_schema.REFERENTIAL_CONSTRAINTS r ON r.CONSTRAINT_SCHEMA=k.CONSTRAINT_SCHEMA AND r.CONSTRAINT_NAME=k.CONSTRAINT_NAME "
                + "WHERE k.TABLE_SCHEMA=? AND k.TABLE_NAME IN ('defect_retest_links','defect_closure_receipts','defect_closure_items') ORDER BY k.TABLE_NAME,k.CONSTRAINT_NAME,k.ORDINAL_POSITION";
        try (var statement = query(connection, schema, sql); var rows = statement.executeQuery()) {
            while (rows.next()) {
                if (!schema.equals(rows.getString(4)) || !"RESTRICT".equals(rows.getString(7))
                        || !"RESTRICT".equals(rows.getString(8)) || !"NONE".equals(rows.getString(9))) throw incompatible();
                actual.get(rows.getString(1)).merge(rows.getString(2), rows.getString(3) + "=" + rows.getString(5) + "." + rows.getString(6), (a,b) -> a + "," + b);
            }
        }
        for (var table : APPROVED.entrySet()) if (!table.getValue().foreignKeys().equals(actual.get(table.getKey()))) throw incompatible();
    }
    private static void verifyChecks(Connection connection, String schema) throws SQLException {
        var actual = groupedMaps();
        String sql = "SELECT t.TABLE_NAME,t.CONSTRAINT_NAME,c.CHECK_CLAUSE,t.ENFORCED FROM information_schema.TABLE_CONSTRAINTS t "
                + "JOIN information_schema.CHECK_CONSTRAINTS c ON c.CONSTRAINT_SCHEMA=t.CONSTRAINT_SCHEMA AND c.CONSTRAINT_NAME=t.CONSTRAINT_NAME "
                + "WHERE t.TABLE_SCHEMA=? AND t.TABLE_NAME IN ('defect_retest_links','defect_closure_receipts','defect_closure_items') AND t.CONSTRAINT_TYPE='CHECK' ORDER BY t.TABLE_NAME,t.CONSTRAINT_NAME";
        try (var statement = query(connection, schema, sql); var rows = statement.executeQuery()) {
            while (rows.next()) {
                if (!"YES".equals(rows.getString(4))) throw incompatible();
                actual.get(rows.getString(1)).put(rows.getString(2), expression(rows.getString(3)));
            }
        }
        for (var table : APPROVED.entrySet()) if (!table.getValue().checks().equals(actual.get(table.getKey()))) throw incompatible();
    }
    private static PreparedStatement query(Connection connection, String schema, String sql) throws SQLException {
        var statement = connection.prepareStatement(sql);
        try { statement.setString(1, schema); return statement; }
        catch (SQLException failure) { try { statement.close(); } catch (SQLException ignored) { } throw failure; }
    }
    private static Map<String,List<Column>> groupedLists() {
        var result = new HashMap<String,List<Column>>(); APPROVED.keySet().forEach(name -> result.put(name, new ArrayList<>())); return result;
    }
    private static Map<String,Map<String,String>> groupedMaps() {
        var result = new HashMap<String,Map<String,String>>(); APPROVED.keySet().forEach(name -> result.put(name, new TreeMap<>())); return result;
    }
    private static String lower(String value) { return value == null ? null : value.toLowerCase(Locale.ROOT); }
    private static Column column(String name, String type, boolean nullable) { return new Column(name,type,nullable,null,null,null,"",""); }
    private static Column id() { return new Column("id","bigint",false,null,null,null,"auto_increment",""); }
    private static Column time(String name, boolean nullable, boolean generatedDefault) {
        return new Column(name,"datetime(6)",nullable,null,null,generatedDefault?"current_timestamp(6)":null,generatedDefault?"default_generated":"","");
    }
    private static Column text(String name, String type, boolean nullable, boolean ascii) {
        return new Column(name,type,nullable,ascii?"ascii":"utf8mb4",ascii?"ascii_bin":"utf8mb4_0900_ai_ci",null,"","");
    }
    private static Map<String,String> pairs(String... pairs) {
        var result = new TreeMap<String,String>();
        for (int i=0; i<pairs.length; i+=2) result.put(pairs[i], pairs[i+1]); return Map.copyOf(result);
    }
    private static Map<String,String> checks(String... pairs) {
        var result = new TreeMap<String,String>();
        for (int i=0; i<pairs.length; i+=2) result.put(pairs[i], expression(pairs[i+1])); return Map.copyOf(result);
    }
    private static Map<String,Definition> approved() {
        Definition links = new Definition(List.of(id(), column("defect_id","bigint",false), column("failure_attempt_id","bigint",false),
                column("pass_attempt_id","bigint",false), text("policy_version","varchar(32)",false,true), column("linked_by","bigint",false),
                time("linked_at",false,true), text("review_note","varchar(2000)",false,false), text("timing_basis","varchar(32)",false,true),
                column("request_key","binary(16)",false), column("request_hash","binary(32)",false), column("result_defect_version","int unsigned",false),
                column("revoked_by","bigint",true), time("revoked_at",true,false), text("revoke_reason","varchar(2000)",true,false),
                text("revocation_operation","varchar(16)",true,true), column("revoke_request_key","binary(16)",true), column("revoke_request_hash","binary(32)",true),
                column("revoke_result_version","int unsigned",true), new Column("active_failure_id","bigint",true,null,null,null,"stored generated",
                        expression("CASE WHEN revoked_at IS NULL THEN failure_attempt_id ELSE NULL END"))),
                pairs("PRIMARY","U:id", "uq_retests_active_source","U:defect_id,U:active_failure_id", "uq_retests_endpoints","U:id,U:defect_id,U:failure_attempt_id,U:pass_attempt_id",
                        "uq_retests_request","U:request_key", "uq_retests_revoke_request","U:revoke_request_key", "ix_retests_defect_failure","N:defect_id,N:failure_attempt_id,N:id",
                        "ix_retests_source","N:failure_attempt_id,N:defect_id", "ix_retests_pass","N:pass_attempt_id", "ix_retests_linked_by","N:linked_by", "ix_retests_revoked_by","N:revoked_by"),
                pairs("fk_retests_defect","defect_id=defects.id", "fk_retests_source","failure_attempt_id=test_attempt_defects.attempt_id,defect_id=test_attempt_defects.defect_id",
                        "fk_retests_pass","pass_attempt_id=test_attempts.id", "fk_retests_linked_by","linked_by=users.id", "fk_retests_revoked_by","revoked_by=users.id"),
                checks("ck_retests_different_attempts","failure_attempt_id <> pass_attempt_id", "ck_retests_policy","policy_version = 'EXACT_SEMANTIC_V1'",
                        "ck_retests_note","CHAR_LENGTH(TRIM(review_note)) > 0", "ck_retests_timing","timing_basis IN ('MANUAL_SERVER_RECORD','IMPORT_REVIEW_ATTESTATION')",
                        "ck_retests_revocation","(revoked_by IS NULL AND revoked_at IS NULL AND revoke_reason IS NULL AND revocation_operation IS NULL AND revoke_request_key IS NULL AND revoke_request_hash IS NULL AND revoke_result_version IS NULL) OR "
                                + "(revoked_by IS NOT NULL AND revoked_at IS NOT NULL AND revoke_reason IS NOT NULL AND revocation_operation IS NOT NULL AND revoke_request_key IS NOT NULL AND revoke_request_hash IS NOT NULL AND revoke_result_version IS NOT NULL AND revoked_at >= linked_at AND CHAR_LENGTH(TRIM(revoke_reason)) > 0 AND revocation_operation IN ('REVOKE','REPLACE'))"));
        Definition receipts = new Definition(List.of(id(), column("defect_id","bigint",false), column("closed_defect_version","int unsigned",false), column("closed_by","bigint",false),
                time("closed_at",false,true), text("policy_version","varchar(32)",false,true), text("resolution_note","text",false,false), column("evidence_count","int unsigned",false)),
                pairs("PRIMARY","U:id", "uq_closures_defect_version","U:defect_id,U:closed_defect_version", "uq_closures_owner","U:id,U:defect_id", "ix_closures_defect_time","N:defect_id,N:closed_at,N:id", "ix_closures_closed_by","N:closed_by"),
                pairs("fk_closures_defect","defect_id=defects.id", "fk_closures_actor","closed_by=users.id"),
                checks("ck_closures_policy","policy_version = 'R1_CLOSURE_V1'", "ck_closures_note","CHAR_LENGTH(TRIM(resolution_note)) > 0", "ck_closures_count","evidence_count > 0"));
        Definition items = new Definition(List.of(column("receipt_id","bigint",false), column("failure_attempt_id","bigint",false), column("defect_id","bigint",false),
                column("pass_attempt_id","bigint",false), column("retest_link_id","bigint",true), text("evidence_policy","varchar(32)",false,true)),
                pairs("PRIMARY","U:receipt_id,U:failure_attempt_id", "ix_closure_items_owner","N:receipt_id,N:defect_id", "ix_closure_items_source","N:failure_attempt_id,N:defect_id",
                        "ix_closure_items_pass","N:pass_attempt_id", "ix_closure_items_link","N:retest_link_id,N:defect_id,N:failure_attempt_id,N:pass_attempt_id"),
                pairs("fk_closure_items_owner","receipt_id=defect_closure_receipts.id,defect_id=defect_closure_receipts.defect_id", "fk_closure_items_source","failure_attempt_id=test_attempt_defects.attempt_id,defect_id=test_attempt_defects.defect_id",
                        "fk_closure_items_pass","pass_attempt_id=test_attempts.id", "fk_closure_items_link","retest_link_id=defect_retest_links.id,defect_id=defect_retest_links.defect_id,failure_attempt_id=defect_retest_links.failure_attempt_id,pass_attempt_id=defect_retest_links.pass_attempt_id"),
                checks("ck_closure_items_different","failure_attempt_id <> pass_attempt_id", "ck_closure_items_policy","(evidence_policy = 'SAME_RUN_CASE_V1' AND retest_link_id IS NULL) OR (evidence_policy = 'EXACT_SEMANTIC_V1' AND retest_link_id IS NOT NULL)"));
        return Map.of("defect_retest_links",links,"defect_closure_receipts",receipts,"defect_closure_items",items);
    }
    private record Column(String name, String type, boolean nullable, String charset, String collation, String defaultValue, String extra, String generated) { }
    private record Definition(List<Column> columns, Map<String,String> indexes, Map<String,String> foreignKeys, Map<String,String> checks) { }
    public static final class IncompatibleSchema extends IllegalStateException {
        private IncompatibleSchema() { super(SAFE_MESSAGE); }
    }
    private static IncompatibleSchema incompatible() { return new IncompatibleSchema(); }

    /** Canonicalizes MySQL's expression formatting while retaining literal case and boolean grouping. */
    static String expression(String source) {
        if (source == null || source.isBlank()) return "";
        // MySQL 8 information_schema escapes literal quote delimiters in CHECK_CLAUSE.
        // The approved literals contain no embedded quotes; unsupported syntax still fails closed.
        source=source.replace("\\'", "'");
        try { return new Expression(source).parse(); }
        catch (IllegalArgumentException failure) { throw incompatible(); }
    }
    private static final class Expression {
        private final List<String> tokens = new ArrayList<>(); private int position;
        Expression(String source) {
            for (int i=0; i<source.length();) {
                char c=source.charAt(i);
                if (Character.isWhitespace(c)) { i++; continue; }
                if (c=='`') { int end=source.indexOf('`',i+1); if(end<0)throw invalid(); tokens.add(source.substring(i+1,end).toLowerCase(Locale.ROOT)); i=end+1; continue; }
                if (c=='\'') {
                    int start=i++; boolean closed=false;
                    while(i<source.length()) { if(source.charAt(i++)=='\'') { if(i<source.length() && source.charAt(i)=='\'')i++; else {closed=true;break;} } }
                    if(!closed)throw invalid(); tokens.add(source.substring(start,i)); continue;
                }
                if (Character.isLetterOrDigit(c) || c=='_') {
                    int start=i++; while(i<source.length() && (Character.isLetterOrDigit(source.charAt(i)) || source.charAt(i)=='_'))i++;
                    String word=source.substring(start,i).toLowerCase(Locale.ROOT);
                    if(word.startsWith("_") && i<source.length() && source.charAt(i)=='\'')continue;
                    tokens.add(word); continue;
                }
                if ("(),=<>".indexOf(c)>=0) {
                    String token=String.valueOf(c); i++;
                    if(i<source.length() && ((c=='<' && source.charAt(i)=='>') || ((c=='<' || c=='>') && source.charAt(i)=='=')))token+=source.charAt(i++);
                    tokens.add(token); continue;
                }
                throw invalid();
            }
        }
        String parse() { String value=or(); if(position!=tokens.size())throw invalid(); return value; }
        private String or() { String value=and(); while(take("or"))value="or("+value+","+and()+")"; return value; }
        private String and() { String value=condition(); while(take("and"))value="and("+value+","+condition()+")"; return value; }
        private String condition() {
            String value=atom();
            if(take("is")) { boolean not=take("not"); expect("null"); return (not?"notnull(":"null(")+value+")"; }
            if(take("in")) { expect("("); var values=new ArrayList<String>(); do {values.add(atom());}while(take(",")); expect(")"); return "in("+value+","+String.join(",",values)+")"; }
            String op=peek(); if(Set.of("=","<>",">",">=","<","<=").contains(op)) {position++;return op+"("+value+","+atom()+")";} return value;
        }
        private String atom() {
            if(take("(")) {String value=or(); expect(")"); return value;}
            if(take("case")) {expect("when");String condition=or();expect("then");String yes=atom();expect("else");String no=atom();expect("end");return "case("+condition+","+yes+","+no+")";}
            String token=peek(); if(token.isEmpty() || Set.of(")",",","=","<>",">",">=","<","<=","and","or","then","else","end").contains(token))throw invalid();
            position++; if(take("(")) {String value=or();expect(")");return token+"("+value+")";}return token;
        }
        private String peek() {return position<tokens.size()?tokens.get(position):"";}
        private boolean take(String token) {if(!token.equals(peek()))return false;position++;return true;}
        private void expect(String token) {if(!take(token))throw invalid();}
        private static IllegalArgumentException invalid() {return new IllegalArgumentException("Unsupported schema expression");}
    }
}
