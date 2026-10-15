package io.github.lz007001cn.veriqra.integration;

import io.github.lz007001cn.veriqra.model.*;
import io.github.lz007001cn.veriqra.exception.DataAccessException;
import io.github.lz007001cn.veriqra.service.*;
import io.github.lz007001cn.veriqra.service.command.*;
import io.github.lz007001cn.veriqra.service.exception.*;
import io.github.lz007001cn.veriqra.service.importing.*;
import io.github.lz007001cn.veriqra.service.query.*;
import io.github.lz007001cn.veriqra.service.support.*;
import org.junit.jupiter.api.Test;

import java.sql.SQLException;
import java.util.List;
import java.util.UUID;
import java.util.concurrent.atomic.AtomicInteger;
import java.util.concurrent.*;

import static org.junit.jupiter.api.Assertions.*;

/** Physical MySQL two-connection races. Each barrier wraps the actual common Case UPDATE lock. */
class R1RetestConcurrencyIntegrationTest extends R1ServiceFixture {
    @Test void appendFirstCommitsAndCloseCurrentReadRejectsTheNewFail() throws Exception {
        Prepared p = prepared();
        try (ExecutorService workers = Executors.newFixedThreadPool(2);
             CaseBarrier writer = new CaseBarrier(true); CaseBarrier closer = releasedBarrier()) {
            TestExecutionService appender = execution(writer.factory(jdbcDaos));
            DefectService closeService = defects(closer.factory(jdbcDaos));
            Future<TestAttempt> append = workers.submit(() -> append(appender, p.s(), p.parallel(), TestAttemptStatus.FAIL));
            writer.reachedLock();
            Future<Defect> close = workers.submit(() -> close(closeService, p.s(), p.resolved()));
            assertBlocked(close, closer, writer);
            writer.close();
            TestAttempt failed = append.get(10, TimeUnit.SECONDS);
            assertEquals(TestAttemptStatus.FAIL, failed.status());
            conflict(close, "LATER_NON_PASS");
            assertEquals(p.resolved(), current(p.s(), p.resolved()));
            assertTrue(receipts(p.resolved()).isEmpty());
        }
    }

    @Test void closeFirstCommitsThenAppendIsANewRecurrenceWithoutReceiptMutation() throws Exception {
        Prepared p = prepared();
        try (ExecutorService workers = Executors.newFixedThreadPool(2);
             CaseBarrier closer = new CaseBarrier(true); CaseBarrier writer = releasedBarrier()) {
            DefectService closeService = defects(closer.factory(jdbcDaos));
            TestExecutionService appender = execution(writer.factory(jdbcDaos));
            Future<Defect> close = workers.submit(() -> close(closeService, p.s(), p.resolved()));
            closer.reachedLock();
            Future<TestAttempt> append = workers.submit(() -> append(appender, p.s(), p.parallel(), TestAttemptStatus.FAIL));
            assertBlocked(append, writer, closer);
            closer.close();
            Defect closed = close.get(10, TimeUnit.SECONDS);
            TestAttempt failed = append.get(10, TimeUnit.SECONDS);
            DefectClosureReceipt receipt = receipts(closed).getFirst();
            assertEquals(DefectStatus.CLOSED, closed.status());
            assertTrue(failed.recordedAt().compareTo(p.pass().recordedAt()) > 0);
            assertEquals(p.pass().id(), items(receipt).getFirst().passAttemptId());
            assertEquals(closed, current(p.s(), closed));
            assertEquals(List.of(receipt), receipts(closed));
        }
    }

