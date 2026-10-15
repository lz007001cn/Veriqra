package io.github.lz007001cn.veriqra.service;

import io.github.lz007001cn.veriqra.exception.DataAccessException;
import io.github.lz007001cn.veriqra.model.*;
import io.github.lz007001cn.veriqra.service.command.*;
import io.github.lz007001cn.veriqra.service.exception.*;
import io.github.lz007001cn.veriqra.service.importing.*;
import io.github.lz007001cn.veriqra.service.support.*;
import java.nio.charset.StandardCharsets;
import java.security.*;
import java.time.*;
import java.util.*;

public final class DefaultTestImportService implements TestImportService {
    private final ServiceTransaction transactions;
    private final ServiceDaoFactory daoFactory;
    private final ProjectAccessPolicy access;
    private final JUnitXmlParser parser;
    private final Clock clock;

    public DefaultTestImportService(ServiceTransaction transactions, ServiceDaoFactory daoFactory,
                                    ProjectAccessPolicy access, JUnitXmlParser parser, Clock clock) {
        this.transactions = Objects.requireNonNull(transactions);
        this.daoFactory = Objects.requireNonNull(daoFactory);
        this.access = Objects.requireNonNull(access);
        this.parser = Objects.requireNonNull(parser);
        this.clock = Objects.requireNonNull(clock);
    }

    @Override public ImportPreview analyzeImport(Long actorUserId, AnalyzeTestImportCommand command) {
        ServiceValidation.required(command, "command");
        ServiceValidation.required(command.projectId(), "projectId");
        String namespace = ServiceValidation.requiredText(command.sourceNamespace(), 128, "sourceNamespace");
        JUnitParseResult parsed = parser.parse(command.payload());
        return transactions.execute(connection -> {
            ServiceDaos daos = daoFactory.create(connection);
            Project project = daos.projects().findById(command.projectId())
                    .orElseThrow(() -> new NotFoundException("Project does not exist"));
            access.requireProjectRead(daos.users(), daos.members(), actorUserId, project.id());
            return preview(daos, project.id(), namespace, parsed);
        });
    }

