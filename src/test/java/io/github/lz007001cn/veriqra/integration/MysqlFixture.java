package io.github.lz007001cn.veriqra.integration;

import io.github.lz007001cn.veriqra.config.DatabaseConfig;
import io.github.lz007001cn.veriqra.jdbc.*;
import io.github.lz007001cn.veriqra.model.*;
import org.junit.jupiter.api.*;
import java.nio.file.*;
import java.sql.*;
import java.time.Duration;
import java.util.*;
import java.util.regex.*;

/** Opt-in fixture: an empty, explicitly named local test schema, never the development schema. */
@Tag("mysql")
@TestInstance(TestInstance.Lifecycle.PER_CLASS)
abstract class MysqlFixture {
    protected ConnectionPool pool;
    protected JdbcTransactionManager tx;
    protected DatabaseConfig config;
    private Connection owner;
    private final List<String> createdTables = new ArrayList<>();
    private String schemaName;

    @BeforeAll void openFixture() throws Exception {
        Properties p=new Properties();
        String r1Selected=System.getProperty("r1.fixture.config");
        if(r1Selected!=null) {
            // An explicitly selected R1 target always wins. Missing/invalid files fail closed;
            // neither TEST_CONFIG nor TEST_* environment variables can redirect this fixture.
            try(var r=Files.newBufferedReader(Path.of(r1Selected))) { p.load(r); }
        } else {
            String selected=io.github.lz007001cn.veriqra.config.EnvironmentVariables.get("TEST_CONFIG");
            if(selected==null) selected=System.getProperty("veriqra.test.config","config/database-test.local.properties");
            Path file=Path.of(selected);
            if(Files.exists(file)) try(var r=Files.newBufferedReader(file)) { p.load(r); }
            for(var e:Map.of("jdbcUrl","JDBC_URL","username","USERNAME","password","PASSWORD").entrySet()) {
                String v=io.github.lz007001cn.veriqra.config.EnvironmentVariables.get("TEST_"+e.getValue()); if(v!=null) p.setProperty(e.getKey(),v);
            }
        }
        String url=p.getProperty("jdbcUrl","");
        schemaName=requireTestUrl(url);
        if("root".equalsIgnoreCase(p.getProperty("username"))) throw new IllegalArgumentException("Use a test-schema-scoped account, not root");
        config=new DatabaseConfig(url,p.getProperty("username"),p.getProperty("password"),2,4,Duration.ofSeconds(2));
        Properties credentials=new Properties(); credentials.setProperty("user",config.username()); credentials.setProperty("password",config.password());
        credentials.setProperty("connectTimeout","3000"); credentials.setProperty("socketTimeout","10000");
        owner=r1Selected!=null?R1MysqlTarget.open():DriverManager.getConnection(url,credentials);
        if(!schemaName.equals(owner.getCatalog())) throw new IllegalStateException("Unexpected selected schema");
        try(var s=owner.prepareStatement("SELECT VERSION(), GET_LOCK(?,0)")) {
            s.setString(1,"veriqra-jdbc-tests:"+UUID.nameUUIDFromBytes(schemaName.getBytes(java.nio.charset.StandardCharsets.UTF_8)));
            try(var r=s.executeQuery()) {
                r.next();
                if(!"8.0.46".equals(r.getString(1))) throw new IllegalStateException("Integration tests require MySQL 8.0.46");
                if(r.getInt(2)!=1) throw new IllegalStateException("Another test run owns this schema");
            }
        }
        requireEmptySchema(owner,schemaName);
        String schema=Files.readString(Path.of("database/schema.sql"));
        Matcher names=Pattern.compile("CREATE TABLE `([a-z_]+)`").matcher(schema);
        int count=0;
        while(names.find()) count++;
        if(count!=32) throw new IllegalStateException("Unexpected V1 plus Administration, Collaboration and Credit schema");
        installSchema(owner,schema,createdTables);
        // ALTER adds a FK from this previously-created table to newly-created credit_transfers.
        // Drop it first during reverse-order cleanup while keeping FOREIGN_KEY_CHECKS enabled.
        createdTables.remove("credit_transactions");
        createdTables.add("credit_transactions");
        // The unchanged 32-table baseline remains independently checked above. Current
        // service regressions also require the three approved additive R1 evidence tables.
        // Append in creation order so reverse cleanup drops items, receipts, then links
        // before any old evidence/Attempt/Defect endpoint, with all constraints enabled.
        installSchema(owner,Files.readString(Path.of("database/migrations/20261014-r1-defect-retest.sql")),createdTables);
        if(createdTables.size()!=35 || !createdTables.subList(32,35).equals(List.of(
                "defect_retest_links","defect_closure_receipts","defect_closure_items")))
            throw new IllegalStateException("Unexpected R1 fixture tables");
        pool=new ConnectionPool(config); tx=new JdbcTransactionManager(pool);
    }

