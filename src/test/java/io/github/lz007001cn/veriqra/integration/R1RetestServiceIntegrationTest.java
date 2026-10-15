package io.github.lz007001cn.veriqra.integration;

import io.github.lz007001cn.veriqra.dao.jdbc.*;
import io.github.lz007001cn.veriqra.exception.DataAccessException;
import io.github.lz007001cn.veriqra.model.*;
import io.github.lz007001cn.veriqra.service.*;
import io.github.lz007001cn.veriqra.service.command.*;
import io.github.lz007001cn.veriqra.service.exception.*;
import io.github.lz007001cn.veriqra.service.query.*;
import io.github.lz007001cn.veriqra.service.support.*;
import org.junit.jupiter.api.Test;

import java.util.*;
import java.util.concurrent.atomic.AtomicInteger;

import static org.junit.jupiter.api.Assertions.*;

class R1RetestServiceIntegrationTest extends R1ServiceFixture {
    @Test void sameRunCaseClosesWithImmutableReceiptAndOriginalFailure() {
        Scenario s = scenario(); Run run = run(s);
        TestAttempt fail = attempt(s, run, TestAttemptStatus.FAIL);
        Defect resolved = resolve(s, defect(s, fail));
        var frozenSteps = testRuns.listSnapshotSteps(s.tester().id(), run.runCase().id());
        TestAttempt pass = attempt(s, run, TestAttemptStatus.PASS);
        Defect closed = close(s, resolved);
        assertEquals(DefectStatus.CLOSED, closed.status());
        assertEquals(resolved.lockVersion() + 1, closed.lockVersion());
        List<DefectClosureReceipt> receipts = receipts(closed);
        assertEquals(1, receipts.size());
        DefectClosureReceipt receipt = receipts.getFirst();
        assertEquals(closed.lockVersion(), receipt.closedDefectVersion());
        assertEquals(s.tester().id(), receipt.closedBy());
        assertEquals(resolved.resolutionNote(), receipt.resolutionNote());
        assertEquals(DefectClosureReceipt.POLICY, receipt.policyVersion());
        assertEquals(1, receipt.evidenceCount());
        assertEquals(List.of(new DefectClosureItem(receipt.id(), fail.id(), closed.id(), pass.id(), null,
                DefectClosureEvidencePolicy.SAME_RUN_CASE_V1)), items(receipt));
        tx.inTransaction(c -> {
            assertEquals(fail, new JdbcTestAttemptDao(c).findById(fail.id()).orElseThrow());
            assertEquals(run.runCase(), new JdbcTestRunCaseDao(c).findById(run.runCase().id()).orElseThrow());
            return null;
        });
        assertEquals(frozenSteps, testRuns.listSnapshotSteps(s.tester().id(), run.runCase().id()));
        assertEquals(List.of(fail.id()), defects.listEvidence(s.tester().id(), closed.id()).stream()
                .map(TestAttemptDefect::attemptId).toList());
        TestAttempt recurrence = attempt(s, run, TestAttemptStatus.FAIL);
        assertEquals(List.of(receipt), receipts(closed), "Later execution cannot rewrite the close-time receipt");
        Defect reopened = defects.reopen(s.tester().id(), new ReopenDefectCommand(closed.id(), recurrence.id(),
                s.developer().id(), closed.lockVersion()));
        assertEquals(DefectStatus.REOPENED, reopened.status());
        assertNull(reopened.resolutionNote());
        assertEquals(List.of(receipt), receipts(reopened));
        assertEquals(pass.id(), items(receipt).getFirst().passAttemptId());
        rejected("EVIDENCE_RETAINED", () -> removeEvidence(s, reopened, fail));
        assertEquals(reopened, current(s, reopened));
    }

    @Test void closureRequiresResolvedStateNonemptyOriginalFailAndLatestPass() {
        Scenario s = scenario(); Run run = run(s);
        TestAttempt fail = attempt(s, run, TestAttemptStatus.FAIL);
        Defect open = defect(s, fail);
        attempt(s, run, TestAttemptStatus.PASS);
        rejected("NOT_RESOLVED", () -> close(s, open));
        Defect resolved = resolve(s, open);
        attempt(s, run, TestAttemptStatus.BLOCKED);
        rejected("MISSING_RETEST", () -> close(s, resolved));
        attempt(s, run, TestAttemptStatus.SKIPPED);
        rejected("MISSING_RETEST", () -> close(s, resolved));
        assertEquals(DefectStatus.RESOLVED, current(s, resolved).status());
        assertTrue(receipts(resolved).isEmpty());
    }

    @Test void everyOriginalFailureNeedsItsOwnSelectionAndReceiptItem() {
        Scenario s = scenario(); Run firstRun = run(s); Run secondRun = run(s);
        TestAttempt first = attempt(s, firstRun, TestAttemptStatus.FAIL);
        TestAttempt second = attempt(s, secondRun, TestAttemptStatus.FAIL);
        Defect d = defect(s, first);
        addEvidence(s, d, second);
        Defect resolved = resolve(s, current(s, d));
        TestAttempt firstPass = attempt(s, firstRun, TestAttemptStatus.PASS);
        rejected("MISSING_RETEST", () -> close(s, resolved));
        TestAttempt secondPass = attempt(s, secondRun, TestAttemptStatus.PASS);
        Defect closed = close(s, resolved);
        DefectClosureReceipt receipt = receipts(closed).getFirst();
        assertEquals(2, receipt.evidenceCount());
        assertEquals(Set.of(first.id(), second.id()), new HashSet<>(items(receipt).stream()
                .map(DefectClosureItem::failureAttemptId).toList()));
        assertEquals(Set.of(firstPass.id(), secondPass.id()), new HashSet<>(items(receipt).stream()
                .map(DefectClosureItem::passAttemptId).toList()));
    }

    @Test void compatibleLaterNonPassIsCheckedAcrossAllHistoryRatherThanOnlyLatest() {
        Scenario s = scenario(); Run original = run(s); Run parallel = run(s);
        TestAttempt fail = attempt(s, original, TestAttemptStatus.FAIL);
        Defect resolved = resolve(s, defect(s, fail));
        attempt(s, original, TestAttemptStatus.PASS);
        attempt(s, parallel, TestAttemptStatus.FAIL);
        attempt(s, parallel, TestAttemptStatus.PASS);
        rejected("LATER_NON_PASS", () -> close(s, resolved));
        assertTrue(receipts(resolved).isEmpty());
        TestAttempt latest = attempt(s, original, TestAttemptStatus.PASS);
        Defect closed = close(s, resolved);
        assertEquals(latest.id(), items(receipts(closed).getFirst()).getFirst().passAttemptId());
    }