    @Override public ImportExecutionResult importReport(Long actorUserId, ImportTestResultsCommand command) {
        ValidatedImport validated = validate(command);
        JUnitParseResult parsed = parser.parse(validated.payload());
        if (!parsed.invalidEntries().isEmpty()) {
            throw new ValidationException("JUnit XML contains invalid testcase entries");
        }
        byte[] hash = sha256(validated.payload());
        try {
            return transactions.execute(connection -> {
            ServiceDaos daos = daoFactory.create(connection);
            Project project = writableProject(daos, actorUserId, validated.projectId());
            Optional<TestImport> existing = daos.imports().findByRequestKey(validated.requestKey());
            if (existing.isPresent()) return acceptReplay(daos, existing.get(), actorUserId, validated, hash);

            List<ResolvedResult> resolved = lockAndResolve(daos, project.id(), validated.sourceNamespace(), parsed);
            TestRun insertedRun = daos.testRuns().insert(new TestRun(null, project.id(), null, validated.runName(),
                    validated.environment(), validated.buildVersion(), TestRunStatus.IN_PROGRESS, null,
                    actorUserId, null, null, null));
            Map<Long, TestRunCase> runCaseByCase = new HashMap<>();
            for (ResolvedResult item : resolved.stream()
                    .sorted(Comparator.comparing(value -> value.testCase().id())).toList()) {
                TestCase testCase = item.testCase();
                List<TestStep> steps = daos.steps().listByTestCaseForShare(testCase.id());
                validateSnapshotSteps(testCase.id(), steps);
                TestRunCase runCase = daos.runCases().insert(new TestRunCase(null, insertedRun.id(), testCase.id(),
                        testCase.title(), testCase.description(), testCase.preconditions(), testCase.priority(), null));
                for (TestStep step : steps) {
                    daos.runCaseSteps().insert(new TestRunCaseStep(runCase.id(), step.stepOrder(),
                            step.action(), step.expectedResult()));
                }
                runCaseByCase.put(testCase.id(), runCase);
            }
            TestImport batch = daos.imports().insert(new TestImport(null, insertedRun.id(), validated.requestKey(),
                    hash, validated.sourceNamespace(), validated.originalFilename(), actorUserId, null));
            List<TestAttempt> attempts = new ArrayList<>();
            for (ResolvedResult item : resolved) {
                TestRunCase runCase = runCaseByCase.get(item.testCase().id());
                JUnitTestResult result = item.result();
                UUID submissionKey = UUID.nameUUIDFromBytes((validated.requestKey() + ":" + item.identity().id())
                        .getBytes(StandardCharsets.UTF_8));
                attempts.add(daos.attempts().insert(new TestAttempt(null, runCase.id(), 1, result.status(),
                        null, batch.id(), item.mapping().id(), null, null, result.durationMs(), result.comment(),
                        result.failureMessage(), submissionKey)));
            }
            LocalDateTime endedAt = LocalDateTime.now(clock);
            if (endedAt.isBefore(insertedRun.createdAt())) endedAt = insertedRun.createdAt();
            TestRun completed = daos.testRuns().update(new TestRun(insertedRun.id(), insertedRun.projectId(), null,
                    insertedRun.name(), insertedRun.environment(), insertedRun.buildVersion(), TestRunStatus.COMPLETED,
                    endedAt, insertedRun.createdBy(), insertedRun.createdAt(), insertedRun.updatedAt(),
                    insertedRun.lockVersion()));
            return new ImportExecutionResult(batch, completed,
                    runCaseByCase.values().stream().sorted(Comparator.comparing(TestRunCase::testCaseId)).toList(),
                    attempts, false);
            });
        } catch (DataAccessException failure) {
            if (failure.getVendorCode() != 1062) throw failure;
            return recoverConcurrentReplay(actorUserId, validated, hash, failure);
        }
    }

    private ImportExecutionResult recoverConcurrentReplay(Long actorUserId, ValidatedImport command,
                                                           byte[] hash, DataAccessException originalFailure) {
        return transactions.execute(connection -> {
            ServiceDaos daos = daoFactory.create(connection);
            writableProject(daos, actorUserId, command.projectId());
            TestImport existing = daos.imports().findByRequestKey(command.requestKey())
                    .orElseThrow(() -> originalFailure);
            return acceptReplay(daos, existing, actorUserId, command, hash);
        });
    }

    private static ImportPreview preview(ServiceDaos daos, Long projectId, String sourceNamespace,
                                         JUnitParseResult parsed) {
        List<ImportPreview.MappedResult> mapped = new ArrayList<>();
        LinkedHashSet<AutomationIdentityKey> unmapped = new LinkedHashSet<>();
        List<ImportIssue> issues = new ArrayList<>(parsed.invalidEntries());
        Set<Long> usedCases = new HashSet<>();
        for (JUnitTestResult result : parsed.results()) {
            if (!sourceNamespace.equals(result.identity().namespace())) {
                issues.add(new ImportIssue(result.entryIndex(), "testcase namespace differs from import sourceNamespace"));
                continue;
            }
            Optional<TestAutomationIdentity> identity = daos.automationIdentities().findByExternalKey(projectId,
                    result.identity().source(), result.identity().namespace(), result.identity().externalKey());
            if (identity.isEmpty()) { unmapped.add(result.identity()); continue; }
            Optional<TestAutomationMapping> mapping = daos.automationMappings().findByIdentity(identity.get().id())
                    .filter(value -> value.status() == AutomationMappingStatus.ACTIVE);
            if (mapping.isEmpty()) { unmapped.add(result.identity()); continue; }
            Optional<TestCase> testCase = daos.testCases().findById(mapping.get().testCaseId());
            if (testCase.isEmpty() || !Objects.equals(testCase.get().projectId(), projectId)
                    || testCase.get().status() != TestCaseStatus.READY) {
                issues.add(new ImportIssue(result.entryIndex(), "active mapping does not target a READY case in this project"));
                continue;
            }
            if (!usedCases.add(testCase.get().id())) {
                issues.add(new ImportIssue(result.entryIndex(), "multiple automation identities map to one test case"));
                continue;
            }
            mapped.add(new ImportPreview.MappedResult(result, identity.get(), mapping.get(), testCase.get()));
        }
        return new ImportPreview(mapped, new ArrayList<>(unmapped), issues);
    }

