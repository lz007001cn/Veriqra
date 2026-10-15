package io.github.lz007001cn.veriqra.integration;

import com.fasterxml.jackson.databind.ObjectMapper;
import io.github.lz007001cn.veriqra.dao.jdbc.JdbcTestRunCaseDao;
import io.github.lz007001cn.veriqra.dao.jdbc.JdbcTestRunDao;
import io.github.lz007001cn.veriqra.model.*;
import io.github.lz007001cn.veriqra.service.query.ClosureEligibility;
import io.github.lz007001cn.veriqra.service.query.RetestCandidates;
import io.github.lz007001cn.veriqra.service.query.RetestOperationResult;
import org.junit.jupiter.api.Test;

import java.lang.reflect.InvocationTargetException;
import java.lang.reflect.Proxy;
import java.nio.charset.StandardCharsets;
import java.nio.file.Files;
import java.nio.file.Path;
import java.nio.file.StandardOpenOption;
import java.sql.Connection;
import java.sql.SQLException;
import java.sql.Types;
import java.time.Instant;
import java.util.*;
import java.util.function.Function;
import java.util.function.Supplier;

import static org.junit.jupiter.api.Assertions.*;

/**
 * A bounded, single-client history regression in a fresh identity-guarded isolated schema.
 * It measures the conservative project-wide Run discovery; it is not a throughput benchmark.
 */
class R1HistoryScaleIntegrationTest extends R1ServiceFixture {
    private static final int UNRELATED_RUN_COUNT = 100;
    private static final long OPERATION_LIMIT_NANOS = 5_000_000_000L;
    private final Map<String, Object> evidence = new LinkedHashMap<>();
    private final Map<String, Object> timings = new LinkedHashMap<>();