    @Test void importFirstCommitsAndCloseCannotMissNewRunOrAttemptPhantoms() throws Exception {
        Prepared p = prepared(); map(p.s());
        ImportTestResultsCommand command = importCommand(p.s(), TestAttemptStatus.FAIL);
        try (ExecutorService workers = Executors.newFixedThreadPool(2);
             CaseBarrier writer = new CaseBarrier(true); CaseBarrier closer = releasedBarrier()) {
            TestImportService importer = imports(writer.factory(jdbcDaos));
            DefectService closeService = defects(closer.factory(jdbcDaos));
            Future<ImportExecutionResult> importing = workers.submit(() -> importer.importReport(p.s().tester().id(), command));
            writer.reachedLock();
            Future<Defect> close = workers.submit(() -> close(closeService, p.s(), p.resolved()));
            assertBlocked(close, closer, writer);
            writer.close();
            ImportExecutionResult result = importing.get(10, TimeUnit.SECONDS);
            assertEquals(TestRunStatus.COMPLETED, result.testRun().status());
            assertEquals(TestAttemptStatus.FAIL, result.attempts().getFirst().status());
            conflict(close, "LATER_NON_PASS");
            assertTrue(receipts(p.resolved()).isEmpty());
            assertEquals(p.resolved(), current(p.s(), p.resolved()));
        }
    }

    @Test void closeFirstMakesImportedFailLaterHistoryAndLeavesReceiptUntouched() throws Exception {
        Prepared p = prepared(); map(p.s());
        ImportTestResultsCommand command = importCommand(p.s(), TestAttemptStatus.FAIL);
        try (ExecutorService workers = Executors.newFixedThreadPool(2);
             CaseBarrier closer = new CaseBarrier(true); CaseBarrier writer = releasedBarrier()) {
            DefectService closeService = defects(closer.factory(jdbcDaos));
            TestImportService importer = imports(writer.factory(jdbcDaos));
            Future<Defect> close = workers.submit(() -> close(closeService, p.s(), p.resolved()));
            closer.reachedLock();
            Future<ImportExecutionResult> importing = workers.submit(() -> importer.importReport(p.s().tester().id(), command));
            assertBlocked(importing, writer, closer);
            closer.close();
            Defect closed = close.get(10, TimeUnit.SECONDS);
            ImportExecutionResult result = importing.get(10, TimeUnit.SECONDS);
            DefectClosureReceipt receipt = receipts(closed).getFirst();
            assertEquals(TestAttemptStatus.FAIL, result.attempts().getFirst().status());
            assertNull(result.attempts().getFirst().executedAt());
            assertEquals(p.pass().id(), items(receipt).getFirst().passAttemptId());
            assertEquals(closed, current(p.s(), closed));
            assertEquals(1, receipts(closed).size());
        }
    }

    @Test void twoCloseCommandsWithOneVersionHaveOneWinnerAndOneCompleteReceipt() throws Exception {
        Prepared p = prepared();
        try (ExecutorService workers = Executors.newFixedThreadPool(2);
             CaseBarrier first = new CaseBarrier(true); CaseBarrier second = releasedBarrier()) {
            DefectService winnerService = defects(first.factory(jdbcDaos));
            DefectService loserService = defects(second.factory(jdbcDaos));
            Future<Defect> winner = workers.submit(() -> close(winnerService, p.s(), p.resolved()));
            first.reachedLock();
            Future<Defect> loser = workers.submit(() -> close(loserService, p.s(), p.resolved()));
            assertBlocked(loser, second, first);
            first.close();
            Defect closed = winner.get(10, TimeUnit.SECONDS);
            conflict(loser, "CLOSED_READ_ONLY");
            assertEquals(p.resolved().lockVersion() + 1, closed.lockVersion());
            assertEquals(1, receipts(closed).size());
            assertEquals(1, items(receipts(closed).getFirst()).size());
            assertEquals(p.failure().id(), items(receipts(closed).getFirst()).getFirst().failureAttemptId());
            assertEquals(p.pass().id(), items(receipts(closed).getFirst()).getFirst().passAttemptId());
        }
    }