    private static List<ResolvedResult> lockAndResolve(ServiceDaos daos, Long projectId, String sourceNamespace,
                                                       JUnitParseResult parsed) {
        if (parsed.results().isEmpty()) throw new ValidationException("JUnit XML has no valid testcase entries");
        List<ResolvedResult> preliminary = new ArrayList<>();
        Set<Long> caseIds = new HashSet<>();
        for (JUnitTestResult result : parsed.results()) {
            if (!sourceNamespace.equals(result.identity().namespace())) {
                throw new ValidationException("Every testcase namespace must equal sourceNamespace");
            }
            TestAutomationIdentity identity = daos.automationIdentities().findByExternalKey(projectId,
                    result.identity().source(), result.identity().namespace(), result.identity().externalKey())
                    .orElseThrow(() -> new ConflictException("Import contains an unmapped automation identity"));
            TestAutomationMapping mapping = daos.automationMappings().findByIdentity(identity.id())
                    .filter(value -> value.status() == AutomationMappingStatus.ACTIVE)
                    .orElseThrow(() -> new ConflictException("Import contains an unmapped automation identity"));
            TestCase testCase = daos.testCases().findById(mapping.testCaseId())
                    .orElseThrow(() -> new ConflictException("Mapped test case does not exist"));
            if (!caseIds.add(testCase.id())) {
                throw new ConflictException("Multiple automation identities map to one test case in this import");
            }
            preliminary.add(new ResolvedResult(result, identity, mapping, testCase));
        }

        Map<Long, TestCase> lockedCases = new HashMap<>();
        for (Long caseId : caseIds.stream().sorted().toList()) {
            TestCase testCase = daos.testCases().findByIdForUpdate(caseId)
                    .orElseThrow(() -> new ConflictException("Mapped test case changed"));
            if (!Objects.equals(testCase.projectId(), projectId) || testCase.status() != TestCaseStatus.READY) {
                throw new ConflictException("Mapping must target a READY case in the import project");
            }
            lockedCases.put(caseId, testCase);
        }
        Map<Long, TestAutomationIdentity> lockedIdentities = new HashMap<>();
        for (Long identityId : preliminary.stream().map(value -> value.identity().id()).sorted().toList()) {
            TestAutomationIdentity identity = daos.automationIdentities().findByIdForUpdate(identityId)
                    .orElseThrow(() -> new ConflictException("Automation identity changed"));
            lockedIdentities.put(identityId, identity);
        }
        List<ResolvedResult> locked = new ArrayList<>();
        for (ResolvedResult value : preliminary.stream()
                .sorted(Comparator.comparing(item -> item.identity().id())).toList()) {
            TestAutomationIdentity identity = lockedIdentities.get(value.identity().id());
            if (!Objects.equals(identity.projectId(), projectId) || identity.source() != AutomationSource.JUNIT
                    || !sourceNamespace.equals(identity.namespace())
                    || !identity.externalKey().equals(value.result().identity().externalKey())) {
                throw new ConflictException("Automation identity changed during import");
            }
            TestAutomationMapping mapping = daos.automationMappings().findByIdentityForUpdate(identity.id())
                    .orElseThrow(() -> new ConflictException("Automation mapping changed"));
            if (mapping.status() != AutomationMappingStatus.ACTIVE
                    || !Objects.equals(mapping.id(), value.mapping().id())
                    || !Objects.equals(mapping.testCaseId(), value.testCase().id())) {
                throw new ConflictException("Automation mapping changed during import");
            }
            locked.add(new ResolvedResult(value.result(), identity, mapping,
                    lockedCases.get(mapping.testCaseId())));
        }
        return List.copyOf(locked);
    }