    @Test void currentCaseRevisionDoesNotRewriteOrDisqualifyMatchingFrozenSnapshots() {
        Scenario s = scenario(); Run original = run(s);
        TestAttempt fail = attempt(s, original, TestAttemptStatus.FAIL);
        Defect resolved = resolve(s, defect(s, fail));
        TestAttempt pass = attempt(s, original, TestAttemptStatus.PASS);
        revise(s, "Changed current title", "Changed current description", null, Priority.HIGH,
                List.of(new TestStepInput(1, "Changed action", "Changed expected")));
        Defect closed = close(s, resolved);
        assertEquals(pass.id(), items(receipts(closed).getFirst()).getFirst().passAttemptId());
        assertEquals(s.testCase().title(), testRuns.listRunCases(s.tester().id(), original.run().id())
                .getFirst().snapshotTitle());
    }

    @Test void developerCannotCloseAndStaleVersionCannotCreateReceipt() {
        Scenario s = scenario(); Run original = run(s);
        TestAttempt fail = attempt(s, original, TestAttemptStatus.FAIL);
        Defect resolved = resolve(s, defect(s, fail));
        attempt(s, original, TestAttemptStatus.PASS);
        assertThrows(ForbiddenException.class, () -> defects.transition(s.developer().id(), s.project().id(),
                new TransitionDefectCommand(resolved.id(), DefectStatus.CLOSED, null, resolved.lockVersion())));
        Defect changed = defects.update(s.tester().id(), new UpdateDefectCommand(resolved.id(), "Updated title",
                resolved.description(), resolved.severity(), resolved.priority(), resolved.assigneeId(), resolved.lockVersion()));
        rejected("STALE_VERSION", () -> close(s, resolved));
        assertTrue(receipts(resolved).isEmpty());
        assertEquals(changed.lockVersion(), current(s, resolved).lockVersion());
        assertEquals(DefectStatus.CLOSED, close(s, changed).status());
    }

    @Test void midReceiptItemExceptionRollsBackStateReceiptAndEveryEarlierItem() {
        Scenario s = scenario(); Run original = run(s);
        TestAttempt first = attempt(s, original, TestAttemptStatus.FAIL);
        TestAttempt second = attempt(s, original, TestAttemptStatus.FAIL);
        Defect d = defect(s, first);
        addEvidence(s, d, second);
        Defect resolved = resolve(s, current(s, d));
        attempt(s, original, TestAttemptStatus.PASS);
        AtomicInteger inserted = new AtomicInteger();
        ServiceDaoFactory failAfterSecondItem = c -> replaceDao(jdbcDaos.create(c), "closureItems", target ->
                proxy(target, (actual, method, args) -> {
                    Object result = invoke(actual, method, args);
                    if (method.getName().equals("insert") && inserted.incrementAndGet() == 2)
                        throw new DataAccessException("Injected failure after second closure item");
                    return result;
                }));
        DefectService failing = new DefaultDefectService(serviceTx, failAfterSecondItem, access);
        assertThrows(DataAccessException.class, () -> close(failing, s, resolved));
        assertEquals(2, inserted.get(), "Failure must occur after a real second item insertion");
        assertEquals(resolved, current(s, resolved));
        assertTrue(receipts(resolved).isEmpty());
        tx.inTransaction(c -> {
            try (var statement = c.prepareStatement("SELECT COUNT(*) FROM defect_closure_items WHERE defect_id=?")) {
                statement.setLong(1, resolved.id());
                try (var rows = statement.executeQuery()) { assertTrue(rows.next()); assertEquals(0, rows.getInt(1)); }
            }
            return null;
        });
        Defect closed = close(s, resolved);
        assertEquals(2, items(receipts(closed).getFirst()).size());
    }

    @Test void completedAndCancelledOriginalRunsCloseOnlyThroughExplicitCrossRunSelections() {
        for (TestRunStatus status : List.of(TestRunStatus.COMPLETED, TestRunStatus.CANCELLED)) {
            Scenario s = scenario(); Run original = run(s);
            TestAttempt fail = attempt(s, original, TestAttemptStatus.FAIL);
            Defect resolved = resolve(s, defect(s, fail));
            TestRun terminal = status == TestRunStatus.COMPLETED
                    ? testRuns.complete(s.tester().id(), original.run().id(), original.run().lockVersion())
                    : testRuns.cancel(s.tester().id(), original.run().id(), original.run().lockVersion());
            Run retest = run(s); TestAttempt pass = attempt(s, retest, TestAttemptStatus.PASS);
            ClosureEligibility missing = eligibility(s, resolved);
            assertFalse(missing.canClose());
            assertEquals(1, missing.failures().size());
            assertFalse(missing.failures().getFirst().canRetestOriginal());
            assertTrue(missing.failures().getFirst().reasons().contains("MISSING_RETEST"));
            rejected("MISSING_RETEST", () -> close(s, resolved));
            RetestCandidates candidates = defects.retestCandidates(s.tester().id(), s.project().id(),
                    resolved.id(), fail.id(), null, 25);
            assertTrue(candidates.candidates().stream().anyMatch(c -> c.execution().attempt().id().equals(pass.id()) && c.eligible()));
            RetestOperationResult selected = link(s, resolved, fail, pass);
            assertFalse(selected.replayed());
            Defect linked = current(s, resolved);
            assertEquals(resolved.lockVersion() + 1, linked.lockVersion());
            assertEquals(linked.lockVersion(), selected.resultDefectVersion());
            assertTrue(eligibility(s, linked).canClose());
            Defect closed = close(s, linked);
            DefectClosureReceipt receipt = receipts(closed).getFirst();
            assertEquals(List.of(new DefectClosureItem(receipt.id(), fail.id(), closed.id(), pass.id(),
                    selected.link().id(), DefectClosureEvidencePolicy.EXACT_SEMANTIC_V1)), items(receipt));
            assertEquals(terminal, testRuns.get(s.tester().id(), original.run().id()));
            tx.inTransaction(c -> { assertEquals(fail, new JdbcTestAttemptDao(c).findById(fail.id()).orElseThrow()); return null; });
            assertEquals(1, eligibility(s, closed).history().size());
            assertFalse(eligibility(s, closed).legacyClosed());
        }
    }