    @Test void closeEstablishesRepeatableReadBeforeConcurrentImportButUsesFreshLockedContext() throws Exception {
        Prepared p = prepared(); map(p.s());
        ImportTestResultsCommand command = importCommand(p.s(), TestAttemptStatus.FAIL);
        CountDownLatch snapshotEstablished = new CountDownLatch(1);
        ServiceDaoFactory snapshotFactory = c -> {
            try (var st = c.createStatement(); var rows = st.executeQuery("SELECT COUNT(*) FROM test_attempts")) {
                assertTrue(rows.next());
                assertEquals(java.sql.Connection.TRANSACTION_REPEATABLE_READ, c.getTransactionIsolation());
                snapshotEstablished.countDown();
            } catch (SQLException e) { throw new AssertionError(e); }
            return jdbcDaos.create(c);
        };
        try (ExecutorService workers = Executors.newFixedThreadPool(2);
             CaseBarrier closer = new CaseBarrier(false)) {
            DefectService closeService = defects(closer.factory(snapshotFactory));
            Future<Defect> close = workers.submit(() -> close(closeService, p.s(), p.resolved()));
            await(snapshotEstablished, "close Repeatable Read snapshot");
            closer.reachedBefore();
            ImportExecutionResult imported = imports.importReport(p.s().tester().id(), command);
            assertEquals(TestAttemptStatus.FAIL, imported.attempts().getFirst().status());
            closer.close();
            conflict(close, "LATER_NON_PASS");
            assertEquals(p.resolved(), current(p.s(), p.resolved()));
            assertTrue(receipts(p.resolved()).isEmpty(), "Pre-lock consistent reads must never authorize close");
        }
    }

    @Test void linkAndCloseBothOrdersRespectTheCaseMutexAndDefectVersion() throws Exception {
        Prepared linkFirst = prepared();
        LinkRetestCommand command = linkCommand(linkFirst.resolved(), linkFirst.failure(), linkFirst.pass());
        mutationFirst(linkFirst, service -> service.linkRetest(linkFirst.s().tester().id(), linkFirst.s().project().id(), command));
        Defect linked = current(linkFirst.s(), linkFirst.resolved());
        assertEquals(linkFirst.resolved().lockVersion() + 1, linked.lockVersion());
        assertEquals(1, links(linked).size());
        assertTrue(eligibility(linkFirst.s(), linked).canClose());

        Prepared closeFirst = prepared();
        LinkRetestCommand after = linkCommand(closeFirst.resolved(), closeFirst.failure(), closeFirst.pass());
        mutationAfterClose(closeFirst, service -> service.linkRetest(closeFirst.s().tester().id(), closeFirst.s().project().id(), after));
        assertTrue(links(closeFirst.resolved()).isEmpty());
        assertEquals(DefectClosureEvidencePolicy.SAME_RUN_CASE_V1,
                items(receipts(closeFirst.resolved()).getFirst()).getFirst().evidencePolicy());
    }

    @Test void revokeAndCloseBothOrdersKeepSelectionAndReceiptAtomic() throws Exception {
        Prepared revokeFirst = preparedWithExplicitLink();
        DefectRetestLink selected = links(revokeFirst.resolved()).getFirst();
        RevokeRetestCommand revoke = new RevokeRetestCommand(revokeFirst.resolved().id(), selected.id(),
                revokeFirst.resolved().lockVersion(), java.util.UUID.randomUUID(), "Withdraw retest declaration");
        mutationFirst(revokeFirst, service -> service.revokeRetest(revokeFirst.s().tester().id(), revokeFirst.s().project().id(), revoke));
        assertNotNull(links(revokeFirst.resolved()).getFirst().revocation());
        assertFalse(eligibility(revokeFirst.s(), current(revokeFirst.s(), revokeFirst.resolved())).canClose());
        assertTrue(receipts(revokeFirst.resolved()).isEmpty());

        Prepared closeFirst = preparedWithExplicitLink();
        DefectRetestLink retained = links(closeFirst.resolved()).getFirst();
        RevokeRetestCommand forbidden = new RevokeRetestCommand(closeFirst.resolved().id(), retained.id(),
                closeFirst.resolved().lockVersion(), java.util.UUID.randomUUID(), "Withdraw after close");
        mutationAfterClose(closeFirst, service -> service.revokeRetest(closeFirst.s().tester().id(), closeFirst.s().project().id(), forbidden));
        assertNull(links(closeFirst.resolved()).getFirst().revocation());
        assertEquals(retained.id(), items(receipts(closeFirst.resolved()).getFirst()).getFirst().retestLinkId());
    }