    @Test void terminalFailureCanCloseWithoutChangingOneHundredUnrelatedRunSnapshots() throws Exception {
        String output = System.getProperty("r1.scale.evidence");
        assertNotNull(output, "Supply a new -Dr1.scale.evidence path to retain this isolated result");
        assertFalse(output.isBlank(), "The evidence path must not be blank");
        Path evidencePath = Path.of(output).toAbsolutePath().normalize();
        assertFalse(Files.exists(evidencePath), "A historical result must never be overwritten");
        evidence.put("startedAtUtc", Instant.now().toString());
        evidence.put("purpose", "Bounded synthetic history regression; not production throughput validation");
        evidence.put("unrelatedRunCount", UNRELATED_RUN_COUNT);
        evidence.put("perOperationLimitMillis", OPERATION_LIMIT_NANOS / 1_000_000L);
        evidence.put("timings", timings);
        evidence.put("verdict", "FAIL");

        try {
            Scenario s = scenario();
            evidence.put("projectId", s.project().id());
            List<FrozenRun> unrelated = new ArrayList<>();
            for (int i = 0; i < UNRELATED_RUN_COUNT; i++) {
                TestCase other = readyCase(s.tester(), s.project(), "Unrelated historical case " + i,
                        "Synthetic history retained independently", "Synthetic prerequisite", Priority.MEDIUM,
                        standardSteps());
                assertNotEquals(s.testCase().id(), other.id());
                assertEquals(TestCaseStatus.READY, other.status());
                Run otherRun = run(s, other);
                List<TestRunCaseStep> frozen = testRuns.listSnapshotSteps(s.tester().id(), otherRun.runCase().id());
                assertEquals(2, frozen.size());
                unrelated.add(new FrozenRun(other, otherRun, frozen));
            }
            assertEquals(UNRELATED_RUN_COUNT, unrelated.stream().map(x -> x.testCase().id()).distinct().count());

            Run original = run(s);
            TestAttempt fail = attempt(s, original, TestAttemptStatus.FAIL);
            Defect resolved = resolve(s, defect(s, fail));
            TestRun completed = testRuns.complete(s.tester().id(), original.run().id(), original.run().lockVersion());
            assertEquals(TestRunStatus.COMPLETED, completed.status());
            List<TestRunCaseStep> originalSteps = testRuns.listSnapshotSteps(s.tester().id(), original.runCase().id());
            List<TestAttemptDefect> originalEvidence = defects.listEvidence(s.tester().id(), resolved.id());
            Run retest = run(s);
            TestAttempt pass = attempt(s, retest, TestAttemptStatus.PASS);
            assertTrue(pass.recordedAt().isAfter(fail.recordedAt()), "Cross-Run retest must be strictly later");
            List<TestRunCaseStep> retestSteps = testRuns.listSnapshotSteps(s.tester().id(), retest.runCase().id());

            Map<String, Long> before = tableCounts();
            assertEquals(35, before.size());
            assertEquals((long) UNRELATED_RUN_COUNT + 1, before.get("test_cases"));
            assertEquals((long) UNRELATED_RUN_COUNT + 2, before.get("test_runs"));
            assertEquals((long) UNRELATED_RUN_COUNT + 2, before.get("test_run_cases"));
            assertEquals(((long) UNRELATED_RUN_COUNT + 2) * 2, before.get("test_run_case_steps"));
            assertEquals(2L, before.get("test_attempts"));
            evidence.put("tableCountsBefore", before);
            evidence.put("queryPlans", explainActualDaoQueries(s, original));

            RetestCandidates candidates = measured("candidates", () -> defects.retestCandidates(s.tester().id(),
                    s.project().id(), resolved.id(), fail.id(), null, 20));
            assertEquals(1, candidates.candidates().size());
            assertEquals(pass.id(), candidates.candidates().getFirst().execution().attempt().id());
            assertTrue(candidates.candidates().getFirst().eligible());
            assertNull(candidates.nextCursor());
            ClosureEligibility beforeSelection = measured("eligibilityBeforeLink", () -> eligibility(s, resolved));
            assertFalse(beforeSelection.canClose(), "A later PASS in another Run must not be selected implicitly");
            assertEquals(List.of("MISSING_RETEST"), beforeSelection.failures().getFirst().reasons());
            assertFalse(beforeSelection.failures().getFirst().canRetestOriginal());
            assertEquals(before, tableCounts(), "Candidate and eligibility GET projections must not write");

            RetestOperationResult selection = measured("link", () -> link(s, resolved, fail, pass));
            Defect linked = current(s, resolved);
            assertEquals(resolved.lockVersion() + 1, linked.lockVersion());
            ClosureEligibility ready = measured("eligibilityAfterLink", () -> eligibility(s, linked));
            assertTrue(ready.canClose());
            assertEquals(selection.link().id(), ready.failures().getFirst().selection().id());
            Defect closed = measured("close", () -> close(s, linked));
            assertEquals(DefectStatus.CLOSED, closed.status());
            assertEquals(linked.lockVersion() + 1, closed.lockVersion());

            List<DefectClosureReceipt> actualReceipts = receipts(closed);
            assertEquals(1, actualReceipts.size());
            DefectClosureReceipt receipt = actualReceipts.getFirst();
            assertEquals(1, receipt.evidenceCount());
            assertEquals(closed.lockVersion(), receipt.closedDefectVersion());
            assertEquals(s.tester().id(), receipt.closedBy());
            assertEquals(DefectClosureReceipt.POLICY, receipt.policyVersion());
            assertEquals(resolved.resolutionNote(), receipt.resolutionNote());
            List<DefectClosureItem> expectedItems = List.of(new DefectClosureItem(receipt.id(), fail.id(),
                    closed.id(), pass.id(), selection.link().id(), DefectClosureEvidencePolicy.EXACT_SEMANTIC_V1));
            assertEquals(expectedItems, items(receipt));
            List<DefectRetestLink> actualLinks = links(closed);
            assertEquals(1, actualLinks.size());
            assertNull(actualLinks.getFirst().revocation());

            Map<String, Long> after = tableCounts();
            Map<String, Long> expectedCounts = new LinkedHashMap<>(before);
            for (String added : List.of("defect_retest_links", "defect_closure_receipts", "defect_closure_items"))
                expectedCounts.put(added, before.get(added) + 1);
            assertEquals(expectedCounts, after, "Only one link, receipt and receipt item may be added");
            evidence.put("tableCountsAfter", after);
            Map<String, Long> delta = new LinkedHashMap<>();
            before.forEach((table, count) -> delta.put(table, after.get(table) - count));
            evidence.put("tableCountDelta", delta);

            assertEquals(completed, testRuns.get(s.tester().id(), completed.id()));
            assertEquals(List.of(original.runCase()), testRuns.listRunCases(s.tester().id(), completed.id()));
            assertEquals(originalSteps, testRuns.listSnapshotSteps(s.tester().id(), original.runCase().id()));
            assertEquals(retest.run(), testRuns.get(s.tester().id(), retest.run().id()));
            assertEquals(List.of(retest.runCase()), testRuns.listRunCases(s.tester().id(), retest.run().id()));
            assertEquals(retestSteps, testRuns.listSnapshotSteps(s.tester().id(), retest.runCase().id()));
            assertEquals(originalEvidence, defects.listEvidence(s.tester().id(), closed.id()));
            tx.inTransaction(c -> {
                var attempts = new io.github.lz007001cn.veriqra.dao.jdbc.JdbcTestAttemptDao(c);
                assertEquals(fail, attempts.findById(fail.id()).orElseThrow());
                assertEquals(pass, attempts.findById(pass.id()).orElseThrow());
                assertEquals(List.of(fail), attempts.listByRunCase(original.runCase().id()));
                assertEquals(List.of(pass), attempts.listByRunCase(retest.runCase().id()));
                return null;
            });
            for (FrozenRun frozen : unrelated) {
                assertEquals(frozen.testCase(), testCases.get(s.tester().id(), frozen.testCase().id()));
                assertEquals(frozen.run().run(), testRuns.get(s.tester().id(), frozen.run().run().id()));
                assertEquals(List.of(frozen.run().runCase()),
                        testRuns.listRunCases(s.tester().id(), frozen.run().run().id()));
                assertEquals(frozen.steps(), testRuns.listSnapshotSteps(s.tester().id(), frozen.run().runCase().id()));
            }
            ClosureEligibility history = measured("eligibilityAfterClose", () -> eligibility(s, closed));
            assertFalse(history.legacyClosed());
            assertEquals(receipt, history.history().getFirst().receipt());
            assertEquals(fail, history.history().getFirst().items().getFirst().failure().attempt());
            assertEquals(pass, history.history().getFirst().items().getFirst().pass().attempt());
            assertEquals(actualReceipts, receipts(closed));
            assertEquals(expectedItems, items(receipt));
            assertEquals(actualLinks, links(closed));
            assertEquals(after, tableCounts(), "All preservation and history reads must leave counts unchanged");

            evidence.put("target", Map.of("completedRunId", completed.id(), "failureAttemptId", fail.id(),
                    "retestRunId", retest.run().id(), "passAttemptId", pass.id(), "defectId", closed.id(),
                    "linkId", selection.link().id(), "receiptId", receipt.id()));
            evidence.put("preservation", Map.of("unrelatedCases", UNRELATED_RUN_COUNT,
                    "unrelatedRuns", UNRELATED_RUN_COUNT, "unrelatedRunCases", UNRELATED_RUN_COUNT,
                    "unrelatedFrozenSteps", UNRELATED_RUN_COUNT * 2, "originalFailureUnchanged", true,
                    "passUnchanged", true, "originalEvidenceAssociationUnchanged", true,
                    "terminalSourceNotReopened", true, "receiptUnchangedByHistoryReads", true));
            evidence.put("verdict", "PASS");
        } finally {
            evidence.put("finishedAtUtc", Instant.now().toString());
            if (evidencePath.getParent() != null) Files.createDirectories(evidencePath.getParent());
            Files.writeString(evidencePath, new ObjectMapper().writerWithDefaultPrettyPrinter()
                    .writeValueAsString(evidence), StandardCharsets.UTF_8, StandardOpenOption.CREATE_NEW);
        }
    }

