package io.github.lz007001cn.veriqra.integration;

import io.github.lz007001cn.veriqra.dao.jdbc.*;
import io.github.lz007001cn.veriqra.exception.DataAccessException;
import io.github.lz007001cn.veriqra.model.*;
import io.github.lz007001cn.veriqra.service.*;
import io.github.lz007001cn.veriqra.service.command.*;
import io.github.lz007001cn.veriqra.service.exception.*;
import io.github.lz007001cn.veriqra.service.importing.*;
import org.junit.jupiter.api.Test;
import java.nio.charset.StandardCharsets;
import java.security.*;
import java.util.*;
import java.util.concurrent.*;
import static org.junit.jupiter.api.Assertions.*;

class TestImportServiceIntegrationTest extends ServiceFixture {
    @Test void analyzeReportsMappedAndUnmappedWithoutCreatingOfficialRows() {
        Scenario s = scenario("IMPREVIEW");
        TestCase testCase = readyCase(s.tester(), s.project(), "Mapped", 1);
        map(s, "example.PreviewTest", "mapped", testCase);
        byte[] payload = xml("example.PreviewTest",
                "<testcase classname=\"example.PreviewTest\" name=\"mapped\"/>",
                "<testcase classname=\"example.PreviewTest\" name=\"unknown\"/>",
                "<testcase classname=\"example.PreviewTest\" name=\"unknown-two\"/>");

        ImportPreview preview = imports.analyzeImport(s.developer().id(),
                new AnalyzeTestImportCommand(s.project().id(), "example.PreviewTest", payload));
        assertEquals(1, preview.mappedResults().size());
        assertEquals(List.of("unknown", "unknown-two"), preview.unmappedIdentities().stream()
                .map(AutomationIdentityKey::externalKey).toList());
        assertTrue(preview.invalidEntries().isEmpty());
        assertFalse(preview.readyToImport());
        tx.inTransaction(c -> {
            assertEquals(1, new JdbcTestAutomationIdentityDao(c).listByProject(s.project().id()).size());
            assertTrue(new JdbcTestRunDao(c).listByProject(s.project().id()).isEmpty());
            return null;
        });
    }

    @Test void importCreatesCompletedRunSnapshotsBatchAndAllAttemptOutcomes() throws Exception {
        Scenario s = scenario("IMPSUCCESS");
        String namespace = "example.ImportTest";
        List<String> names = List.of("pass", "failure", "error", "skip");
        for (String name : names) map(s, namespace, name, readyCase(s.tester(), s.project(), name, 2));
        byte[] payload = xml(namespace,
                "<testcase classname=\"example.ImportTest\" name=\"pass\" time=\"0.010\"/>",
                "<testcase classname=\"example.ImportTest\" name=\"failure\"><failure message=\"bad\">trace</failure></testcase>",
                "<testcase classname=\"example.ImportTest\" name=\"error\"><error message=\"boom\">stack</error></testcase>",
                "<testcase classname=\"example.ImportTest\" name=\"skip\"><skipped message=\"disabled\"/></testcase>");
        UUID request = UUID.randomUUID();
        ImportTestResultsCommand command = command(s, request, namespace, payload);
        assertTrue(imports.analyzeImport(s.tester().id(),
                new AnalyzeTestImportCommand(s.project().id(), namespace, payload)).readyToImport());

        ImportExecutionResult result = imports.importReport(s.tester().id(), command);
        assertFalse(result.replayed());
        assertEquals(TestRunStatus.COMPLETED, result.testRun().status());
        assertNull(result.testRun().testPlanId());
        assertEquals(4, result.runCases().size());
        assertEquals(4, result.attempts().size());
        assertEquals(1, imports.list(s.developer().id(),s.project().id(),null).size());
        assertEquals(1, imports.list(s.developer().id(),s.project().id(),result.testRun().id()).size());
        assertEquals(result.testImport(), imports.get(s.developer().id(),s.project().id(),result.testImport().id(),null).testImport());
        assertEquals(result.testRun(), imports.get(s.developer().id(),s.project().id(),null,request).testRun());
        Scenario other = scenario("IMPOTHER");
        assertThrows(NotFoundException.class,()->imports.get(other.tester().id(),other.project().id(),null,request));
        assertThrows(NotFoundException.class,()->imports.list(other.tester().id(),other.project().id(),result.testRun().id()));
        assertArrayEquals(MessageDigest.getInstance("SHA-256").digest(payload), result.testImport().reportSha256());
        assertEquals(List.of(TestAttemptStatus.PASS, TestAttemptStatus.FAIL, TestAttemptStatus.FAIL,
                        TestAttemptStatus.SKIPPED), result.attempts().stream().map(TestAttempt::status).toList());
        assertTrue(result.attempts().stream().allMatch(value -> value.executedBy() == null
                && Objects.equals(value.importId(), result.testImport().id())
                && value.automationMappingId() != null && value.attemptNo() == 1));
        assertTrue(result.attempts().stream().anyMatch(value -> "disabled".equals(value.comment())));
        assertTrue(result.attempts().stream().filter(value -> value.failureMessage() != null)
                .anyMatch(value -> value.failureMessage().startsWith("[JUnit error]")));
        tx.inTransaction(c -> {
            var steps = new JdbcTestRunCaseStepDao(c);
            assertTrue(result.runCases().stream().allMatch(value -> steps.listByRunCase(value.id()).size() == 2));
            assertEquals(result.testImport(), new JdbcTestImportDao(c).findByRequestKey(request).orElseThrow());
            return null;
        });
    }