    @Test void evidenceAddAndRemoveBothOrdersSerializeWithCloseAndBumpVersion() throws Exception {
        for (boolean remove : List.of(false, true)) {
            Prepared mutationFirst = preparedWithTwoFailures(remove);
            TestAttempt evidence = mutationFirst.failure();
            mutationFirst(mutationFirst, service -> {
                if (remove) service.removeEvidence(mutationFirst.s().tester().id(), mutationFirst.s().project().id(),
                        mutationFirst.resolved().id(), evidence.id(), mutationFirst.resolved().lockVersion());
                else service.addEvidence(mutationFirst.s().tester().id(), mutationFirst.s().project().id(),
                        mutationFirst.resolved().id(), evidence.id(), mutationFirst.resolved().lockVersion());
                return null;
            });
            Defect changed = current(mutationFirst.s(), mutationFirst.resolved());
            assertEquals(mutationFirst.resolved().lockVersion() + 1, changed.lockVersion());
            assertEquals(remove ? 1 : 2, defects.listEvidence(mutationFirst.s().tester().id(), changed.id()).size());
            assertTrue(receipts(changed).isEmpty());

            Prepared closeFirst = preparedWithTwoFailures(remove);
            mutationAfterClose(closeFirst, service -> {
                if (remove) service.removeEvidence(closeFirst.s().tester().id(), closeFirst.s().project().id(),
                        closeFirst.resolved().id(), closeFirst.failure().id(), closeFirst.resolved().lockVersion());
                else service.addEvidence(closeFirst.s().tester().id(), closeFirst.s().project().id(),
                        closeFirst.resolved().id(), closeFirst.failure().id(), closeFirst.resolved().lockVersion());
                return null;
            });
            assertEquals(remove ? 2 : 1, items(receipts(closeFirst.resolved()).getFirst()).size());
            assertEquals(remove ? 2 : 1, defects.listEvidence(closeFirst.s().tester().id(), closeFirst.resolved().id()).size());
        }
    }

    @Test void concurrentExactLinkReplayHasOneInsertionOneVersionAndRecoverableResult() throws Exception {
        Prepared p = prepared(); LinkRetestCommand command = linkCommand(p.resolved(), p.failure(), p.pass());
        try (ExecutorService workers = Executors.newFixedThreadPool(2);
             CaseBarrier first = new CaseBarrier(true); CaseBarrier second = releasedBarrier()) {
            DefectService firstService = defects(first.factory(jdbcDaos));
            DefectService secondService = defects(second.factory(jdbcDaos));
            Future<RetestOperationResult> firstResult = workers.submit(() -> firstService.linkRetest(p.s().tester().id(), p.s().project().id(), command));
            first.reachedLock();
            Future<RetestOperationResult> secondResult = workers.submit(() -> secondService.linkRetest(p.s().tester().id(), p.s().project().id(), command));
            assertBlocked(secondResult, second, first);
            first.close();
            RetestOperationResult committed = firstResult.get(10, TimeUnit.SECONDS);
            RetestOperationResult replay = secondResult.get(10, TimeUnit.SECONDS);
            assertFalse(committed.replayed()); assertTrue(replay.replayed());
            assertEquals(committed.link(), replay.link());
            assertEquals(p.resolved().lockVersion() + 1, current(p.s(), p.resolved()).lockVersion());
            assertEquals(1, links(p.resolved()).size());
            assertEquals(committed.link(), defects.recoverRetestOperation(p.s().tester().id(), p.s().project().id(),
                    p.resolved().id(), command.requestKey(), "LINK").orElseThrow().link());
        }
    }