    private <T> T measured(String operation, Supplier<T> work) {
        long start = System.nanoTime();
        T result;
        try { result = work.get(); }
        finally {
            long elapsed = System.nanoTime() - start;
            timings.put(operation, Map.of("elapsedNanos", elapsed, "elapsedMillis", elapsed / 1_000_000.0,
                    "underFiveSeconds", elapsed < OPERATION_LIMIT_NANOS));
        }
        long elapsed = ((Number) ((Map<?, ?>) timings.get(operation)).get("elapsedNanos")).longValue();
        assertTrue(elapsed < OPERATION_LIMIT_NANOS, operation + " exceeds the bounded 5 second regression limit");
        return result;
    }

    private Map<String, Long> tableCounts() {
        return tx.inTransaction(c -> {
            try {
                List<String> tables = new ArrayList<>();
                try (var s = c.prepareStatement("SELECT table_name FROM information_schema.tables "
                        + "WHERE table_schema=? AND table_type='BASE TABLE' ORDER BY table_name")) {
                    s.setString(1, c.getCatalog());
                    try (var rows = s.executeQuery()) { while (rows.next()) tables.add(rows.getString(1)); }
                }
                Map<String, Long> result = new LinkedHashMap<>();
                for (String table : tables) {
                    assertTrue(table.matches("[a-z][a-z0-9_]*"), "Only the guarded schema's simple table names are allowed");
                    try (var s = c.createStatement(); var rows = s.executeQuery("SELECT COUNT(*) FROM `" + table + "`")) {
                        assertTrue(rows.next()); result.put(table, rows.getLong(1));
                    }
                }
                return result;
            } catch (SQLException e) { throw new AssertionError("Could not count the isolated schema", e); }
        });
    }

