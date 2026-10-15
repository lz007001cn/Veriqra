package io.github.lz007001cn.veriqra.integration;

import io.github.lz007001cn.veriqra.config.DatabaseConfig;
import io.github.lz007001cn.veriqra.dao.jdbc.*;
import io.github.lz007001cn.veriqra.jdbc.*;
import io.github.lz007001cn.veriqra.model.*;
import io.github.lz007001cn.veriqra.service.*;
import io.github.lz007001cn.veriqra.service.command.*;
import io.github.lz007001cn.veriqra.service.importing.*;
import io.github.lz007001cn.veriqra.service.query.*;
import io.github.lz007001cn.veriqra.service.exception.R1RuleException;
import io.github.lz007001cn.veriqra.service.support.*;
import org.junit.jupiter.api.*;

import java.lang.reflect.*;
import java.nio.charset.StandardCharsets;
import java.nio.file.*;
import java.sql.*;
import java.time.*;
import java.util.*;
import java.util.concurrent.*;
import java.util.concurrent.atomic.AtomicBoolean;
import java.util.function.UnaryOperator;

import static org.junit.jupiter.api.Assertions.*;

/** Fresh, identity-guarded R1 schema. Retained after tests for evidence; never uses environment defaults. */
@Tag("mysql")
@TestInstance(TestInstance.Lifecycle.PER_CLASS)
abstract class R1ServiceFixture {
    protected ConnectionPool pool;
    protected JdbcTransactionManager tx;
    protected JdbcServiceTransaction serviceTx;
    protected final JdbcServiceDaoFactory jdbcDaos = new JdbcServiceDaoFactory();
    protected final ProjectAccessPolicy access = new ProjectAccessPolicy();
    protected final Clock executionClock = Clock.fixed(Instant.parse("2030-01-01T00:00:00Z"), ZoneOffset.UTC);
    protected ProjectService projects;
    protected TestCaseService testCases;
    protected TestRunService testRuns;
    protected TestExecutionService execution;
    protected DefectService defects;
    protected AutomationService automation;
    protected TestImportService imports;
    private Connection owner;
    private int sequence;
    private String activeTestName;
    private final List<Map<String, Object>> observedLockRaces = new ArrayList<>();

    @BeforeAll void openR1Fixture() throws Exception {
        owner = R1MysqlTarget.open();
        MysqlFixture.requireEmptySchema(owner, owner.getCatalog());
        List<String> installed = new ArrayList<>();
        MysqlFixture.installSchema(owner, Files.readString(Path.of("database/schema.sql")), installed);
        assertEquals(32, installed.size(), "The unchanged baseline must contain 32 tables");
        MysqlFixture.installSchema(owner, Files.readString(Path.of("database/migrations/20261014-r1-defect-retest.sql")), installed);
        assertEquals(35, installed.size(), "Only the three approved R1 tables may be added");
        Properties p = new Properties();
        try (var reader = Files.newBufferedReader(Path.of(System.getProperty("r1.fixture.config")))) { p.load(reader); }
        try (var statement = owner.createStatement(); var identity = statement.executeQuery("SELECT @@port")) {
            assertTrue(identity.next());
            assertEquals("jdbc:mysql://127.0.0.1:" + identity.getInt(1) + "/" + owner.getCatalog(), p.getProperty("jdbcUrl"));
            assertEquals("r1_foundation", p.getProperty("username"));
        }
        pool = new ConnectionPool(new DatabaseConfig(p.getProperty("jdbcUrl"), p.getProperty("username"),
                p.getProperty("password"), 2, 6, Duration.ofSeconds(5)));
        tx = new JdbcTransactionManager(pool);
        serviceTx = new JdbcServiceTransaction(tx);
        projects = new DefaultProjectService(serviceTx, jdbcDaos, access);
        testCases = new DefaultTestCaseService(serviceTx, jdbcDaos, access);
        testRuns = new DefaultTestRunService(serviceTx, jdbcDaos, access, executionClock);
        execution = new DefaultTestExecutionService(serviceTx, jdbcDaos, access, executionClock);
        defects = new DefaultDefectService(serviceTx, jdbcDaos, access);
        automation = new DefaultAutomationService(serviceTx, jdbcDaos, access);
        imports = new DefaultTestImportService(serviceTx, jdbcDaos, access, new JUnitXmlParser(), executionClock);
    }

    @AfterAll void retainR1Fixture() throws Exception {
        try {
            String evidence = System.getProperty("r1.concurrency.evidence");
            if (evidence != null && !observedLockRaces.isEmpty()) new com.fasterxml.jackson.databind.ObjectMapper()
                    .writerWithDefaultPrettyPrinter().writeValue(Path.of(evidence).toFile(), observedLockRaces);
        }
        finally {
            try { if (pool != null) pool.close(); }
            finally { if (owner != null) owner.close(); }
        }
    }