    @Test void defectCreationWriterAlsoWaitsForTheCommonCaseLockHeldByClose() throws Exception {
        Prepared p = prepared();
        CreateDefectCommand command = new CreateDefectCommand(p.s().project().id(), p.failure().id(),
                "Concurrent independent defect", "Synthetic evidence", DefectSeverity.HIGH, Priority.MEDIUM, p.s().developer().id());
        try (ExecutorService workers = Executors.newFixedThreadPool(2);
             CaseBarrier closer = new CaseBarrier(true); CaseBarrier creator = releasedBarrier()) {
            DefectService closeService = defects(closer.factory(jdbcDaos));
            DefectService creatorService = defects(creator.factory(jdbcDaos));
            Future<Defect> close = workers.submit(() -> close(closeService, p.s(), p.resolved()));
            closer.reachedLock();
            Future<Defect> creating = workers.submit(() -> creatorService.create(p.s().tester().id(), command));
            assertBlocked(creating, creator, closer);
            closer.close();
            Defect closed = close.get(10, TimeUnit.SECONDS);
            Defect created = creating.get(10, TimeUnit.SECONDS);
            assertEquals(DefectStatus.OPEN, created.status());
            assertEquals(p.failure().id(), defects.listEvidence(p.s().tester().id(), created.id()).getFirst().attemptId());
            assertEquals(1, receipts(closed).size());
            assertTrue(receipts(created).isEmpty());
        }
    }

    @Test void reopenWriterWaitsForAppendCaseLockAndRetainsTheEarlierReceipt() throws Exception {
        Prepared p = prepared(); Defect closed = close(p.s(), p.resolved());
        DefectClosureReceipt receipt = receipts(closed).getFirst();
        TestAttempt recurrence = attempt(p.s(), p.original(), TestAttemptStatus.FAIL);
        ReopenDefectCommand command = new ReopenDefectCommand(closed.id(), recurrence.id(), p.s().developer().id(), closed.lockVersion());
        try (ExecutorService workers = Executors.newFixedThreadPool(2);
             CaseBarrier appender = new CaseBarrier(true); CaseBarrier reopener = releasedBarrier()) {
            TestExecutionService appendService = execution(appender.factory(jdbcDaos));
            DefectService reopenService = defects(reopener.factory(jdbcDaos));
            Future<TestAttempt> append = workers.submit(() -> append(appendService, p.s(), p.parallel(), TestAttemptStatus.PASS));
            appender.reachedLock();
            Future<Defect> reopen = workers.submit(() -> reopenService.reopen(p.s().tester().id(), p.s().project().id(), command));
            assertBlocked(reopen, reopener, appender);
            appender.close(); append.get(10, TimeUnit.SECONDS);
            Defect reopened = reopen.get(10, TimeUnit.SECONDS);
            assertEquals(DefectStatus.REOPENED, reopened.status());
            assertEquals(closed.lockVersion() + 1, reopened.lockVersion());
            assertEquals(List.of(receipt), receipts(reopened));
            assertEquals(p.pass().id(), items(receipt).getFirst().passAttemptId());
            assertTrue(defects.listEvidence(p.s().tester().id(), reopened.id()).stream().anyMatch(e -> e.attemptId().equals(recurrence.id())));
        }
    }

    @Test void evidenceRemovalWithEarlierRepeatableReadStillSeesReceiptCreatedBeforeReopen() throws Exception {
        Prepared p = prepared();
        int expectedReopenedVersion = p.resolved().lockVersion() + 2;
        CountDownLatch oldReceiptView = new CountDownLatch(1);
        ServiceDaoFactory earlierSnapshot = c -> {
            try (var statement = c.prepareStatement("SELECT COUNT(*) FROM defect_closure_items WHERE defect_id=?")) {
                statement.setLong(1, p.resolved().id());
                try (var rows = statement.executeQuery()) { assertTrue(rows.next()); assertEquals(0, rows.getInt(1)); }
                assertEquals(java.sql.Connection.TRANSACTION_REPEATABLE_READ, c.getTransactionIsolation());
                oldReceiptView.countDown();
            } catch (SQLException e) { throw new AssertionError(e); }
            return jdbcDaos.create(c);
        };
        try (ExecutorService workers = Executors.newFixedThreadPool(2);
             CaseBarrier remover = new CaseBarrier(false); CaseBarrier closer = releasedBarrier()) {
            DefectService removeService = defects(remover.factory(earlierSnapshot));
            DefectService closeService = defects(closer.factory(jdbcDaos));
            Future<?> removing = workers.submit(() -> {
                removeService.removeEvidence(p.s().tester().id(), p.s().project().id(), p.resolved().id(),
                        p.failure().id(), expectedReopenedVersion);
                return null;
            });
            await(oldReceiptView, "older RR receipt view without any closure item");
            remover.reachedBefore();
            Defect closed = close(closeService, p.s(), p.resolved());
            assertNotEquals(remover.connectionId, closer.connectionId, "Receipt must commit on a distinct MySQL connection");
            DefectClosureReceipt receipt = receipts(closed).getFirst();
            TestAttempt recurrence = attempt(p.s(), p.original(), TestAttemptStatus.FAIL);
            Defect reopened = defects.reopen(p.s().tester().id(), p.s().project().id(),
                    new ReopenDefectCommand(closed.id(), recurrence.id(), p.s().developer().id(), closed.lockVersion()));
            assertEquals(expectedReopenedVersion, reopened.lockVersion());
            remover.close();
            conflict(removing, "EVIDENCE_RETAINED");
            assertEquals(reopened, current(p.s(), reopened));
            assertEquals(List.of(receipt), receipts(reopened));
            assertEquals(p.failure().id(), items(receipt).getFirst().failureAttemptId());
            assertEquals(2, defects.listEvidence(p.s().tester().id(), reopened.id()).size());
        }
    }