    @Test void junitFailureToManualAndImportedPassPreservesUnknownExecutionTimesAndRequiresAttestation() {
        for (boolean importedPass : List.of(false, true)) {
            Scenario s = scenario(); map(s);
            ImportTestResultsCommand sourceCommand = importCommand(s, TestAttemptStatus.FAIL);
            var initial = imports.importReport(s.tester().id(), sourceCommand);
            var replay = imports.importReport(s.tester().id(), sourceCommand);
            assertTrue(replay.replayed());
            assertEquals(initial.testRun(), replay.testRun());
            assertEquals(initial.attempts(), replay.attempts());
            TestAttempt fail = initial.attempts().getFirst();
            assertNull(fail.executedAt());
            assertEquals(TestRunStatus.COMPLETED, initial.testRun().status());
            Defect resolved = resolve(s, defect(s, fail));
            TestAttempt pass = importedPass
                    ? imports.importReport(s.tester().id(), importCommand(s, TestAttemptStatus.PASS)).attempts().getFirst()
                    : attempt(s, run(s), TestAttemptStatus.PASS);
            LinkRetestCommand valid = linkCommand(resolved, fail, pass);
            if (importedPass) {
                assertNull(pass.executedAt());
                var candidate = defects.retestCandidates(s.tester().id(), s.project().id(), resolved.id(), fail.id(), null, 25)
                        .candidates().stream().filter(c -> c.execution().attempt().id().equals(pass.id())).findFirst().orElseThrow();
                assertTrue(candidate.requiresImportConfirmation());
                rejected("IMPORT_CONFIRMATION_REQUIRED", () -> defects.linkRetest(s.tester().id(), s.project().id(),
                        new LinkRetestCommand(resolved.id(), fail.id(), pass.id(), resolved.lockVersion(), UUID.randomUUID(),
                                valid.reviewNote(), DefectRetestTimingBasis.MANUAL_SERVER_RECORD, null, null)));
            } else assertNotNull(pass.executedAt());
            assertThrows(ValidationException.class, () -> defects.linkRetest(s.tester().id(), s.project().id(),
                    new LinkRetestCommand(resolved.id(), fail.id(), pass.id(), resolved.lockVersion(), UUID.randomUUID(),
                            " ", valid.timingBasis(), null, null)));
            RetestOperationResult result = defects.linkRetest(s.tester().id(), s.project().id(), valid);
            assertEquals(valid.timingBasis(), result.link().timingBasis());
            assertEquals(valid.reviewNote(), result.link().reviewNote());
            Defect closed = close(s, current(s, resolved));
            assertEquals(fail.id(), items(receipts(closed).getFirst()).getFirst().failureAttemptId());
            assertEquals(pass.id(), items(receipts(closed).getFirst()).getFirst().passAttemptId());
            tx.inTransaction(c -> {
                assertNull(new JdbcTestAttemptDao(c).findById(fail.id()).orElseThrow().executedAt());
                if (importedPass) assertNull(new JdbcTestAttemptDao(c).findById(pass.id()).orElseThrow().executedAt());
                return null;
            });
        }
    }

    @Test void oneActualPassCanCoverSeveralFailuresOnlyThroughIndependentLinks() {
        Scenario s = scenario(); Run original = run(s);
        TestAttempt first = attempt(s, original, TestAttemptStatus.FAIL);
        TestAttempt second = attempt(s, original, TestAttemptStatus.FAIL);
        Defect d = defect(s, first); addEvidence(s, d, second);
        Defect resolved = resolve(s, current(s, d));
        testRuns.complete(s.tester().id(), original.run().id(), original.run().lockVersion());
        TestAttempt pass = attempt(s, run(s), TestAttemptStatus.PASS);
        RetestOperationResult firstLink = link(s, resolved, first, pass);
        Defect oneLinked = current(s, resolved);
        assertFalse(eligibility(s, oneLinked).canClose());
        assertEquals(1, eligibility(s, oneLinked).failures().stream().filter(ClosureEligibility.Failure::eligible).count());
        rejected("MISSING_RETEST", () -> close(s, oneLinked));
        RetestOperationResult secondLink = link(s, oneLinked, second, pass);
        Defect closed = close(s, current(s, oneLinked));
        List<DefectClosureItem> items = items(receipts(closed).getFirst());
        assertEquals(2, items.size());
        assertEquals(Set.of(firstLink.link().id(), secondLink.link().id()), new HashSet<>(items.stream().map(DefectClosureItem::retestLinkId).toList()));
        assertTrue(items.stream().allMatch(item -> item.passAttemptId().equals(pass.id())));
    }

    @Test void exactFrozenSemanticsRejectEveryFieldDifferenceAndNeverUseCaseInsensitiveSqlEquality() {
        for (String variant : List.of("TITLE_CASE", "DESCRIPTION_CASE", "PRECONDITIONS_CASE", "ACTION_CASE",
                "EXPECTED_CASE", "ORDER", "COUNT", "DESCRIPTION_NULL_EMPTY", "PRECONDITIONS_NULL_EMPTY",
                "DESCRIPTION_SPACE", "ACTION_SPACE", "UNICODE_NORMALIZATION")) {
            Scenario s = scenario();
            boolean nullDescription = variant.equals("DESCRIPTION_NULL_EMPTY");
            boolean nullPreconditions = variant.equals("PRECONDITIONS_NULL_EMPTY");
            if (nullDescription || nullPreconditions) revise(s, s.testCase().title(), nullDescription ? null : "Description",
                    nullPreconditions ? null : "Preconditions", Priority.MEDIUM, standardSteps());
            if (variant.equals("UNICODE_NORMALIZATION")) revise(s, s.testCase().title(), "Caf\u00e9",
                    "Preconditions", Priority.MEDIUM, standardSteps());
            Run original = run(s); TestAttempt fail = attempt(s, original, TestAttemptStatus.FAIL);
            Defect resolved = resolve(s, defect(s, fail));
            String title = variant.equals("TITLE_CASE") ? s.testCase().title().toUpperCase(Locale.ROOT) : s.testCase().title();
            String description = switch (variant) {
                case "DESCRIPTION_CASE" -> "description";
                case "DESCRIPTION_SPACE" -> "Description ";
                case "UNICODE_NORMALIZATION" -> "Cafe\u0301";
                default -> nullDescription ? "" : "Description";
            };
            String preconditions = variant.equals("PRECONDITIONS_CASE") ? "preconditions" : nullPreconditions ? "" : "Preconditions";
            List<TestStepInput> steps = switch (variant) {
                case "ACTION_CASE" -> List.of(new TestStepInput(1, "action 1", "Expected 1"), standardSteps().get(1));
                case "ACTION_SPACE" -> List.of(new TestStepInput(1, "Action 1 ", "Expected 1"), standardSteps().get(1));
                case "EXPECTED_CASE" -> List.of(new TestStepInput(1, "Action 1", "expected 1"), standardSteps().get(1));
                case "ORDER" -> List.of(new TestStepInput(1, "Action 2", "Expected 2"), new TestStepInput(2, "Action 1", "Expected 1"));
                case "COUNT" -> List.of(standardSteps().getFirst());
                default -> standardSteps();
            };
            revise(s, title, description, preconditions, Priority.MEDIUM, steps);
            TestAttempt pass = attempt(s, run(s), TestAttemptStatus.PASS);
            LinkRetestCommand command = linkCommand(resolved, fail, pass);
            rejected("DEFINITION_MISMATCH", () -> defects.linkRetest(s.tester().id(), s.project().id(), command));
            assertTrue(links(resolved).isEmpty(), variant);
            assertEquals(resolved, current(s, resolved), variant);
            assertEquals(original.runCase(), tx.inTransaction(c -> new JdbcTestRunCaseDao(c).findById(original.runCase().id()).orElseThrow()));
            var candidate = defects.retestCandidates(s.tester().id(), s.project().id(), resolved.id(), fail.id(), null, 25)
                    .candidates().stream().filter(c -> c.execution().attempt().id().equals(pass.id())).findFirst().orElseThrow();
            assertFalse(candidate.eligible(), variant);
            assertTrue(candidate.reasons().contains("DEFINITION_MISMATCH"), variant);
        }
    }

