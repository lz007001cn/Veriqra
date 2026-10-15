package io.github.lz007001cn.veriqra.integration;

import com.fasterxml.jackson.databind.ObjectMapper;
import io.github.lz007001cn.veriqra.dao.jdbc.JdbcTestAttemptDao;
import io.github.lz007001cn.veriqra.model.*;
import io.github.lz007001cn.veriqra.service.DefaultDefectService;
import io.github.lz007001cn.veriqra.service.command.LinkRetestCommand;
import io.github.lz007001cn.veriqra.service.query.RetestOperationResult;
import io.github.lz007001cn.veriqra.service.support.ServiceDaoFactory;
import org.junit.jupiter.api.Test;

import java.lang.reflect.InvocationTargetException;
import java.lang.reflect.Proxy;
import java.nio.charset.StandardCharsets;
import java.nio.file.*;
import java.sql.*;
import java.time.Instant;
import java.util.*;
import java.util.concurrent.*;
import java.util.concurrent.atomic.AtomicBoolean;

import static org.junit.jupiter.api.Assertions.*;

/** Two physical MySQL connections, synthetic projects; deliberately does not test boundary gaps. */
class R1ForeignProjectLockIntegrationTest extends R1ServiceFixture {
    @Test void foreignInteriorRunXLockDoesNotBlockOtherProjectLinkOrClose() throws Exception {
        String selected = System.getProperty("r1.lock.evidence");
        assertNotNull(selected, "Supply a new -Dr1.lock.evidence path");
        Path output = Path.of(selected).toAbsolutePath().normalize();
        assertFalse(Files.exists(output), "Existing evidence must never be overwritten");
        Map<String, Object> evidence = new LinkedHashMap<>();
        evidence.put("startedAtUtc", Instant.now().toString());
        evidence.put("verdict", "FAIL");
        evidence.put("scope", "Foreign project interior existing Run X lock only; not boundary-gap, insert-contention, or throughput validation");
        Set<Long> workerConnections = ConcurrentHashMap.newKeySet();
        List<String> discoverySql = Collections.synchronizedList(new ArrayList<>());
        AtomicBoolean held = new AtomicBoolean();
        ExecutorService executor = Executors.newSingleThreadExecutor();
        try {
            Scenario target = scenario();
            Scenario foreign = scenario();
            Run original = run(target);                 // target PRIMARY id 1
            Run foreignFirst = run(foreign);             // foreign secondary-range beginning
            Run targetBetween = run(target);
            Run foreignInterior = run(foreign);          // foreign interior PRIMARY id 4
            Run retest = run(target);
            Run foreignLast = run(foreign);              // foreign secondary-range end
            Run targetLast = run(target);
            assertTrue(original.run().id() < foreignFirst.run().id());
            assertTrue(targetBetween.run().id() < foreignInterior.run().id());
            assertTrue(foreignInterior.run().id() < retest.run().id());
            assertTrue(retest.run().id() < foreignLast.run().id());
            assertTrue(foreignLast.run().id() < targetLast.run().id());
            List<TestRun> foreignBefore = testRuns.listByProject(foreign.tester().id(), foreign.project().id());
            assertEquals(List.of(foreignFirst.run(), foreignInterior.run(), foreignLast.run()), foreignBefore);
            TestAttempt failure = attempt(target, original, TestAttemptStatus.FAIL);
            Defect resolved = resolve(target, defect(target, failure));
            TestRun terminal = testRuns.complete(target.tester().id(), original.run().id(), original.run().lockVersion());
            assertEquals(TestRunStatus.COMPLETED, terminal.status());
            TestAttempt pass = attempt(target, retest, TestAttemptStatus.PASS);
            assertTrue(pass.recordedAt().isAfter(failure.recordedAt()));
            List<TestRunCaseStep> originalSteps = testRuns.listSnapshotSteps(target.tester().id(), original.runCase().id());
            List<TestAttemptDefect> originalEvidence = defects.listEvidence(target.tester().id(), resolved.id());
            List<TestRunCaseStep> foreignSteps = testRuns.listSnapshotSteps(foreign.tester().id(), foreignInterior.runCase().id());
            ServiceDaoFactory observedFactory = c -> {
                try (var st = c.createStatement(); var rows = st.executeQuery("SELECT CONNECTION_ID()")) {
                    assertTrue(rows.next()); workerConnections.add(rows.getLong(1));
                } catch (SQLException e) { throw new AssertionError(e); }
                Connection captured = (Connection) Proxy.newProxyInstance(Connection.class.getClassLoader(),
                        new Class<?>[]{Connection.class}, (ignored, method, args) -> {
                            if (method.getName().equals("prepareStatement") && args != null && args[0] instanceof String sql
                                    && sql.contains("FROM test_runs") && sql.contains("WHERE project_id=?")
                                    && sql.endsWith("FOR UPDATE")) discoverySql.add(sql);
                            try { return method.invoke(c, args); }
                            catch (InvocationTargetException e) { throw e.getCause(); }
                        });
                return jdbcDaos.create(captured);
            };
            var observed = new DefaultDefectService(serviceTx, observedFactory, access);
            try (Connection owner = pool.borrow()) {
                owner.setAutoCommit(false);
                long ownerId;
                try (var st = owner.createStatement(); var rows = st.executeQuery("SELECT CONNECTION_ID()")) {
                    assertTrue(rows.next()); ownerId = rows.getLong(1);
                }
                String heldSql = "SELECT id FROM test_runs WHERE id=? FOR UPDATE";
                try (var st = owner.prepareStatement(heldSql)) {
                    st.setLong(1, foreignInterior.run().id());
                    try (var rows = st.executeQuery()) {
                        assertTrue(rows.next()); assertEquals(foreignInterior.run().id(), rows.getLong(1));
                        assertFalse(rows.next());
                    }
                }
                held.set(true);
                evidence.put("foreignLock", Map.of("connectionId", ownerId, "projectId", foreign.project().id(),
                        "runId", foreignInterior.run().id(), "firstRunId", foreignFirst.run().id(),
                        "lastRunId", foreignLast.run().id(), "actualSql", heldSql));
                try {
                    LinkRetestCommand command = linkCommand(resolved, failure, pass);
                    long linkStart = System.nanoTime();
                    Future<RetestOperationResult> linking = executor.submit(() -> observed.linkRetest(target.tester().id(),
                            target.project().id(), command));
                    RetestOperationResult selection = linking.get(5, TimeUnit.SECONDS);
                    long linkElapsed = System.nanoTime() - linkStart;
                    assertTrue(held.get(), "LINK must commit before the foreign transaction releases its X lock");
                    assertTrue(linkElapsed < TimeUnit.SECONDS.toNanos(5));
                    evidence.put("link", Map.of("elapsedNanos", linkElapsed, "completedBeforeForeignRelease", true,
                            "linkId", selection.link().id()));
                    Defect linked = current(target, resolved);
                    assertEquals(resolved.lockVersion() + 1, linked.lockVersion());
                    long closeStart = System.nanoTime();
                    Future<Defect> closing = executor.submit(() -> close(observed, target, linked));
                    Defect closed = closing.get(5, TimeUnit.SECONDS);
                    long closeElapsed = System.nanoTime() - closeStart;
                    assertTrue(held.get(), "CLOSE must commit before the foreign transaction releases its X lock");
                    assertTrue(closeElapsed < TimeUnit.SECONDS.toNanos(5));
                    assertEquals(DefectStatus.CLOSED, closed.status());
                    assertFalse(workerConnections.isEmpty());
                    assertFalse(workerConnections.contains(ownerId), "The foreign owner and target writer must use different physical connections");
                    evidence.put("workerConnectionIds", workerConnections.stream().sorted().toList());
                    evidence.put("close", Map.of("elapsedNanos", closeElapsed, "completedBeforeForeignRelease", true,
                            "defectId", closed.id(), "closedVersion", closed.lockVersion()));
                    assertEquals(2, discoverySql.size(), "Actual LINK and CLOSE must each perform one project current-read discovery");
                    assertEquals(1, discoverySql.stream().distinct().count());
                    evidence.put("runDiscoveryExplain", explain(owner, discoverySql.getFirst(), target.project().id()));
                    assertEquals(terminal, testRuns.get(target.tester().id(), terminal.id()));
                    assertEquals(List.of(original.runCase()), testRuns.listRunCases(target.tester().id(), terminal.id()));
                    assertEquals(originalSteps, testRuns.listSnapshotSteps(target.tester().id(), original.runCase().id()));
                    assertEquals(originalEvidence, defects.listEvidence(target.tester().id(), closed.id()));
                    List<DefectClosureReceipt> closeFacts = receipts(closed);
                    assertEquals(1, closeFacts.size());
                    DefectClosureReceipt receipt = closeFacts.getFirst();
                    List<DefectClosureItem> closeItems = List.of(new DefectClosureItem(receipt.id(), failure.id(), closed.id(),
                            pass.id(), selection.link().id(), DefectClosureEvidencePolicy.EXACT_SEMANTIC_V1));
                    assertEquals(closeItems, items(receipt));
                    tx.inTransaction(c -> {
                        var attempts = new JdbcTestAttemptDao(c);
                        assertEquals(failure, attempts.findById(failure.id()).orElseThrow());
                        assertEquals(pass, attempts.findById(pass.id()).orElseThrow());
                        assertEquals(List.of(failure), attempts.listByRunCase(original.runCase().id()));
                        assertEquals(List.of(pass), attempts.listByRunCase(retest.runCase().id()));
                        return null;
                    });
                    var closureHistory = eligibility(target, closed).history();
                    assertEquals(receipt, closureHistory.getFirst().receipt());
                    assertEquals(failure, closureHistory.getFirst().items().getFirst().failure().attempt());
                    assertEquals(pass, closureHistory.getFirst().items().getFirst().pass().attempt());
                    assertEquals(closeFacts, receipts(closed)); assertEquals(closeItems, items(receipt));
                    assertEquals(foreignBefore, testRuns.listByProject(foreign.tester().id(), foreign.project().id()));
                    assertEquals(foreignSteps, testRuns.listSnapshotSteps(foreign.tester().id(), foreignInterior.runCase().id()));
                    evidence.put("receipt", Map.of("receiptId", receipt.id(), "evidenceCount", receipt.evidenceCount(),
                            "failureAttemptId", failure.id(), "passAttemptId", pass.id(), "linkId", selection.link().id(),
                            "policy", receipt.policyVersion()));
                    evidence.put("preservation", Map.of("terminalRunUnchanged", true, "originalRunCaseUnchanged", true,
                            "originalStepsUnchanged", true, "originalFailureUnchanged", true, "passUnchanged", true,
                            "sourceAssociationUnchanged", true, "receiptAndItemsUnchangedByHistoryReads", true,
                            "foreignRunsAndInteriorSnapshotUnchanged", true));
                } finally {
                    owner.rollback(); held.set(false);
                    evidence.put("foreignReleasedAtUtc", Instant.now().toString());
                }
            }
            evidence.put("verdict", "PASS");
        } finally {
            executor.shutdownNow();
            assertTrue(executor.awaitTermination(10, TimeUnit.SECONDS), "The target worker must finish without leaving a transaction running");
            evidence.put("finishedAtUtc", Instant.now().toString());
            if (output.getParent() != null) Files.createDirectories(output.getParent());
            Files.writeString(output, new ObjectMapper().writerWithDefaultPrettyPrinter().writeValueAsString(evidence),
                    StandardCharsets.UTF_8, StandardOpenOption.CREATE_NEW);
        }
    }

    private static Map<String, Object> explain(Connection c, String sql, Long project) {
        assertTrue(sql.contains("FORCE INDEX (ix_runs_project_created_id)"), "Use the existing project index, without schema changes");
        try (var st = c.prepareStatement("EXPLAIN " + sql)) {
            st.setObject(1, project, Types.BIGINT);
            List<Map<String, Object>> rows = new ArrayList<>();
            try (var rs = st.executeQuery()) {
                while (rs.next()) {
                    Map<String, Object> row = new LinkedHashMap<>();
                    row.put("table", rs.getString("table")); row.put("type", rs.getString("type"));
                    row.put("key", rs.getString("key")); row.put("rows", rs.getLong("rows"));
                    row.put("filtered", rs.getDouble("filtered")); row.put("extra", rs.getString("Extra"));
                    assertEquals("ix_runs_project_created_id", rs.getString("key"));
                    assertTrue(Set.of("ref", "range").contains(rs.getString("type")));
                    rows.add(row);
                }
            }
            assertFalse(rows.isEmpty());
            return Map.of("actualPreparedSql", sql, "boundProjectId", project, "rows", rows);
        } catch (SQLException e) { throw new AssertionError("Actual forced-index EXPLAIN failed", e); }
    }
}