    @Test void knownRequestKeysAcrossDefectsAndActionsRejectWithoutChangingEitherHistory() {
        Prepared first = prepared(); Prepared second = prepared();
        LinkRetestCommand firstCommand = linkCommand(first.resolved(), first.failure(), first.pass());
        RetestOperationResult firstLink = defects.linkRetest(first.s().tester().id(), first.s().project().id(), firstCommand);
        RetestOperationResult secondLink = link(second.s(), second.resolved(), second.failure(), second.pass());
        Defect firstCurrent = current(first.s(), first.resolved());
        Defect secondCurrent = current(second.s(), second.resolved());
        List<DefectRetestLink> firstHistory = links(firstCurrent), secondHistory = links(secondCurrent);
        rejected("REQUEST_KEY_CONFLICT", () -> defects.linkRetest(second.s().tester().id(), second.s().project().id(),
                new LinkRetestCommand(secondCurrent.id(), second.failure().id(), second.pass().id(), secondCurrent.lockVersion(),
                        firstCommand.requestKey(), "Cross-defect request key collision", DefectRetestTimingBasis.MANUAL_SERVER_RECORD,
                        secondLink.link().id(), "Replace using another defect's LINK key")));
        rejected("REQUEST_KEY_CONFLICT", () -> defects.revokeRetest(second.s().tester().id(), second.s().project().id(),
                new RevokeRetestCommand(secondCurrent.id(), secondLink.link().id(), secondCurrent.lockVersion(),
                        firstCommand.requestKey(), "Revoke using another defect's LINK key")));
        assertEquals(firstCurrent, current(first.s(), firstCurrent));
        assertEquals(secondCurrent, current(second.s(), secondCurrent));
        assertEquals(firstHistory, links(firstCurrent)); assertEquals(secondHistory, links(secondCurrent));
        RevokeRetestCommand revoke = new RevokeRetestCommand(firstCurrent.id(), firstLink.link().id(), firstCurrent.lockVersion(),
                UUID.randomUUID(), "Withdraw first defect's declaration");
        defects.revokeRetest(first.s().tester().id(), first.s().project().id(), revoke);
        Defect firstRevoked = current(first.s(), firstCurrent);
        List<DefectRetestLink> revokedHistory = links(firstRevoked);
        rejected("REQUEST_KEY_CONFLICT", () -> defects.linkRetest(second.s().tester().id(), second.s().project().id(),
                new LinkRetestCommand(secondCurrent.id(), second.failure().id(), second.pass().id(), secondCurrent.lockVersion(),
                        revoke.requestKey(), "Cross-action key collision", DefectRetestTimingBasis.MANUAL_SERVER_RECORD,
                        secondLink.link().id(), "Replace using another defect's REVOKE key")));
        rejected("REQUEST_KEY_CONFLICT", () -> defects.revokeRetest(second.s().tester().id(), second.s().project().id(),
                new RevokeRetestCommand(secondCurrent.id(), secondLink.link().id(), secondCurrent.lockVersion(),
                        revoke.requestKey(), "Revoke using another defect's REVOKE key")));
        assertEquals(firstRevoked, current(first.s(), firstRevoked)); assertEquals(revokedHistory, links(firstRevoked));
        assertEquals(secondCurrent, current(second.s(), secondCurrent)); assertEquals(secondHistory, links(secondCurrent));
        assertTrue(receipts(firstCurrent).isEmpty()); assertTrue(receipts(secondCurrent).isEmpty());
    }