    @Test void priorityDifferenceAndLaterCurrentCaseChangeDoNotInvalidateMatchingFrozenDefinitions() {
        Scenario s = scenario(); Run original = run(s);
        TestAttempt fail = attempt(s, original, TestAttemptStatus.FAIL);
        Defect resolved = resolve(s, defect(s, fail));
        revise(s, s.testCase().title(), "Description", "Preconditions", Priority.HIGH, standardSteps());
        Run retest = run(s); TestAttempt pass = attempt(s, retest, TestAttemptStatus.PASS);
        assertNotEquals(original.runCase().snapshotPriority(), retest.runCase().snapshotPriority());
        RetestOperationResult linked = link(s, resolved, fail, pass);
        revise(s, "Current changed after both snapshots", "New description", null, Priority.LOW,
                List.of(new TestStepInput(1, "New action", "New expected")));
        assertTrue(eligibility(s, current(s, resolved)).canClose());
        Defect closed = close(s, current(s, resolved));
        assertEquals(linked.link().id(), items(receipts(closed).getFirst()).getFirst().retestLinkId());
        assertEquals(original.runCase(), tx.inTransaction(c -> new JdbcTestRunCaseDao(c).findById(original.runCase().id()).orElseThrow()));
        assertEquals(retest.runCase(), tx.inTransaction(c -> new JdbcTestRunCaseDao(c).findById(retest.runCase().id()).orElseThrow()));
    }

    @Test void crossRunPassRecordedBeforeOrAtFailureIsRejectedButSameCaseUsesAttemptNumber() {
        Scenario old = scenario(); Run prior = run(old); Run source = run(old);
        TestAttempt oldPass = attempt(old, prior, TestAttemptStatus.PASS);
        TestAttempt fail = attempt(old, source, TestAttemptStatus.FAIL);
        Defect resolved = resolve(old, defect(old, fail));
        rejected("RETEST_TOO_OLD", () -> link(old, resolved, fail, oldPass));

        Scenario equal = scenario(); Run first = run(equal); Run second = run(equal);
        TestExecutionService fixedDb = executionAtDatabaseTime("1791936300.123456");
        TestAttempt equalFail = append(fixedDb, equal, first, TestAttemptStatus.FAIL);
        TestAttempt equalPass = append(fixedDb, equal, second, TestAttemptStatus.PASS);
        assertEquals(equalFail.recordedAt(), equalPass.recordedAt(), "The equal-time test must actually have equal DB timestamps");
        Defect equalResolved = resolve(equal, defect(equal, equalFail));
        rejected("RETEST_TOO_OLD", () -> link(equal, equalResolved, equalFail, equalPass));
        TestAttempt sameCasePass = append(fixedDb, equal, first, TestAttemptStatus.PASS);
        assertEquals(equalFail.recordedAt(), sameCasePass.recordedAt());
        Defect closed = close(equal, equalResolved);
        assertEquals(sameCasePass.id(), items(receipts(closed).getFirst()).getFirst().passAttemptId());
    }

    @Test void linkedPassMustRemainLatestAndLaterNonPassRequiresExplicitReplacement() {
        for (TestAttemptStatus nonPass : List.of(TestAttemptStatus.FAIL, TestAttemptStatus.BLOCKED, TestAttemptStatus.SKIPPED)) {
            Scenario s = scenario(); Run original = run(s);
            TestAttempt fail = attempt(s, original, TestAttemptStatus.FAIL);
            Defect resolved = resolve(s, defect(s, fail));
            Run retest = run(s); TestAttempt pass = attempt(s, retest, TestAttemptStatus.PASS);
            RetestOperationResult first = link(s, resolved, fail, pass);
            attempt(s, retest, nonPass);
            Defect linked = current(s, resolved);
            rejected("LATEST_NOT_PASS", () -> close(s, linked));
            TestAttempt newer = attempt(s, retest, TestAttemptStatus.PASS);
            assertFalse(eligibility(s, linked).canClose(), "Later PASS must not silently replace an explicit selection");
            rejected("LATEST_NOT_PASS", () -> close(s, linked));
            LinkRetestCommand replace = new LinkRetestCommand(linked.id(), fail.id(), newer.id(), linked.lockVersion(),
                    UUID.randomUUID(), "Actual retest after the intervening non-PASS", DefectRetestTimingBasis.MANUAL_SERVER_RECORD,
                    first.link().id(), "Select the new current PASS");
            RetestOperationResult replacement = defects.linkRetest(s.tester().id(), s.project().id(), replace);
            assertEquals(first.link().id(), replacement.replacedLinkId());
            assertEquals(DefectStatus.CLOSED, close(s, current(s, linked)).status());
        }
    }