    private static ImportExecutionResult acceptReplay(ServiceDaos daos, TestImport existing, Long actorUserId,
                                                       ValidatedImport command, byte[] hash) {
        TestRun run = daos.testRuns().findById(existing.testRunId())
                .orElseThrow(() -> new ConflictException("Existing import run does not exist"));
        boolean equivalent = Objects.equals(run.projectId(), command.projectId()) && run.testPlanId() == null
                && Objects.equals(run.name(), command.runName())
                && Objects.equals(run.environment(), command.environment())
                && Objects.equals(run.buildVersion(), command.buildVersion())
                && Objects.equals(existing.importedBy(), actorUserId)
                && Objects.equals(existing.sourceNamespace(), command.sourceNamespace())
                && Objects.equals(existing.originalFilename(), command.originalFilename())
                && Arrays.equals(existing.reportSha256(), hash);
        if (!equivalent) throw new ConflictException("Import request key was already used with different data");
        return new ImportExecutionResult(existing, run, daos.runCases().listByRun(run.id()),
                daos.attempts().listByImport(existing.id()), true);
    }

    private Project writableProject(ServiceDaos daos, Long actorUserId, Long projectId) {
        Project project = daos.projects().findByIdForShare(projectId)
                .orElseThrow(() -> new NotFoundException("Project does not exist"));
        access.requireAssetWrite(daos.users(), daos.members(), actorUserId, project.id());
        if (project.status() != ProjectStatus.ACTIVE) throw new ConflictException("Archived project is read-only");
        return project;
    }

    private static void validateSnapshotSteps(Long caseId, List<TestStep> steps) {
        if (steps.isEmpty()) throw new ConflictException("READY test case has no steps: " + caseId);
        for (int index = 0; index < steps.size(); index++) {
            if (!Objects.equals(steps.get(index).stepOrder(), index + 1)) {
                throw new ConflictException("Test case steps are not contiguous: " + caseId);
            }
        }
    }

    private static ValidatedImport validate(ImportTestResultsCommand command) {
        ServiceValidation.required(command, "command");
        Long projectId = ServiceValidation.required(command.projectId(), "projectId");
        UUID requestKey = ServiceValidation.required(command.requestKey(), "requestKey");
        String namespace = ServiceValidation.requiredText(command.sourceNamespace(), 128, "sourceNamespace");
        String filename = ServiceValidation.requiredText(command.originalFilename(), 255, "originalFilename");
        if (filename.indexOf('/') >= 0 || filename.indexOf('\\') >= 0 || filename.indexOf('\0') >= 0) {
            throw new ValidationException("originalFilename must not contain a path");
        }
        String runName = ServiceValidation.requiredText(command.runName(), 160, "runName");
        String environment = ServiceValidation.optionalText(command.environment(), 160, "environment");
        String build = ServiceValidation.optionalText(command.buildVersion(), 80, "buildVersion");
        byte[] payload = ServiceValidation.required(command.payload(), "payload");
        return new ValidatedImport(projectId, requestKey, namespace, filename, runName, environment, build, payload);
    }

    private static byte[] sha256(byte[] payload) {
        try { return MessageDigest.getInstance("SHA-256").digest(payload); }
        catch (NoSuchAlgorithmException impossible) { throw new IllegalStateException("SHA-256 is unavailable", impossible); }
    }

    private record ResolvedResult(JUnitTestResult result, TestAutomationIdentity identity,
                                  TestAutomationMapping mapping, TestCase testCase) { }
    private record ValidatedImport(Long projectId, UUID requestKey, String sourceNamespace,
                                   String originalFilename, String runName, String environment,
                                   String buildVersion, byte[] payload) {
        private ValidatedImport {
            payload = payload.clone();
        }
        @Override public byte[] payload() { return payload.clone(); }
    }
}