    @Test void requestKeyIsBusinessIdempotentAndDifferentRawPayloadConflicts() {
        Scenario s = scenario("IMPIDEMP");
        String namespace = "example.IdempotentTest";
        map(s, namespace, "one", readyCase(s.tester(), s.project(), "One", 1));
        byte[] payload = xml(namespace, "<testcase classname=\"example.IdempotentTest\" name=\"one\"/>");
        UUID request = UUID.randomUUID();
        ImportTestResultsCommand command = command(s, request, namespace, payload);
        ImportExecutionResult first = imports.importReport(s.tester().id(), command);
        ImportExecutionResult replay = imports.importReport(s.tester().id(), command);
        assertTrue(replay.replayed());
        assertEquals(first.testImport(), replay.testImport());
        assertEquals(first.testRun(), replay.testRun());
        assertEquals(first.attempts(), replay.attempts());
        byte[] differentRawPayload = (new String(payload, StandardCharsets.UTF_8) + "\n")
                .getBytes(StandardCharsets.UTF_8);
        assertThrows(ConflictException.class, () -> imports.importReport(s.tester().id(),
                command(s, request, namespace, differentRawPayload)));
        tx.inTransaction(c -> {
            assertEquals(1, new JdbcTestRunDao(c).listByProject(s.project().id()).size());
            assertEquals(1, new JdbcTestImportDao(c).listByRun(first.testRun().id()).size());
            assertEquals(1, new JdbcTestAttemptDao(c).listByImport(first.testImport().id()).size());
            return null;
        });
    }

    @Test void concurrentEquivalentRequestCreatesExactlyOneImportAndRun() throws Exception {
        Scenario s = scenario("IMPCONCUR");
        String namespace = "example.ConcurrentImport";
        map(s, namespace, "one", readyCase(s.tester(), s.project(), "One", 1));
        byte[] payload = xml(namespace, "<testcase classname=\"example.ConcurrentImport\" name=\"one\"/>");
        ImportTestResultsCommand command = command(s, UUID.randomUUID(), namespace, payload);
        ExecutorService executor = Executors.newFixedThreadPool(2);
        CountDownLatch start = new CountDownLatch(1);
        try {
            List<Future<ImportExecutionResult>> futures = List.of(
                    executor.submit(() -> { start.await(); return imports.importReport(s.tester().id(), command); }),
                    executor.submit(() -> { start.await(); return imports.importReport(s.tester().id(), command); }));
            start.countDown();
            ImportExecutionResult first = futures.get(0).get(15, TimeUnit.SECONDS);
            ImportExecutionResult second = futures.get(1).get(15, TimeUnit.SECONDS);
            assertEquals(first.testImport().id(), second.testImport().id());
            assertEquals(first.testRun().id(), second.testRun().id());
            assertEquals(1, List.of(first, second).stream().filter(ImportExecutionResult::replayed).count());
            tx.inTransaction(c -> {
                assertEquals(1, new JdbcTestRunDao(c).listByProject(s.project().id()).size());
                assertEquals(1, new JdbcTestAttemptDao(c).listByImport(first.testImport().id()).size());
                return null;
            });
        } finally {
            executor.shutdownNow();
        }
    }

    @Test void multipleImplementationsForOneCaseAreRejectedAndHistoryPreventsRebind() {
        Scenario s = scenario("IMPHISTORY");
        String namespace = "example.HistoryTest";
        TestCase original = readyCase(s.tester(), s.project(), "Original", 1);
        TestCase other = readyCase(s.tester(), s.project(), "Other", 1);
        TestAutomationMapping first = map(s, namespace, "one", original);
        map(s, namespace, "two", original);
        byte[] duplicateCase = xml(namespace,
                "<testcase classname=\"example.HistoryTest\" name=\"one\"/>",
                "<testcase classname=\"example.HistoryTest\" name=\"two\"/>");
        ImportPreview preview = imports.analyzeImport(s.tester().id(),
                new AnalyzeTestImportCommand(s.project().id(), namespace, duplicateCase));
        assertFalse(preview.invalidEntries().isEmpty());
        assertThrows(ConflictException.class,
                () -> imports.importReport(s.tester().id(), command(s, UUID.randomUUID(), namespace, duplicateCase)));

        byte[] single = xml(namespace, "<testcase classname=\"example.HistoryTest\" name=\"one\"/>");
        ImportExecutionResult imported = imports.importReport(s.tester().id(),
                command(s, UUID.randomUUID(), namespace, single));
        TestRunCase snapshot = imported.runCases().getFirst();
        TestAutomationMapping inactive = automation.deactivateMapping(s.tester().id(), first.automationIdentityId(),
                first.lockVersion());
        assertThrows(ConflictException.class, () -> automation.mapIdentity(s.tester().id(),
                first.automationIdentityId(), other.id(), inactive.lockVersion()));

        TestCase changed = testCases.update(s.tester().id(), new UpdateTestCaseCommand(original.id(), "Changed",
                original.description(), original.preconditions(), original.priority(), TestCaseStatus.READY,
                original.lockVersion(), List.of(new TestStepInput(1, "changed action", "changed expected"))));
        assertEquals("Changed", changed.title());
        tx.inTransaction(c -> {
            assertEquals(snapshot, new JdbcTestRunCaseDao(c).findById(snapshot.id()).orElseThrow());
            assertEquals("Original", snapshot.snapshotTitle());
            assertEquals(first.id(), new JdbcTestAttemptDao(c).listByImport(imported.testImport().id())
                    .getFirst().automationMappingId());
            return null;
        });
    }