    @Test void exactLinkReplaceAndRevokeReplayRecoverTheirOriginalResultWithoutExtraVersions() {
        Scenario s = scenario(); Run original = run(s);
        TestAttempt fail = attempt(s, original, TestAttemptStatus.FAIL);
        Defect resolved = resolve(s, defect(s, fail));
        Run retest = run(s); TestAttempt pass = attempt(s, retest, TestAttemptStatus.PASS);
        LinkRetestCommand command = linkCommand(resolved, fail, pass);
        RetestOperationResult initial = defects.linkRetest(s.tester().id(), s.project().id(), command);
        RetestOperationResult replay = defects.linkRetest(s.tester().id(), s.project().id(), command);
        assertTrue(replay.replayed()); assertEquals(initial.link(), replay.link());
        assertEquals(initial.resultDefectVersion(), current(s, resolved).lockVersion());
        assertEquals(initial.link(), defects.recoverRetestOperation(s.tester().id(), s.project().id(), resolved.id(), command.requestKey(), "LINK")
                .orElseThrow().link());
        rejected("REQUEST_KEY_CONFLICT", () -> defects.linkRetest(s.tester().id(), s.project().id(),
                new LinkRetestCommand(resolved.id(), fail.id(), pass.id(), resolved.lockVersion(), command.requestKey(),
                        "Different exact request", command.timingBasis(), null, null)));
        rejected("REQUEST_KEY_CONFLICT", () -> defects.linkRetest(s.admin().id(), s.project().id(), command));
        Defect onceLinked = current(s, resolved);
        rejected("REQUEST_KEY_CONFLICT", () -> defects.revokeRetest(s.tester().id(), s.project().id(),
                new RevokeRetestCommand(onceLinked.id(), initial.link().id(), onceLinked.lockVersion(), command.requestKey(),
                        "Attempt to reuse a LINK request key for REVOKE")));

        TestAttempt newer = attempt(s, retest, TestAttemptStatus.PASS);
        Defect linked = current(s, resolved);
        LinkRetestCommand replacement = new LinkRetestCommand(linked.id(), fail.id(), newer.id(), linked.lockVersion(), UUID.randomUUID(),
                "Actual later retest", DefectRetestTimingBasis.MANUAL_SERVER_RECORD, initial.link().id(), "Use newer current PASS");
        RetestOperationResult replaced = defects.linkRetest(s.tester().id(), s.project().id(), replacement);
        assertEquals(linked.lockVersion() + 1, replaced.resultDefectVersion());
        assertEquals(initial.link().id(), replaced.replacedLinkId());
        assertTrue(defects.linkRetest(s.tester().id(), s.project().id(), replacement).replayed());
        List<DefectRetestLink> afterReplace = links(linked);
        assertEquals(2, afterReplace.size());
        DefectRetestLink oldLink = afterReplace.stream().filter(l -> l.id().equals(initial.link().id())).findFirst().orElseThrow();
        assertEquals(DefectRetestRevocationOperation.REPLACE, oldLink.revocation().operation());
        assertEquals(replacement.requestKey(), oldLink.revocation().requestKey());
        assertEquals(initial.link().failureAttemptId(), oldLink.failureAttemptId());
        assertEquals(initial.link().passAttemptId(), oldLink.passAttemptId());
        assertEquals(initial.link().linkedBy(), oldLink.linkedBy());
        assertEquals(initial.link().linkedAt(), oldLink.linkedAt());
        assertEquals(initial.link().reviewNote(), oldLink.reviewNote());
        assertEquals(initial.link().timingBasis(), oldLink.timingBasis());
        assertTrue(defects.recoverRetestOperation(s.tester().id(), s.project().id(), linked.id(), replacement.requestKey(), "REVOKE").isEmpty());

        Defect latest = current(s, linked);
        RevokeRetestCommand revoke = new RevokeRetestCommand(latest.id(), replaced.link().id(), latest.lockVersion(),
                UUID.randomUUID(), "Review declaration was incorrect");
        RetestOperationResult revoked = defects.revokeRetest(s.tester().id(), s.project().id(), revoke);
        assertEquals(latest.lockVersion() + 1, revoked.resultDefectVersion());
        assertEquals(DefectRetestRevocationOperation.REVOKE, revoked.link().revocation().operation());
        assertTrue(defects.revokeRetest(s.tester().id(), s.project().id(), revoke).replayed());
        assertEquals(revoked.resultDefectVersion(), current(s, latest).lockVersion());
        assertEquals(revoked.link(), defects.recoverRetestOperation(s.tester().id(), s.project().id(), latest.id(), revoke.requestKey(), "REVOKE")
                .orElseThrow().link());
        assertTrue(defects.recoverRetestOperation(s.tester().id(), s.project().id(), latest.id(), revoke.requestKey(), "LINK").isEmpty());
        rejected("REQUEST_KEY_CONFLICT", () -> defects.revokeRetest(s.tester().id(), s.project().id(),
                new RevokeRetestCommand(latest.id(), replaced.link().id(), latest.lockVersion(), revoke.requestKey(), "Changed reason")));
        Defect unlinked = current(s, latest);
        rejected("MISSING_RETEST", () -> close(s, unlinked));
        rejected("EVIDENCE_RETAINED", () -> removeEvidence(s, unlinked, fail));
        assertEquals(2, links(unlinked).size());
        assertEquals(2, links(unlinked).stream().filter(l -> l.revocation() != null).count());
        assertTrue(receipts(unlinked).isEmpty());
    }

    @Test void permissionsProjectIdentityVersionsAndClosedMutationBoundariesRemainStrict() {
        Scenario s = scenario(); Run original = run(s); TestAttempt fail = attempt(s, original, TestAttemptStatus.FAIL);
        Defect resolved = resolve(s, defect(s, fail)); TestAttempt pass = attempt(s, run(s), TestAttemptStatus.PASS);
        LinkRetestCommand command = linkCommand(resolved, fail, pass);
        assertThrows(ForbiddenException.class, () -> defects.linkRetest(s.developer().id(), s.project().id(), command));
        User outsider = actor("outsider-" + s.project().id(), SystemRole.USER, UserStatus.ACTIVE);
        assertThrows(ForbiddenException.class, () -> defects.linkRetest(outsider.id(), s.project().id(), command));
        User disabled = actor("disabled-" + s.project().id(), SystemRole.USER, UserStatus.DISABLED);
        addMember(s.project(), disabled, ProjectRole.TESTER, MembershipStatus.ACTIVE);
        assertThrows(ForbiddenException.class, () -> defects.linkRetest(disabled.id(), s.project().id(), command));
        User inactive = actor("inactive-" + s.project().id(), SystemRole.USER, UserStatus.ACTIVE);
        addMember(s.project(), inactive, ProjectRole.TESTER, MembershipStatus.INACTIVE);
        assertThrows(ForbiddenException.class, () -> defects.linkRetest(inactive.id(), s.project().id(), command));
        Scenario other = scenario(); TestAttempt crossProjectPass = attempt(other, run(other), TestAttemptStatus.PASS);
        rejected("CROSS_PROJECT", () -> link(s, resolved, fail, crossProjectPass));
        TestCase sameName = readyCase(s.tester(), s.project(), s.testCase().title(), "Description", "Preconditions", Priority.MEDIUM, standardSteps());
        TestAttempt otherCasePass = attempt(s, run(s, sameName), TestAttemptStatus.PASS);
        rejected("DIFFERENT_TEST_CASE", () -> link(s, resolved, fail, otherCasePass));
        assertThrows(ValidationException.class, () -> defects.closureEligibility(s.admin().id(), other.project().id(), resolved.id()));
        Defect changed = defects.update(s.tester().id(), new UpdateDefectCommand(resolved.id(), "Changed before linking",
                resolved.description(), resolved.severity(), resolved.priority(), resolved.assigneeId(), resolved.lockVersion()));
        rejected("STALE_VERSION", () -> defects.linkRetest(s.tester().id(), s.project().id(), command));
        RetestOperationResult link = link(s, changed, fail, pass);
        Defect linked = current(s, changed);
        rejected("EVIDENCE_RETAINED", () -> removeEvidence(s, linked, fail));
        assertThrows(ForbiddenException.class, () -> defects.revokeRetest(s.developer().id(), s.project().id(),
                new RevokeRetestCommand(linked.id(), link.link().id(), linked.lockVersion(), UUID.randomUUID(), "Not allowed")));
        Defect closed = close(s, linked);
        rejected("CLOSED_READ_ONLY", () -> link(s, closed, fail, pass));
        rejected("CLOSED_READ_ONLY", () -> defects.revokeRetest(s.tester().id(), s.project().id(),
                new RevokeRetestCommand(closed.id(), link.link().id(), closed.lockVersion(), UUID.randomUUID(), "Not allowed after close")));
        assertEquals(1, receipts(closed).size());
    }