    private List<Map<String, Object>> explainActualDaoQueries(Scenario s, Run original) {
        return tx.inTransaction(c -> {
            List<Map<String, Object>> plans = new ArrayList<>();
            plans.add(explainCaptured(c, "JdbcTestRunDao.listByProject", s.project().id(),
                    capture -> new JdbcTestRunDao(capture).listByProject(s.project().id())));
            plans.add(explainCaptured(c, "JdbcTestRunCaseDao.listByRun", original.run().id(),
                    capture -> new JdbcTestRunCaseDao(capture).listByRun(original.run().id())));
            // Also retain the exact current-read forms used by LINK/CLOSE; no schema/index alteration.
            plans.add(explainCaptured(c, "JdbcTestRunDao.listByProjectForUpdate", s.project().id(),
                    capture -> new JdbcTestRunDao(capture).listByProjectForUpdate(s.project().id())));
            plans.add(explainCaptured(c, "JdbcTestRunCaseDao.listByRunForUpdate", original.run().id(),
                    capture -> new JdbcTestRunCaseDao(capture).listByRunForUpdate(original.run().id())));
            return plans;
        });
    }

    /** Capture the actual DAO prepareStatement SQL instead of duplicating its SELECT projection. */
    private static Map<String, Object> explainCaptured(Connection c, String method, Long parameter,
                                                       Function<Connection, ?> query) {
        List<String> preparedSql = new ArrayList<>();
        Connection capture = (Connection) Proxy.newProxyInstance(Connection.class.getClassLoader(),
                new Class<?>[]{Connection.class}, (ignored, called, args) -> {
                    if (called.getName().equals("prepareStatement") && args != null && args[0] instanceof String sql)
                        preparedSql.add(sql);
                    try { return called.invoke(c, args); }
                    catch (InvocationTargetException e) { throw e.getCause(); }
                });
        query.apply(capture);
        assertEquals(1, preparedSql.size(), "The selected DAO list method must issue one exact query");
        String sql = preparedSql.getFirst();
        assertTrue(sql.startsWith("SELECT "));
        try (var st = c.prepareStatement("EXPLAIN " + sql)) {
            st.setObject(1, parameter, Types.BIGINT);
            List<Map<String, Object>> rows = new ArrayList<>();
            try (var rs = st.executeQuery()) {
                while (rs.next()) {
                    Map<String, Object> row = new LinkedHashMap<>();
                    row.put("table", rs.getString("table"));
                    row.put("type", rs.getString("type"));
                    row.put("possibleKeys", rs.getString("possible_keys"));
                    row.put("key", rs.getString("key"));
                    row.put("keyLength", rs.getString("key_len"));
                    row.put("rows", rs.getLong("rows"));
                    row.put("filtered", rs.getDouble("filtered"));
                    row.put("extra", rs.getString("Extra"));
                    rows.add(row);
                }
            }
            assertFalse(rows.isEmpty(), "EXPLAIN must return an actual optimizer plan");
            Map<String, Object> plan = new LinkedHashMap<>();
            plan.put("daoMethod", method); plan.put("actualPreparedSql", sql);
            plan.put("boundParameter", parameter); plan.put("explain", rows);
            return plan;
        } catch (SQLException e) { throw new AssertionError("Could not EXPLAIN the actual isolated DAO query", e); }
    }

    private record FrozenRun(TestCase testCase, Run run, List<TestRunCaseStep> steps) {
        private FrozenRun { steps = List.copyOf(steps); }
    }
}