    @Test void attemptFailureRollsBackRunSnapshotsBatchAndEarlierAttempt() {
        Scenario s = scenario("IMPROLLBACK");
        String namespace = "example.RollbackTest";
        map(s, namespace, "one", readyCase(s.tester(), s.project(), "One", 1));
        byte[] payload = xml(namespace, "<testcase classname=\"example.RollbackTest\" name=\"one\"><failure>bad</failure></testcase>");
        UUID request = UUID.randomUUID();
        var failingFactory = (io.github.lz007001cn.veriqra.service.support.ServiceDaoFactory) connection -> {
            var d = jdbcDaos.create(connection);
            var failing = new ServiceDaoDelegates.AttemptDelegate(d.attempts()) {
                @Override public TestAttempt insert(TestAttempt value) {
                    target.insert(value);
                    throw new DataAccessException("Injected imported attempt failure");
                }
            };
            return ServiceDaoDelegates.attempts(d, failing);
        };
        var service = new DefaultTestImportService(serviceTx, failingFactory, access, new JUnitXmlParser(), executionClock);
        assertThrows(DataAccessException.class,
                () -> service.importReport(s.tester().id(), command(s, request, namespace, payload)));
        tx.inTransaction(c -> {
            assertTrue(new JdbcTestRunDao(c).listByProject(s.project().id()).isEmpty());
            assertTrue(new JdbcTestImportDao(c).findByRequestKey(request).isEmpty());
            assertTrue(new JdbcTestRunCaseDao(c).listByTestCase(-1L).isEmpty());
            return null;
        });
    }

    @Test void importRequiresTesterAndActiveProjectWhileAnalyzeRemainsReadable() {
        Scenario s = scenario("IMPPERMS");
        String namespace = "example.PermissionImport";
        map(s, namespace, "one", readyCase(s.tester(), s.project(), "One", 1));
        byte[] payload = xml(namespace, "<testcase classname=\"example.PermissionImport\" name=\"one\"/>");
        ImportTestResultsCommand command = command(s, UUID.randomUUID(), namespace, payload);
        assertThrows(ForbiddenException.class, () -> imports.importReport(s.developer().id(), command));
        Project archived = projects.archive(s.admin().id(), s.project().id(), s.project().lockVersion());
        assertTrue(imports.analyzeImport(s.developer().id(),
                new AnalyzeTestImportCommand(archived.id(), namespace, payload)).readyToImport());
        assertThrows(ConflictException.class, () -> imports.importReport(s.tester().id(), command));
    }

    private TestAutomationMapping map(Scenario s, String namespace, String key, TestCase testCase) {
        TestAutomationIdentity identity = automation.registerIdentity(s.tester().id(), s.project().id(),
                AutomationSource.JUNIT, namespace, key);
        return automation.mapIdentity(s.tester().id(), identity.id(), testCase.id(), null);
    }

    private ImportTestResultsCommand command(Scenario s, UUID request, String namespace, byte[] payload) {
        return new ImportTestResultsCommand(s.project().id(), request, namespace, "report.xml",
                "JUnit report", "test", "1.0", payload);
    }

    private static byte[] xml(String namespace, String... testcases) {
        return ("<testsuite name=\"" + namespace + "\">" + String.join("", testcases) + "</testsuite>")
                .getBytes(StandardCharsets.UTF_8);
    }

    private Scenario scenario(String key) {
        String suffix = key.toLowerCase();
        User admin = actor("admin-" + suffix, SystemRole.ADMIN, UserStatus.ACTIVE);
        User tester = actor("tester-" + suffix, SystemRole.USER, UserStatus.ACTIVE);
        User developer = actor("developer-" + suffix, SystemRole.USER, UserStatus.ACTIVE);
        Project project = createProject(admin, key, tester, ProjectRole.TESTER);
        addMember(project, developer, ProjectRole.DEVELOPER, MembershipStatus.ACTIVE);
        return new Scenario(admin, tester, developer, project);
    }

    private record Scenario(User admin, User tester, User developer, Project project) { }
}