    @BeforeEach void rememberTest(TestInfo info) {
        activeTestName = info.getTestMethod().map(Method::getName).orElse(info.getDisplayName());
    }

    /** Each test owns a distinct project. No DELETE/TRUNCATE/reset or mutation of previous test facts. */
    protected Scenario scenario() {
        int n = ++sequence;
        User admin = actor("r1-admin-" + n, SystemRole.ADMIN, UserStatus.ACTIVE);
        User tester = actor("r1-tester-" + n, SystemRole.USER, UserStatus.ACTIVE);
        User developer = actor("r1-dev-" + n, SystemRole.USER, UserStatus.ACTIVE);
        Project project = projects.create(admin.id(), new CreateProjectCommand("R1T" + n, "R1 synthetic " + n,
                null, tester.id(), ProjectRole.TESTER));
        addMember(project, developer, ProjectRole.DEVELOPER, MembershipStatus.ACTIVE);
        TestCase testCase = readyCase(tester, project, "Frozen case " + n, "Description", "Preconditions",
                Priority.MEDIUM, List.of(new TestStepInput(1, "Action 1", "Expected 1"),
                        new TestStepInput(2, "Action 2", "Expected 2")));
        return new Scenario(admin, tester, developer, project, testCase);
    }

    protected User actor(String name, SystemRole role, UserStatus status) {
        return tx.inTransaction(c -> new JdbcUserDao(c).insert(new User(null, name, name,
                "synthetic-non-login-fixture", role, status, null, null, null)));
    }

    protected void addMember(Project p, User u, ProjectRole role, MembershipStatus status) {
        tx.inTransaction(c -> new JdbcProjectMemberDao(c).add(new ProjectMember(p.id(), u.id(), role, status, null, null, null)));
    }

    protected TestCase readyCase(User actor, Project project, String title, String description,
                                 String preconditions, Priority priority, List<TestStepInput> steps) {
        TestCase draft = testCases.create(actor.id(), new CreateTestCaseCommand(project.id(), title, description,
                preconditions, priority, steps));
        return testCases.update(actor.id(), new UpdateTestCaseCommand(draft.id(), title, description, preconditions,
                priority, TestCaseStatus.READY, draft.lockVersion(), steps));
    }

    protected TestCase revise(Scenario s, String title, String description, String preconditions,
                               Priority priority, List<TestStepInput> steps) {
        TestCase current = testCases.get(s.tester().id(), s.testCase().id());
        TestCase changed = testCases.update(s.tester().id(), new UpdateTestCaseCommand(current.id(), title,
                description, preconditions, priority, TestCaseStatus.READY, current.lockVersion(), steps));
        if (changed.status() == TestCaseStatus.DRAFT) changed = testCases.update(s.tester().id(),
                new UpdateTestCaseCommand(changed.id(), title, description, preconditions, priority,
                        TestCaseStatus.READY, changed.lockVersion(), steps));
        return changed;
    }

    protected Run run(Scenario s) { return run(s, s.testCase()); }
    protected Run run(Scenario s, TestCase tc) {
        TestRun value = testRuns.createAdHoc(s.tester().id(), new CreateAdHocRunCommand(s.project().id(),
                "Synthetic run", "test", "r1", List.of(tc.id())));
        return new Run(value, testRuns.listRunCases(s.tester().id(), value.id()).getFirst());
    }

    protected TestAttempt attempt(Scenario s, Run run, TestAttemptStatus status) {
        return append(execution, s, run, status);
    }
    protected TestAttempt append(TestExecutionService service, Scenario s, Run run, TestAttemptStatus status) {
        return service.recordAttempt(s.tester().id(), new RecordAttemptCommand(run.runCase().id(), status,
                10L, "Synthetic execution", status == TestAttemptStatus.FAIL ? "Synthetic failure" : null, UUID.randomUUID()));
    }

    protected Defect defect(Scenario s, TestAttempt failure) {
        return defects.create(s.tester().id(), new CreateDefectCommand(s.project().id(), failure.id(),
                "Synthetic R1 defect", "Synthetic description", DefectSeverity.HIGH, Priority.HIGH, s.developer().id()));
    }
    protected Defect resolve(Scenario s, Defect d) {
        Defect working = defects.transition(s.developer().id(), new TransitionDefectCommand(d.id(),
                DefectStatus.IN_PROGRESS, null, d.lockVersion()));
        return defects.transition(s.developer().id(), new TransitionDefectCommand(d.id(), DefectStatus.RESOLVED,
                "Fixed with synthetic evidence", working.lockVersion()));
    }
    protected Defect current(Scenario s, Defect d) { return defects.get(s.tester().id(), d.id()); }
    protected Defect close(Scenario s, Defect d) { return close(defects, s, d); }
    protected Defect close(DefectService service, Scenario s, Defect d) {
        return service.transition(s.tester().id(), s.project().id(),
                new TransitionDefectCommand(d.id(), DefectStatus.CLOSED, null, d.lockVersion()));
    }