    static String requireTestUrl(String url) {
        Matcher match=Pattern.compile("jdbc:mysql://(?:localhost|127\\.0\\.0\\.1):([0-9]{1,5})/(veriqra_test_[a-z0-9_]+)").matcher(url);
        if(!match.matches() || Integer.parseInt(match.group(1))<1 || Integer.parseInt(match.group(1))>65535
                || match.group(2).length()>64) {
            throw new IllegalArgumentException("Integration tests require an explicit local veriqra_test_* URL without query parameters");
        }
        return match.group(2);
    }

    static void requireEmptySchema(Connection owner,String schemaName) throws SQLException {
        try(var s=owner.prepareStatement("SELECT COUNT(*) FROM information_schema.tables WHERE table_schema=?")) {
            s.setString(1,schemaName);
            try(var r=s.executeQuery()) {
                if(!r.next() || r.getInt(1)!=0) throw new SQLException("Test schema must be EMPTY; existing objects will not be deleted");
            }
        }
    }

    static void installSchema(Connection owner,String schema,List<String> createdTables) throws SQLException {
        // This frozen script has no DELIMITER or semicolons inside literals; not a general SQL parser.
        for(String statement:schema.replaceAll("(?m)^--.*$","").split(";")) {
            if(!statement.isBlank()) {
                try(var s=owner.createStatement()) {
                    s.execute(statement);
                    // Register immediately after successful CREATE, even if Statement.close then fails.
                    Matcher created=Pattern.compile("^CREATE TABLE `([a-z_]+)`").matcher(statement.stripLeading());
                    if(created.find()) createdTables.add(created.group(1));
                }
            }
        }
    }

    @BeforeEach void resetRows() throws SQLException {
        // Only rows inserted by this fixture; the development seed is never loaded or referenced.
        try(var c=pool.borrow(); var s=c.createStatement()) {
            // Fresh fixture-owned close-time records must be removed before their retained
            // source associations. Keep both FOREIGN_KEY_CHECKS and CHECK rules enabled.
            //noinspection SqlWithoutWhere
            s.executeUpdate("DELETE FROM defect_closure_items");
            //noinspection SqlWithoutWhere
            s.executeUpdate("DELETE FROM defect_closure_receipts");
            //noinspection SqlWithoutWhere
            s.executeUpdate("DELETE FROM defect_retest_links");
            // Admin telemetry, ledger and collaboration records depend on users and projects.
            //noinspection SqlWithoutWhere
            s.executeUpdate("DELETE FROM audit_logs");
            //noinspection SqlWithoutWhere
            s.executeUpdate("DELETE FROM access_logs");
            //noinspection SqlWithoutWhere
            s.executeUpdate("DELETE FROM login_events");
            //noinspection SqlWithoutWhere
            s.executeUpdate("DELETE FROM credit_transactions");
            //noinspection SqlWithoutWhere
            s.executeUpdate("DELETE FROM credit_transfers");
            //noinspection SqlWithoutWhere
            s.executeUpdate("DELETE FROM task_handoff_offers");
            //noinspection SqlWithoutWhere
            s.executeUpdate("DELETE FROM credit_accounts");
            //noinspection SqlWithoutWhere
            s.executeUpdate("DELETE FROM work_task_events");
            //noinspection SqlWithoutWhere
            s.executeUpdate("DELETE FROM contribution_events");
            //noinspection SqlWithoutWhere
            s.executeUpdate("DELETE FROM work_tasks");
            //noinspection SqlWithoutWhere
            s.executeUpdate("DELETE FROM team_members");
            //noinspection SqlWithoutWhere
            s.executeUpdate("DELETE FROM project_teams");
            //noinspection SqlWithoutWhere
            s.executeUpdate("DELETE FROM project_managers");
            // Intentional full cleanup of fixture-owned test tables; keep FK checks enabled.
            //noinspection SqlWithoutWhere
            s.executeUpdate("DELETE FROM test_attempt_defects");
            //noinspection SqlWithoutWhere
            s.executeUpdate("DELETE FROM test_attempts");
            //noinspection SqlWithoutWhere
            s.executeUpdate("DELETE FROM test_imports");
            //noinspection SqlWithoutWhere
            s.executeUpdate("DELETE FROM test_automation_mappings");
            //noinspection SqlWithoutWhere
            s.executeUpdate("DELETE FROM test_automation_identities");
            //noinspection SqlWithoutWhere
            s.executeUpdate("DELETE FROM defects");
            //noinspection SqlWithoutWhere
            s.executeUpdate("DELETE FROM test_run_case_steps");
            //noinspection SqlWithoutWhere
            s.executeUpdate("DELETE FROM test_run_cases");
            //noinspection SqlWithoutWhere
            s.executeUpdate("DELETE FROM test_runs");
            //noinspection SqlWithoutWhere
            s.executeUpdate("DELETE FROM test_plan_cases");
            //noinspection SqlWithoutWhere
            s.executeUpdate("DELETE FROM test_case_requirements");
            //noinspection SqlWithoutWhere
            s.executeUpdate("DELETE FROM test_steps");
            //noinspection SqlWithoutWhere
            s.executeUpdate("DELETE FROM test_plans");
            //noinspection SqlWithoutWhere
            s.executeUpdate("DELETE FROM test_cases");
            //noinspection SqlWithoutWhere
            s.executeUpdate("DELETE FROM requirements");
            //noinspection SqlWithoutWhere
            s.executeUpdate("DELETE FROM project_counters");
            //noinspection SqlWithoutWhere
            s.executeUpdate("DELETE FROM project_members");
            //noinspection SqlWithoutWhere
            s.executeUpdate("DELETE FROM projects");
            //noinspection SqlWithoutWhere
            s.executeUpdate("DELETE FROM users");
        }
    }