    @Test void evidenceAddAndRemoveRequireVersionAndAnEmptyFailureSetNeverCloses() {
        Scenario s = scenario(); Run original = run(s);
        TestAttempt first = attempt(s, original, TestAttemptStatus.FAIL);
        TestAttempt second = attempt(s, original, TestAttemptStatus.FAIL);
        Defect d = defect(s, first);
        addEvidence(s, d, second);
        Defect added = current(s, d);
        assertEquals(d.lockVersion() + 1, added.lockVersion());
        rejected("STALE_VERSION", () -> removeEvidence(s, d, first));
        rejected("STALE_VERSION", () -> addEvidence(s, d, second));
        removeEvidence(s, added, first);
        Defect removed = current(s, added);
        assertEquals(added.lockVersion() + 1, removed.lockVersion());
        removeEvidence(s, removed, second);
        Defect empty = current(s, removed);
        assertTrue(defects.listEvidence(s.tester().id(), empty.id()).isEmpty());
        Defect resolved = resolve(s, empty);
        rejected("NO_FAIL_EVIDENCE", () -> close(s, resolved));
        assertFalse(eligibility(s, resolved).canClose());
        assertTrue(eligibility(s, resolved).reasons().contains("NO_FAIL_EVIDENCE"));
        assertTrue(receipts(resolved).isEmpty());
    }

    @Test void replacementFailureRollsBackRevocationNewLinkAndVersion() {
        Scenario s = scenario(); Run original = run(s); TestAttempt fail = attempt(s, original, TestAttemptStatus.FAIL);
        Defect resolved = resolve(s, defect(s, fail)); Run retest = run(s);
        TestAttempt pass = attempt(s, retest, TestAttemptStatus.PASS);
        RetestOperationResult selected = link(s, resolved, fail, pass);
        Defect linked = current(s, resolved);
        TestAttempt newer = attempt(s, retest, TestAttemptStatus.PASS);
        LinkRetestCommand replacement = new LinkRetestCommand(linked.id(), fail.id(), newer.id(), linked.lockVersion(),
                UUID.randomUUID(), "Later actual retest", DefectRetestTimingBasis.MANUAL_SERVER_RECORD,
                selected.link().id(), "Replace old PASS");
        List<DefectRetestLink> before = links(linked);
        ServiceDaoFactory failingFactory = c -> replaceDao(jdbcDaos.create(c), "retestLinks", target -> proxy(target,
                (actual, method, args) -> {
                    Object result = invoke(actual, method, args);
                    if (method.getName().equals("insert")) throw new DataAccessException("Injected new link insert failure");
                    return result;
                }));
        DefectService failing = new DefaultDefectService(serviceTx, failingFactory, access);
        assertThrows(DataAccessException.class, () -> failing.linkRetest(s.tester().id(), s.project().id(), replacement));
        assertEquals(linked, current(s, linked));
        assertEquals(before, links(linked));
        assertNull(links(linked).getFirst().revocation());
        assertTrue(defects.recoverRetestOperation(s.tester().id(), s.project().id(), linked.id(), replacement.requestKey(), "LINK").isEmpty());
        RetestOperationResult committed = defects.linkRetest(s.tester().id(), s.project().id(), replacement);
        assertFalse(committed.replayed());
        assertEquals(linked.lockVersion() + 1, current(s, linked).lockVersion());
    }

    @Test void gettersPaginationAndRecoveryAreReadOnlyAndRevokedActorsCannotReplay() {
        Scenario s = scenario(); Run original = run(s); TestAttempt fail = attempt(s, original, TestAttemptStatus.FAIL);
        Defect resolved = resolve(s, defect(s, fail));
        List<TestAttempt> passes = new ArrayList<>();
        for (int i = 0; i < 5; i++) passes.add(attempt(s, run(s), TestAttemptStatus.PASS));
        LinkRetestCommand command = linkCommand(resolved, fail, passes.getLast());
        RetestOperationResult selected = defects.linkRetest(s.tester().id(), s.project().id(), command);
        Defect linked = current(s, resolved); List<DefectRetestLink> before = links(linked);
        Set<Long> seen = new HashSet<>(); Long cursor = null;
        do {
            RetestCandidates page = defects.retestCandidates(s.tester().id(), s.project().id(), linked.id(), fail.id(), cursor, 2);
            assertTrue(page.candidates().size() <= 2);
            for (var candidate : page.candidates()) assertTrue(seen.add(candidate.execution().attempt().id()), "Pagination must not repeat candidates");
            cursor = page.nextCursor();
        } while (cursor != null);
        assertTrue(seen.containsAll(passes.stream().map(TestAttempt::id).toList()));
        assertTrue(eligibility(s, linked).canClose());
        assertEquals(selected.link().id(), defects.recoverRetestOperation(s.tester().id(), s.project().id(), linked.id(), command.requestKey(), "LINK")
                .orElseThrow().link().id());
        assertEquals(linked, current(s, linked)); assertEquals(before, links(linked)); assertTrue(receipts(linked).isEmpty());
        tx.inTransaction(c -> {
            var members = new JdbcProjectMemberDao(c); ProjectMember membership = members.find(s.project().id(), s.tester().id()).orElseThrow();
            members.update(new ProjectMember(membership.projectId(), membership.userId(), membership.projectRole(),
                    MembershipStatus.INACTIVE, membership.joinedAt(), membership.updatedAt(), membership.lockVersion()));
            return null;
        });
        assertThrows(ForbiddenException.class, () -> defects.linkRetest(s.tester().id(), s.project().id(), command));
        assertThrows(ForbiddenException.class, () -> defects.recoverRetestOperation(s.tester().id(), s.project().id(), linked.id(), command.requestKey(), "LINK"));
        assertEquals(linked, defects.get(s.admin().id(), linked.id()));
        assertEquals(before, links(linked));
    }