    protected List<DefectClosureReceipt> receipts(Defect d) {
        return tx.inTransaction(c -> new JdbcDefectClosureReceiptDao(c).listByDefect(d.id()));
    }
    protected List<DefectClosureItem> items(DefectClosureReceipt receipt) {
        return tx.inTransaction(c -> new JdbcDefectClosureItemDao(c).listByReceipt(receipt.id()));
    }
    protected List<DefectRetestLink> links(Defect d) {
        return tx.inTransaction(c -> new JdbcDefectRetestLinkDao(c).listByDefect(d.id()));
    }

    protected RetestOperationResult link(Scenario s, Defect d, TestAttempt fail, TestAttempt pass) {
        return defects.linkRetest(s.tester().id(), s.project().id(), linkCommand(d, fail, pass));
    }
    protected LinkRetestCommand linkCommand(Defect d, TestAttempt fail, TestAttempt pass) {
        return new LinkRetestCommand(d.id(), fail.id(), pass.id(), d.lockVersion(), UUID.randomUUID(),
                "I confirm this was an actual subsequent retest of the retained failure.",
                pass.importId() == null ? DefectRetestTimingBasis.MANUAL_SERVER_RECORD
                        : DefectRetestTimingBasis.IMPORT_REVIEW_ATTESTATION, null, null);
    }
    protected ClosureEligibility eligibility(Scenario s, Defect d) {
        return defects.closureEligibility(s.tester().id(), s.project().id(), d.id());
    }
    protected static R1RuleException rejected(String reason, org.junit.jupiter.api.function.Executable work) {
        R1RuleException error = assertThrows(R1RuleException.class, work);
        assertEquals(reason, error.reasonCode());
        return error;
    }
    protected void addEvidence(Scenario s, Defect d, TestAttempt fail) {
        defects.addEvidence(s.tester().id(), s.project().id(), d.id(), fail.id(), d.lockVersion());
    }
    protected void removeEvidence(Scenario s, Defect d, TestAttempt fail) {
        defects.removeEvidence(s.tester().id(), s.project().id(), d.id(), fail.id(), d.lockVersion());
    }

    /** Controls database recorded_at in the session, never updates an immutable Attempt. */
    protected TestExecutionService executionAtDatabaseTime(String epochSeconds) {
        if (!epochSeconds.matches("[0-9]{10}\\.[0-9]{6}")) throw new IllegalArgumentException("Unsafe timestamp");
        ServiceTransaction timestamped = new ServiceTransaction() {
            @Override public <T> T execute(Work<T> work) {
                return serviceTx.execute(c -> {
                    try (var statement = c.createStatement()) {
                        statement.execute("SET timestamp=" + epochSeconds);
                        try { return work.execute(c); }
                        finally { statement.execute("SET timestamp=0"); }
                    } catch (SQLException e) { throw new AssertionError(e); }
                });
            }
        };
        return new DefaultTestExecutionService(timestamped, jdbcDaos, access, executionClock);
    }

    protected void map(Scenario s) {
        TestAutomationIdentity id = automation.registerIdentity(s.tester().id(), s.project().id(),
                AutomationSource.JUNIT, "r1.SyntheticTest", "case");
        automation.mapIdentity(s.tester().id(), id.id(), s.testCase().id(), null);
    }
    protected ImportTestResultsCommand importCommand(Scenario s, TestAttemptStatus status) {
        String outcome = switch (status) {
            case PASS -> "";
            case FAIL -> "<failure message=\"Synthetic failure\">Synthetic trace</failure>";
            case SKIPPED -> "<skipped/>";
            default -> throw new IllegalArgumentException("Unsupported JUnit fixture status");
        };
        byte[] report = ("<testsuite name=\"r1.SyntheticTest\"><testcase classname=\"r1.SyntheticTest\" name=\"case\">"
                + outcome + "</testcase></testsuite>").getBytes(StandardCharsets.UTF_8);
        return new ImportTestResultsCommand(s.project().id(), UUID.randomUUID(), "r1.SyntheticTest",
                "synthetic.xml", "Synthetic import", "test", "r1", report);
    }

    protected List<TestStepInput> standardSteps() {
        return List.of(new TestStepInput(1, "Action 1", "Expected 1"), new TestStepInput(2, "Action 2", "Expected 2"));
    }