    @AfterAll void closeFixture() throws SQLException {
        ConnectionPool closingPool=pool; Connection closingOwner=owner;
        List<String> owned=List.copyOf(createdTables);
        pool=null; owner=null; createdTables.clear(); // JUnit may call cleanup after a failed setup.
        cleanup(closingPool,closingOwner,schemaName,owned);
    }

    static void cleanup(ConnectionPool pool,Connection owner,String schemaName,List<String> owned) throws SQLException {
        SQLException failure=null;
        try { if(pool!=null) pool.close(); } catch(SQLException e) { failure=e; }
        try {
            if(owner!=null && !owned.isEmpty()) {
                if(schemaName==null || !schemaName.matches("veriqra_test_[a-z0-9_]+") || !schemaName.equals(owner.getCatalog())
                        || owned.stream().anyMatch(t->!t.matches("[a-z_]+"))) {
                    throw new SQLException("Refusing cleanup: test schema ownership does not match");
                }
                for(String table:owned.reversed()) {
                    try(var s=owner.createStatement()) {
                        // Identifiers passed the ownership/format guards above; no user SQL is accepted.
                        //noinspection SqlSourceToSinkFlow
                        s.execute("DROP TABLE IF EXISTS `"+schemaName+"`.`"+table+"`");
                    }
                    catch(SQLException e) { if(failure==null) failure=e; else failure.addSuppressed(e); }
                }
            }
        } catch(SQLException e) { if(failure==null) failure=e; else failure.addSuppressed(e); }
        finally {
            // Preserve earlier pool/DDL failures even when releasing the lock/owner also fails.
            try { if(owner!=null) owner.close(); }
            catch(SQLException e) { if(failure==null) failure=e; else failure.addSuppressed(e); }
        }
        if(failure!=null) throw failure;
    }

    protected User user(String name) {
        // A persistence fixture, not a usable login credential or hashing implementation.
        return new User(null,name,"测试用户", "fixture-hash-not-for-login",SystemRole.USER,UserStatus.ACTIVE,null,null,null);
    }
    protected Project project(String key,Long creator) {
        return new Project(null,key,"测试项目",null,ProjectStatus.ACTIVE,creator,null,null,null);
    }
    protected long count(String table) throws SQLException {
        if(!Set.of("users","projects").contains(table)) throw new IllegalArgumentException("Unsupported fixture table");
        try(var c=pool.borrow(); var s=c.createStatement(); var r=s.executeQuery("SELECT COUNT(*) FROM "+table)) { r.next(); return r.getLong(1); }
    }
}