    @Test void sharedFailureAcrossTwoDefectsHasIndependentSelectionsAndReceipts() {
        Scenario s = scenario(); Run original = run(s);
        TestAttempt fail = attempt(s, original, TestAttemptStatus.FAIL);
        Defect first = resolve(s, defect(s, fail));
        Defect second = resolve(s, defect(s, fail));
        testRuns.complete(s.tester().id(), original.run().id(), original.run().lockVersion());
        TestAttempt pass = attempt(s, run(s), TestAttemptStatus.PASS);
        RetestOperationResult firstSelection = link(s, first, fail, pass);
        assertFalse(eligibility(s, second).canClose());
        assertTrue(links(second).isEmpty());
        Defect firstClosed = close(s, current(s, first));
        RetestOperationResult secondSelection = link(s, second, fail, pass);
        assertNotEquals(firstSelection.link().id(), secondSelection.link().id());
        Defect secondClosed = close(s, current(s, second));
        DefectClosureReceipt firstReceipt = receipts(firstClosed).getFirst();
        DefectClosureReceipt secondReceipt = receipts(secondClosed).getFirst();
        assertNotEquals(firstReceipt.id(), secondReceipt.id());
        assertEquals(firstSelection.link().id(), items(firstReceipt).getFirst().retestLinkId());
        assertEquals(secondSelection.link().id(), items(secondReceipt).getFirst().retestLinkId());
        assertEquals(fail.id(), items(firstReceipt).getFirst().failureAttemptId());
        assertEquals(fail.id(), items(secondReceipt).getFirst().failureAttemptId());
    }

    @Test void activeAdminWithoutMembershipCanLinkAndCloseWhileNullSnapshotsCompareExactly() {
        Scenario s = scenario();
        revise(s, s.testCase().title(), null, null, Priority.MEDIUM, standardSteps());
        Run original = run(s); TestAttempt fail = attempt(s, original, TestAttemptStatus.FAIL);
        Defect resolved = resolve(s, defect(s, fail));
        Run retest = run(s); TestAttempt pass = attempt(s, retest, TestAttemptStatus.PASS);
        RetestOperationResult selected = defects.linkRetest(s.admin().id(), s.project().id(), linkCommand(resolved, fail, pass));
        Defect linked = current(s, resolved);
        assertTrue(defects.closureEligibility(s.admin().id(), s.project().id(), linked.id()).canClose());
        Defect closed = defects.transition(s.admin().id(), s.project().id(),
                new TransitionDefectCommand(linked.id(), DefectStatus.CLOSED, null, linked.lockVersion()));
        assertEquals(s.admin().id(), receipts(closed).getFirst().closedBy());
        assertEquals(s.admin().id(), selected.link().linkedBy());
        assertNull(original.runCase().snapshotDescription()); assertNull(retest.runCase().snapshotDescription());
        assertNull(original.runCase().snapshotPreconditions()); assertNull(retest.runCase().snapshotPreconditions());
    }

    @Test void historicalClosedDefectIsExplicitlyLegacyWithoutFabricatedReceipt() {
        Scenario s = scenario(); Run original = run(s); TestAttempt fail = attempt(s, original, TestAttemptStatus.FAIL);
        // Initial pre-R1 historical fixture creation only. No business status is changed through SQL.
        Defect historical = tx.inTransaction(c -> {
            Defect inserted = new JdbcDefectDao(c).insert(new Defect(null, s.project().id(), 900L,
                    "Pre-R1 closed fixture", "Synthetic historical row", DefectSeverity.MEDIUM, Priority.MEDIUM,
                    DefectStatus.CLOSED, s.tester().id(), s.developer().id(), "Historical resolution", null, null, null));
            new JdbcTestAttemptDefectDao(c).add(new TestAttemptDefect(fail.id(), inserted.id(), s.tester().id(), null));
            return inserted;
        });
        ClosureEligibility legacy = eligibility(s, historical);
        assertTrue(legacy.legacyClosed()); assertFalse(legacy.canClose());
        assertTrue(legacy.history().isEmpty()); assertTrue(receipts(historical).isEmpty());
        attempt(s, original, TestAttemptStatus.FAIL);
        assertTrue(eligibility(s, historical).legacyClosed());
        assertEquals(historical, current(s, historical));
        assertTrue(receipts(historical).isEmpty());
    }

    @Test void emptyOrNoncontiguousFrozenStepsAreRejectedWithoutRewritingEitherSnapshot() {
        for (List<TestRunCaseStep> malformed : List.of(List.<TestRunCaseStep>of(),
                List.of(new TestRunCaseStep(null, 2, "Action 1", "Expected 1")),
                List.of(new TestRunCaseStep(null, 1, "Action 1", "Expected 1"), new TestRunCaseStep(null, 3, "Action 2", "Expected 2")))) {
            Scenario s = scenario(); Run original = run(s); TestAttempt fail = attempt(s, original, TestAttemptStatus.FAIL);
            Defect resolved = resolve(s, defect(s, fail));
            Run malformedRun = tx.inTransaction(c -> {
                TestRun value = new JdbcTestRunDao(c).insert(new TestRun(null, s.project().id(), null,
                        "Synthetic malformed historical snapshot", "test", "r1", TestRunStatus.IN_PROGRESS, null,
                        s.tester().id(), null, null, null));
                TestRunCase snapshot = new JdbcTestRunCaseDao(c).insert(new TestRunCase(null, value.id(), s.testCase().id(),
                        s.testCase().title(), "Description", "Preconditions", Priority.MEDIUM, null));
                for (TestRunCaseStep step : malformed) new JdbcTestRunCaseStepDao(c).insert(new TestRunCaseStep(snapshot.id(),
                        step.stepOrder(), step.action(), step.expectedResult()));
                return new Run(value, snapshot);
            });
            TestAttempt pass = attempt(s, malformedRun, TestAttemptStatus.PASS);
            rejected("DEFINITION_MISMATCH", () -> link(s, resolved, fail, pass));
            assertEquals(malformed.size(), testRuns.listSnapshotSteps(s.tester().id(), malformedRun.runCase().id()).size());
            assertEquals(standardSteps().size(), testRuns.listSnapshotSteps(s.tester().id(), original.runCase().id()).size());
            assertTrue(links(resolved).isEmpty()); assertTrue(receipts(resolved).isEmpty());
        }
    }