    /** Reflection only decorates DAO interfaces; the domain entry points remain statically typed. */
    protected static ServiceDaos replaceDao(ServiceDaos original, String component, UnaryOperator<Object> replacement) {
        try {
            RecordComponent[] fields = ServiceDaos.class.getRecordComponents();
            Class<?>[] types = Arrays.stream(fields).map(RecordComponent::getType).toArray(Class<?>[]::new);
            Object[] values = new Object[fields.length];
            boolean found = false;
            for (int i = 0; i < fields.length; i++) {
                values[i] = fields[i].getAccessor().invoke(original);
                if (component.equals(fields[i].getName())) { values[i] = replacement.apply(values[i]); found = true; }
            }
            assertTrue(found, "Missing DAO component " + component);
            return ServiceDaos.class.getDeclaredConstructor(types).newInstance(values);
        } catch (ReflectiveOperationException e) { throw new AssertionError(e); }
    }
    protected interface Invocation { Object invoke(Object target, Method method, Object[] args) throws Throwable; }
    protected static Object proxy(Object target, Invocation invocation) {
        return Proxy.newProxyInstance(target.getClass().getClassLoader(), target.getClass().getInterfaces(),
                (p, method, args) -> invocation.invoke(target, method, args));
    }
    protected static Object invoke(Object target, Method method, Object[] args) throws Throwable {
        try { return method.invoke(target, args); }
        catch (InvocationTargetException e) { throw e.getCause(); }
    }

    protected static final class CaseBarrier implements AutoCloseable {
        final CountDownLatch before = new CountDownLatch(1);
        final CountDownLatch locked = new CountDownLatch(1);
        final CountDownLatch release = new CountDownLatch(1);
        final AtomicBoolean intercepted = new AtomicBoolean();
        final boolean pauseAfterLock;
        volatile long connectionId;
        CaseBarrier(boolean pauseAfterLock) { this.pauseAfterLock = pauseAfterLock; }
        ServiceDaoFactory factory(ServiceDaoFactory factory) {
            return c -> {
                try (var st = c.createStatement(); var rows = st.executeQuery("SELECT CONNECTION_ID()")) {
                    assertTrue(rows.next()); connectionId = rows.getLong(1);
                } catch (SQLException e) { throw new AssertionError(e); }
                return replaceDao(factory.create(c), "testCases", target -> proxy(target, (actual, method, args) -> {
                    if (!method.getName().equals("findByIdForUpdate") || !intercepted.compareAndSet(false, true))
                        return invoke(actual, method, args);
                    before.countDown();
                    if (!pauseAfterLock) await(release, "release before common Case lock");
                    Object result = invoke(actual, method, args);
                    locked.countDown();
                    if (pauseAfterLock) await(release, "release after common Case lock");
                    return result;
                }));
            };
        }
        void reachedLock() { await(locked, "service acquired common Case lock"); }
        void reachedBefore() { await(before, "service requested common Case lock"); }
        @Override public void close() { release.countDown(); }
    }
    protected static void await(CountDownLatch latch, String label) {
        try { assertTrue(latch.await(10, TimeUnit.SECONDS), "Timed out: " + label); }
        catch (InterruptedException e) { Thread.currentThread().interrupt(); throw new AssertionError(e); }
    }
    protected void assertBlocked(Future<?> future, CaseBarrier competitor, CaseBarrier owner) throws Exception {
        competitor.reachedBefore();
        assertNotEquals(owner.connectionId, competitor.connectionId, "The race must use two physical MySQL connections");
        long deadline = System.nanoTime() + TimeUnit.SECONDS.toNanos(2);
        boolean observedWaitingSql;
        do {
            observedWaitingSql = tx.inTransaction(c -> {
                try (var statement = c.createStatement(); var rows = statement.executeQuery("SHOW FULL PROCESSLIST")) {
                    while (rows.next()) {
                        String sql = rows.getString("Info");
                        if (rows.getLong("Id") == competitor.connectionId && c.getCatalog().equals(rows.getString("db"))
                                && sql != null && sql.contains("test_cases") && sql.contains("FOR UPDATE")) return true;
                    }
                    return false;
                }
            });
            if (!observedWaitingSql) Thread.sleep(10);
        } while (!observedWaitingSql && System.nanoTime() < deadline);
        assertTrue(observedWaitingSql, "The competing physical MySQL connection must be executing its Case FOR UPDATE query");
        assertThrows(TimeoutException.class, () -> future.get(200, TimeUnit.MILLISECONDS));
        assertEquals(1, competitor.locked.getCount(), "Competing writer must wait for the held Case row lock");
        observedLockRaces.add(Map.of("test", activeTestName, "ownerConnectionId", owner.connectionId,
                "competitorConnectionId", competitor.connectionId, "observedCaseForUpdateSql", true,
                "competitorBlockedBeforeOwnerReleased", true));
    }

    protected record Scenario(User admin, User tester, User developer, Project project, TestCase testCase) { }
    protected record Run(TestRun run, TestRunCase runCase) { }
}