    @Test void deadlockAndTimeoutFailuresRollBackCloseReplacementAndRevocationWithoutRetry() {
        for (int vendor : List.of(1213, 1205)) {
            for (String action : List.of("CLOSE", "REPLACE", "REVOKE")) {
                Prepared p = action.equals("CLOSE") ? prepared() : preparedWithExplicitLink();
                Defect before = current(p.s(), p.resolved()); List<DefectRetestLink> historyBefore = links(before);
                AtomicInteger mutations = new AtomicInteger();
                String component = action.equals("CLOSE") ? "closureItems" : "retestLinks";
                String methodName = action.equals("REVOKE") ? "revoke" : "insert";
                ServiceDaoFactory failureFactory = c -> replaceDao(jdbcDaos.create(c), component, target -> proxy(target,
                        (actual, method, args) -> {
                            Object value = invoke(actual, method, args);
                            if (method.getName().equals(methodName)) {
                                mutations.incrementAndGet();
                                throw new DataAccessException("Injected concurrency outcome", new SQLException("Synthetic concurrency outcome",
                                        vendor == 1213 ? "40001" : "HY000", vendor));
                            }
                            return value;
                        }));
                DefectService failing = defects(failureFactory);
                if (action.equals("CLOSE")) rejected("CONCURRENT_CHANGE", () -> close(failing, p.s(), before));
                else if (action.equals("REVOKE")) rejected("CONCURRENT_CHANGE", () -> failing.revokeRetest(p.s().tester().id(), p.s().project().id(),
                        new RevokeRetestCommand(before.id(), historyBefore.getFirst().id(), before.lockVersion(), UUID.randomUUID(), "Withdraw selection")));
                else {
                    TestAttempt newer = attempt(p.s(), p.parallel(), TestAttemptStatus.PASS);
                    rejected("CONCURRENT_CHANGE", () -> failing.linkRetest(p.s().tester().id(), p.s().project().id(),
                            new LinkRetestCommand(before.id(), p.failure().id(), newer.id(), before.lockVersion(), UUID.randomUUID(),
                                    "Actual new retest", DefectRetestTimingBasis.MANUAL_SERVER_RECORD, historyBefore.getFirst().id(), "Replace old PASS")));
                }
                assertEquals(1, mutations.get(), "The failed mutation must execute exactly once, with no implicit retry");
                assertEquals(before, current(p.s(), before)); assertEquals(historyBefore, links(before)); assertTrue(receipts(before).isEmpty());
                tx.inTransaction(c -> {
                    try (var statement = c.prepareStatement("SELECT COUNT(*) FROM defect_closure_items WHERE defect_id=?")) {
                        statement.setLong(1, before.id());
                        try (var rows = statement.executeQuery()) { assertTrue(rows.next()); assertEquals(0, rows.getInt(1)); }
                    }
                    return null;
                });
            }
        }
    }

    private void mutationFirst(Prepared p, Mutation mutation) throws Exception {
        try (ExecutorService workers = Executors.newFixedThreadPool(2);
             CaseBarrier writer = new CaseBarrier(true); CaseBarrier closer = releasedBarrier()) {
            DefectService writerService = defects(writer.factory(jdbcDaos));
            DefectService closeService = defects(closer.factory(jdbcDaos));
            Future<?> writing = workers.submit(() -> mutation.execute(writerService));
            writer.reachedLock();
            Future<Defect> close = workers.submit(() -> close(closeService, p.s(), p.resolved()));
            assertBlocked(close, closer, writer);
            writer.close(); writing.get(10, TimeUnit.SECONDS);
            conflict(close, "STALE_VERSION");
            assertTrue(receipts(p.resolved()).isEmpty());
        }
    }