    @Test void incompatibleLaterDefinitionDoesNotMasqueradeAsRecurrenceOfFrozenDefinition() {
        Scenario s = scenario(); Run original = run(s); TestAttempt fail = attempt(s, original, TestAttemptStatus.FAIL);
        Defect resolved = resolve(s, defect(s, fail)); Run retest = run(s);
        TestAttempt pass = attempt(s, retest, TestAttemptStatus.PASS);
        RetestOperationResult selection = link(s, resolved, fail, pass);
        revise(s, "A different frozen definition", "Description changed", "New preconditions", Priority.MEDIUM,
                List.of(new TestStepInput(1, "New action", "New expected")));
        TestAttempt otherDefinitionFail = attempt(s, run(s), TestAttemptStatus.FAIL);
        assertTrue(otherDefinitionFail.recordedAt().isAfter(pass.recordedAt()));
        Defect linked = current(s, resolved);
        assertTrue(eligibility(s, linked).canClose());
        Defect closed = close(s, linked);
        assertEquals(selection.link().id(), items(receipts(closed).getFirst()).getFirst().retestLinkId());
        assertEquals(fail.id(), items(receipts(closed).getFirst()).getFirst().failureAttemptId());
    }

    @Test void equalTimeNonPassInAnotherCompatibleRunConservativelyBlocksClose() {
        Scenario s = scenario(); Run original = run(s); Run parallel = run(s);
        TestExecutionService fixedDb = executionAtDatabaseTime("1791936300.223456");
        TestAttempt fail = append(fixedDb, s, original, TestAttemptStatus.FAIL);
        Defect resolved = resolve(s, defect(s, fail));
        TestAttempt pass = append(fixedDb, s, original, TestAttemptStatus.PASS);
        TestAttempt ambiguous = append(fixedDb, s, parallel, TestAttemptStatus.BLOCKED);
        assertEquals(pass.recordedAt(), ambiguous.recordedAt());
        rejected("LATER_NON_PASS", () -> close(s, resolved));
        assertTrue(receipts(resolved).isEmpty());
        assertEquals(resolved, current(s, resolved));
    }

    @Test void reviewNoteUsesCodePointLimitsAndPreservesExactTextForRequestReplay() {
        Scenario s = scenario(); Run original = run(s); TestAttempt fail = attempt(s, original, TestAttemptStatus.FAIL);
        Defect resolved = resolve(s, defect(s, fail)); TestAttempt pass = attempt(s, run(s), TestAttemptStatus.PASS);
        String tooLong = "\ud83d\ude00".repeat(2001);
        assertThrows(ValidationException.class, () -> defects.linkRetest(s.tester().id(), s.project().id(),
                new LinkRetestCommand(resolved.id(), fail.id(), pass.id(), resolved.lockVersion(), UUID.randomUUID(),
                        tooLong, DefectRetestTimingBasis.MANUAL_SERVER_RECORD, null, null)));
        assertEquals(resolved, current(s, resolved)); assertTrue(links(resolved).isEmpty());
        String exact = "\ud83d\ude00".repeat(2000);
        UUID request = UUID.randomUUID();
        LinkRetestCommand command = new LinkRetestCommand(resolved.id(), fail.id(), pass.id(), resolved.lockVersion(),
                request, exact, DefectRetestTimingBasis.MANUAL_SERVER_RECORD, null, null);
        RetestOperationResult first = defects.linkRetest(s.tester().id(), s.project().id(), command);
        assertEquals(exact, first.link().reviewNote());
        assertTrue(defects.linkRetest(s.tester().id(), s.project().id(), command).replayed());
        assertEquals(1, links(resolved).size());
        assertEquals(first.resultDefectVersion(), current(s, resolved).lockVersion());
        rejected("REQUEST_KEY_CONFLICT", () -> defects.linkRetest(s.tester().id(), s.project().id(),
                new LinkRetestCommand(resolved.id(), fail.id(), pass.id(), resolved.lockVersion(), request,
                        "\ud83d\ude01".repeat(2000), DefectRetestTimingBasis.MANUAL_SERVER_RECORD, null, null)));
    }

    @Test void replacingAndRevokingRequireTheCorrectSelectionAndKeepHistoricalRows() {
        Scenario s = scenario(); Run original = run(s); TestAttempt fail = attempt(s, original, TestAttemptStatus.FAIL);
        Defect resolved = resolve(s, defect(s, fail)); Run retest = run(s);
        TestAttempt pass = attempt(s, retest, TestAttemptStatus.PASS);
        RetestOperationResult initial = link(s, resolved, fail, pass); Defect linked = current(s, resolved);
        rejected("ACTIVE_SELECTION_EXISTS", () -> link(s, linked, fail, pass));
        TestAttempt newer = attempt(s, retest, TestAttemptStatus.PASS);
        rejected("RETEST_SELECTION_CHANGED", () -> defects.linkRetest(s.tester().id(), s.project().id(),
                new LinkRetestCommand(linked.id(), fail.id(), newer.id(), linked.lockVersion(), UUID.randomUUID(),
                        "Actual later retest", DefectRetestTimingBasis.MANUAL_SERVER_RECORD, Long.MAX_VALUE, "Wrong old selection")));
        assertEquals(linked, current(s, linked)); assertEquals(1, links(linked).size());
        RetestOperationResult revoked = defects.revokeRetest(s.tester().id(), s.project().id(),
                new RevokeRetestCommand(linked.id(), initial.link().id(), linked.lockVersion(), UUID.randomUUID(), "Incorrect declaration"));
        Defect unlinked = current(s, linked);
        rejected("RETEST_ALREADY_REVOKED", () -> defects.revokeRetest(s.tester().id(), s.project().id(),
                new RevokeRetestCommand(unlinked.id(), initial.link().id(), unlinked.lockVersion(), UUID.randomUUID(), "Duplicate revocation")));
        assertEquals(1, links(unlinked).size());
        assertEquals(revoked.link().revocation().revokedAt(), links(unlinked).getFirst().revocation().revokedAt());
        RetestOperationResult reselected = link(s, unlinked, fail, newer);
        assertNotEquals(initial.link().id(), reselected.link().id());
        assertEquals(2, links(unlinked).size());
        assertEquals(1, links(unlinked).stream().filter(l -> l.revocation() == null).count());
    }
}