    private void mutationAfterClose(Prepared p, Mutation mutation) throws Exception {
        try (ExecutorService workers = Executors.newFixedThreadPool(2);
             CaseBarrier closer = new CaseBarrier(true); CaseBarrier writer = releasedBarrier()) {
            DefectService closeService = defects(closer.factory(jdbcDaos));
            DefectService writerService = defects(writer.factory(jdbcDaos));
            Future<Defect> close = workers.submit(() -> close(closeService, p.s(), p.resolved()));
            closer.reachedLock();
            Future<?> writing = workers.submit(() -> mutation.execute(writerService));
            assertBlocked(writing, writer, closer);
            closer.close(); Defect closed = close.get(10, TimeUnit.SECONDS);
            conflict(writing, "CLOSED_READ_ONLY");
            assertEquals(closed, current(p.s(), closed));
            assertEquals(1, receipts(closed).size());
            assertEquals(receipts(closed).getFirst().evidenceCount(), items(receipts(closed).getFirst()).size());
        }
    }

    private Prepared preparedWithExplicitLink() {
        Scenario s = scenario(); Run original = run(s); Run parallel = run(s);
        TestAttempt fail = attempt(s, original, TestAttemptStatus.FAIL);
        Defect resolved = resolve(s, defect(s, fail));
        testRuns.complete(s.tester().id(), original.run().id(), original.run().lockVersion());
        TestAttempt pass = attempt(s, parallel, TestAttemptStatus.PASS);
        link(s, resolved, fail, pass);
        return new Prepared(s, original, parallel, fail, pass, current(s, resolved));
    }

    /** For add, the second FAIL is not attached yet. For remove, both are already attached. */
    private Prepared preparedWithTwoFailures(boolean attached) {
        Scenario s = scenario(); Run original = run(s); Run parallel = run(s);
        TestAttempt first = attempt(s, original, TestAttemptStatus.FAIL);
        TestAttempt second = attempt(s, original, TestAttemptStatus.FAIL);
        Defect d = defect(s, first);
        if (attached) addEvidence(s, d, second);
        Defect resolved = resolve(s, current(s, d));
        TestAttempt pass = attempt(s, original, TestAttemptStatus.PASS);
        return new Prepared(s, original, parallel, second, pass, resolved);
    }

    @FunctionalInterface private interface Mutation { Object execute(DefectService service); }

    private Prepared prepared() {
        Scenario s = scenario(); Run original = run(s); Run parallel = run(s);
        TestAttempt failure = attempt(s, original, TestAttemptStatus.FAIL);
        Defect resolved = resolve(s, defect(s, failure));
        TestAttempt pass = attempt(s, original, TestAttemptStatus.PASS);
        return new Prepared(s, original, parallel, failure, pass, resolved);
    }
    private static CaseBarrier releasedBarrier() {
        CaseBarrier result = new CaseBarrier(true); result.close(); return result;
    }
    private DefectService defects(ServiceDaoFactory factory) { return new DefaultDefectService(serviceTx, factory, access); }
    private TestExecutionService execution(ServiceDaoFactory factory) {
        return new DefaultTestExecutionService(serviceTx, factory, access, executionClock);
    }
    private TestImportService imports(ServiceDaoFactory factory) {
        return new DefaultTestImportService(serviceTx, factory, access, new JUnitXmlParser(), executionClock);
    }
    private static void conflict(Future<?> future, String reason) throws Exception {
        ExecutionException exception = assertThrows(ExecutionException.class, () -> future.get(10, TimeUnit.SECONDS));
        assertEquals(reason, assertInstanceOf(R1RuleException.class, exception.getCause()).reasonCode());
    }
    private record Prepared(Scenario s, Run original, Run parallel, TestAttempt failure,
                            TestAttempt pass, Defect resolved) { }
}
