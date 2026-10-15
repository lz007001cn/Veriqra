package io.github.lz007001cn.veriqra.service;

import io.github.lz007001cn.veriqra.exception.OptimisticLockException;
import io.github.lz007001cn.veriqra.model.*;
import io.github.lz007001cn.veriqra.service.command.*;
import io.github.lz007001cn.veriqra.service.exception.*;
import io.github.lz007001cn.veriqra.service.support.*;
import io.github.lz007001cn.veriqra.service.query.*;
import java.util.*;

public final class DefaultDefectService implements DefectService {
    private final ServiceTransaction transactions;
    private final ServiceDaoFactory daoFactory;
    private final ProjectAccessPolicy access;
    private final DefaultDefectRetestWorkflow retestWorkflow;

    public DefaultDefectService(ServiceTransaction transactions, ServiceDaoFactory daoFactory,
                                ProjectAccessPolicy access) {
        this.transactions = Objects.requireNonNull(transactions);
        this.daoFactory = Objects.requireNonNull(daoFactory);
        this.access = Objects.requireNonNull(access);
        this.retestWorkflow = new DefaultDefectRetestWorkflow(transactions, daoFactory, access);
    }

    @Override public ClosureEligibility closureEligibility(Long actor, Long project, Long defect) { return retestWorkflow.eligibility(actor, project, defect); }
    @Override public RetestCandidates retestCandidates(Long actor, Long project, Long defect, Long failure, Long cursor, int size) { return retestWorkflow.candidates(actor, project, defect, failure, cursor, size); }
    @Override public RetestOperationResult linkRetest(Long actor, Long project, LinkRetestCommand command) { return retestWorkflow.link(actor, project, command); }
    @Override public RetestOperationResult revokeRetest(Long actor, Long project, RevokeRetestCommand command) { return retestWorkflow.revoke(actor, project, command); }
    @Override public Optional<RetestOperationResult> recoverRetestOperation(Long actor, Long project, Long defect, UUID key, String action) { return retestWorkflow.recover(actor, project, defect, key, action); }

    @Override public Defect create(Long actorUserId, CreateDefectCommand command) {
        ServiceValidation.required(command, "command");
        ServiceValidation.required(command.projectId(), "projectId");
        ServiceValidation.required(command.failureAttemptId(), "failureAttemptId");
        String title = ServiceValidation.requiredText(command.title(), 240, "title");
        DefectSeverity severity = ServiceValidation.required(command.severity(), "severity");
        Priority priority = ServiceValidation.required(command.priority(), "priority");
        return transactions.execute(connection -> {
            ServiceDaos daos = daoFactory.create(connection);
            AttemptContext preliminary = loadAttemptContext(daos, command.failureAttemptId());
            ensureSameProject(preliminary.run().projectId(), command.projectId(), "Failure attempt");
            requireFail(preliminary.attempt());
            Project project = writableProject(daos, command.projectId());
            lockParticipants(daos, project.id(), actorUserId, command.assigneeId());
            access.requireProjectMemberWrite(daos.users(), daos.members(), actorUserId, project.id());
            validateAssignee(daos, project.id(), command.assigneeId());
            AttemptContext evidence = lockAttemptContext(daos, preliminary);
            validateEvidence(evidence, project.id());
            long key = daos.counters().allocateNext(project.id(), CounterEntityType.BUG);
            Defect defect = daos.defects().insert(new Defect(null, project.id(), key, title,
                    command.description(), severity, priority, DefectStatus.OPEN, actorUserId,
                    command.assigneeId(), null, null, null, null));
            daos.attemptDefects().add(new TestAttemptDefect(evidence.attempt().id(), defect.id(),
                    actorUserId, null));
            return defect;
        });
    }

    @Override public DefectDetails getDetails(Long actorUserId, Long projectId, Long defectId) {
        ServiceValidation.required(projectId, "projectId");
        ServiceValidation.required(defectId, "defectId");
        return transactions.execute(connection -> {
            ServiceDaos daos = daoFactory.create(connection);
            Defect defect = findDefect(daos, defectId);
            ProjectOwnership.require(defect.projectId(), projectId);
            access.requireProjectRead(daos.users(), daos.members(), actorUserId, projectId);
            return new DefectDetails(defect, daos.attemptDefects().listAttemptsByDefect(defectId).stream()
                    .map(link -> {
                        AttemptContext context = loadAttemptContext(daos, link.attemptId());
                        ensureSameProject(context.run().projectId(), projectId, "Evidence attempt");
                        return new DefectDetails.Evidence(link, context.attempt(), context.run().id());
                    }).toList());
        });
    }

    @Override public Defect get(Long actorUserId, Long defectId) {
        ServiceValidation.required(defectId, "defectId");
        return transactions.execute(connection -> {
            ServiceDaos daos = daoFactory.create(connection);
            Defect defect = findDefect(daos, defectId);
            access.requireProjectRead(daos.users(), daos.members(), actorUserId, defect.projectId());
            return defect;
        });
    }

    @Override public List<Defect> listByProject(Long actorUserId, Long projectId) {
        ServiceValidation.required(projectId, "projectId");
        return transactions.execute(connection -> {
            ServiceDaos daos = daoFactory.create(connection);
            daos.projects().findById(projectId)
                    .orElseThrow(() -> new NotFoundException("Project does not exist"));
            access.requireProjectRead(daos.users(), daos.members(), actorUserId, projectId);
            return daos.defects().listByProject(projectId);
        });
    }

    @Override public Defect update(Long actorUserId, UpdateDefectCommand command) {
        return update(actorUserId, null, command);
    }

    @Override public Defect update(Long actorUserId, Long projectId, UpdateDefectCommand command) {
        ServiceValidation.required(command, "command");
        ServiceValidation.required(command.defectId(), "defectId");
        ServiceValidation.required(command.lockVersion(), "lockVersion");
        String title = ServiceValidation.requiredText(command.title(), 240, "title");
        DefectSeverity severity = ServiceValidation.required(command.severity(), "severity");
        Priority priority = ServiceValidation.required(command.priority(), "priority");
        return transactions.execute(connection -> {
            ServiceDaos daos = daoFactory.create(connection);
            Defect preliminary = findDefect(daos, command.defectId());
            ProjectOwnership.require(preliminary.projectId(), projectId);
            Project project = writableProject(daos, preliminary.projectId());
            lockParticipants(daos, project.id(), actorUserId, command.assigneeId());
            access.requireAssetWrite(daos.users(), daos.members(), actorUserId, project.id());
            Defect current = lockDefect(daos, preliminary.id(), command.lockVersion());
            ensureSameProject(current.projectId(), project.id(), "Defect");
            if (current.status() == DefectStatus.CLOSED) {
                throw new ConflictException("Closed defect must be reopened before editing");
            }
            if (!Objects.equals(current.assigneeId(), command.assigneeId())) {
                validateAssignee(daos, project.id(), command.assigneeId());
            }
            return updateRow(daos, new Defect(current.id(), current.projectId(), current.keyNo(), title,
                    command.description(), severity, priority, current.status(), current.reporterId(),
                    command.assigneeId(), current.resolutionNote(), current.createdAt(), current.updatedAt(),
                    command.lockVersion()));
        });
    }

    @Override public Defect transition(Long actorUserId, TransitionDefectCommand command) {
        return transition(actorUserId, null, command);
    }

    @Override public Defect transition(Long actorUserId, Long projectId, TransitionDefectCommand command) {
        ServiceValidation.required(command, "command");
        ServiceValidation.required(command.defectId(), "defectId");
        ServiceValidation.required(command.targetStatus(), "targetStatus");
        ServiceValidation.required(command.lockVersion(), "lockVersion");
        if (command.targetStatus() == DefectStatus.CLOSED) return close(actorUserId, projectId, command);
        if (command.targetStatus() == DefectStatus.REOPENED) {
            throw new ConflictException("Use reopen with a new FAIL evidence attempt");
        }
        if (command.targetStatus() == DefectStatus.OPEN) {
            throw new ConflictException("Defect cannot transition back to OPEN");
        }
        String resolution = command.targetStatus() == DefectStatus.RESOLVED
                ? ServiceValidation.requiredText(command.resolutionNote(), Integer.MAX_VALUE, "resolutionNote")
                : requireNoResolution(command.resolutionNote());
        return transactions.execute(connection -> {
            ServiceDaos daos = daoFactory.create(connection);
            Defect preliminary = findDefect(daos, command.defectId());
            ProjectOwnership.require(preliminary.projectId(), projectId);
            Project project = writableProject(daos, preliminary.projectId());
            lockParticipants(daos, project.id(), actorUserId);
            Defect current = lockDefect(daos, preliminary.id(), command.lockVersion());
            User actor = requireTransitionPermission(daos, actorUserId, project.id(), current,
                    command.targetStatus());
            ensureAllowedTransition(current.status(), command.targetStatus());
            return updateRow(daos, copyForStatus(current, command.targetStatus(), current.assigneeId(),
                    resolution, command.lockVersion()));
        });
    }

    @Override public Defect reopen(Long actorUserId, ReopenDefectCommand command) {
        return reopen(actorUserId, null, command);
    }

    @Override public Defect reopen(Long actorUserId, Long projectId, ReopenDefectCommand command) {
        ServiceValidation.required(command, "command");
        ServiceValidation.required(command.defectId(), "defectId");
        ServiceValidation.required(command.failureAttemptId(), "failureAttemptId");
        ServiceValidation.required(command.assigneeId(), "assigneeId");
        ServiceValidation.required(command.lockVersion(), "lockVersion");
        return transactions.execute(connection -> {
            ServiceDaos daos = daoFactory.create(connection);
            Defect preliminary = findDefect(daos, command.defectId());
            ProjectOwnership.require(preliminary.projectId(), projectId);
            AttemptContext preliminaryEvidence = loadAttemptContext(daos, command.failureAttemptId());
            ensureSameProject(preliminaryEvidence.run().projectId(), preliminary.projectId(), "Failure attempt");
            requireFail(preliminaryEvidence.attempt());
            Project project = writableProject(daos, preliminary.projectId());
            lockParticipants(daos, project.id(), actorUserId, command.assigneeId());
            access.requireAssetWrite(daos.users(), daos.members(), actorUserId, project.id());
            validateAssignee(daos, project.id(), command.assigneeId());
            AttemptContext evidence = lockAttemptContext(daos, preliminaryEvidence);
            validateEvidence(evidence, project.id());
            Defect current = lockDefect(daos, preliminary.id(), command.lockVersion());
            if (current.status() != DefectStatus.RESOLVED && current.status() != DefectStatus.CLOSED) {
                throw new ConflictException("Only RESOLVED or CLOSED defect can be reopened");
            }
            List<TestAttemptDefect> links = daos.attemptDefects().listAttemptsByDefectForUpdate(current.id());
            if (containsAttempt(links, evidence.attempt().id())) {
                throw new ConflictException("Reopen requires a new FAIL evidence attempt");
            }
            Defect reopened = updateRow(daos, copyForStatus(current, DefectStatus.REOPENED,
                    command.assigneeId(), null, command.lockVersion()));
            daos.attemptDefects().add(new TestAttemptDefect(evidence.attempt().id(), current.id(),
                    actorUserId, null));
            return reopened;
        });
    }

    @Override public TestAttemptDefect addEvidence(Long actorUserId, Long defectId, Long failureAttemptId) {
        return addEvidence(actorUserId, null, defectId, failureAttemptId);
    }

    @Override public TestAttemptDefect addEvidence(Long actorUserId, Long projectId, Long defectId, Long failureAttemptId) {
        return addEvidence(actorUserId, projectId, defectId, failureAttemptId, get(actorUserId, defectId).lockVersion());
    }

    @Override public TestAttemptDefect addEvidence(Long actorUserId, Long projectId, Long defectId, Long failureAttemptId, Integer expectedVersion) {
        ServiceValidation.required(defectId, "defectId");
        ServiceValidation.required(failureAttemptId, "failureAttemptId");
        validateVersion(expectedVersion);
        return transactions.execute(connection -> {
            ServiceDaos daos = daoFactory.create(connection);
            Defect preliminary = findDefect(daos, defectId);
            ProjectOwnership.require(preliminary.projectId(), projectId);
            AttemptContext preliminaryEvidence = loadAttemptContext(daos, failureAttemptId);
            ensureSameProject(preliminaryEvidence.run().projectId(), preliminary.projectId(), "Failure attempt");
            requireFail(preliminaryEvidence.attempt());
            Project project = writableProject(daos, preliminary.projectId());
            lockParticipants(daos, project.id(), actorUserId);
            access.requireAssetWrite(daos.users(), daos.members(), actorUserId, project.id());
            AttemptContext evidence = lockAttemptContext(daos, preliminaryEvidence);
            validateEvidence(evidence, project.id());
            Defect current = daos.defects().findByIdForUpdate(defectId)
                    .orElseThrow(() -> new NotFoundException("Defect does not exist"));
            if (current.status() == DefectStatus.CLOSED) {
                throw new R1RuleException("CLOSED_READ_ONLY");
            }
            if (!Objects.equals(current.lockVersion(), expectedVersion)) throw new R1RuleException("STALE_VERSION");
            List<TestAttemptDefect> links = daos.attemptDefects().listAttemptsByDefectForUpdate(current.id());
            var existing = links.stream().filter(link -> Objects.equals(link.attemptId(), evidence.attempt().id())).findFirst();
            if (existing.isPresent()) return existing.get();
            updateRow(daos, copyForStatus(current, current.status(), current.assigneeId(), current.resolutionNote(), expectedVersion));
            return daos.attemptDefects().add(new TestAttemptDefect(evidence.attempt().id(), current.id(), actorUserId, null));
        });
    }

    @Override public void removeEvidence(Long actorUserId, Long defectId, Long failureAttemptId) {
        removeEvidence(actorUserId, null, defectId, failureAttemptId);
    }

    @Override public void removeEvidence(Long actorUserId, Long projectId, Long defectId, Long failureAttemptId) {
        removeEvidence(actorUserId, projectId, defectId, failureAttemptId, get(actorUserId, defectId).lockVersion());
    }

    @Override public void removeEvidence(Long actorUserId, Long projectId, Long defectId, Long failureAttemptId, Integer expectedVersion) {
        ServiceValidation.required(defectId, "defectId");
        ServiceValidation.required(failureAttemptId, "failureAttemptId");
        validateVersion(expectedVersion);
        transactions.execute(connection -> {
            ServiceDaos daos = daoFactory.create(connection);
            Defect preliminary = findDefect(daos, defectId);
            ProjectOwnership.require(preliminary.projectId(), projectId);
            AttemptContext preliminaryEvidence = loadAttemptContext(daos, failureAttemptId);
            ensureSameProject(preliminaryEvidence.run().projectId(), preliminary.projectId(), "Failure attempt");
            Project project = writableProject(daos, preliminary.projectId());
            lockParticipants(daos, project.id(), actorUserId);
            access.requireAssetWrite(daos.users(), daos.members(), actorUserId, project.id());
            lockAttemptContext(daos, preliminaryEvidence);
            Defect current = daos.defects().findByIdForUpdate(defectId)
                    .orElseThrow(() -> new NotFoundException("Defect does not exist"));
            if (current.status() == DefectStatus.CLOSED) {
                throw new R1RuleException("CLOSED_READ_ONLY");
            }
            if (!Objects.equals(current.lockVersion(), expectedVersion)) throw new R1RuleException("STALE_VERSION");
            List<TestAttemptDefect> links = daos.attemptDefects().listAttemptsByDefectForUpdate(current.id());
            if (!containsAttempt(links, failureAttemptId)) {
                throw new NotFoundException("Evidence link does not exist");
            }
            if (daos.retestLinks().listByDefectForUpdate(current.id()).stream().anyMatch(link -> Objects.equals(link.failureAttemptId(), failureAttemptId))
                    || daos.closureItems().listByDefectForShare(current.id()).stream().anyMatch(item -> Objects.equals(item.failureAttemptId(), failureAttemptId))) {
                throw new R1RuleException("EVIDENCE_RETAINED");
            }
            if (!daos.attemptDefects().remove(failureAttemptId, current.id())) {
                throw new ConflictException("Evidence link changed during removal");
            }
            updateRow(daos, copyForStatus(current, current.status(), current.assigneeId(), current.resolutionNote(), expectedVersion));
            return null;
        });
    }

    @Override public List<TestAttemptDefect> listEvidence(Long actorUserId, Long defectId) {
        ServiceValidation.required(defectId, "defectId");
        return transactions.execute(connection -> {
            ServiceDaos daos = daoFactory.create(connection);
            Defect defect = findDefect(daos, defectId);
            access.requireProjectRead(daos.users(), daos.members(), actorUserId, defect.projectId());
            return daos.attemptDefects().listAttemptsByDefect(defect.id());
        });
    }

    @Override public List<TestAttemptDefect> listDefectsForAttempt(Long actorUserId, Long attemptId) {
        ServiceValidation.required(attemptId, "attemptId");
        return transactions.execute(connection -> {
            ServiceDaos daos = daoFactory.create(connection);
            AttemptContext context = loadAttemptContext(daos, attemptId);
            access.requireProjectRead(daos.users(), daos.members(), actorUserId, context.run().projectId());
            return daos.attemptDefects().listDefectsByAttempt(attemptId);
        });
    }

    private Defect close(Long actorUserId, Long projectId, TransitionDefectCommand command) {
        return retestWorkflow.close(actorUserId, projectId, command);
    }

    private User requireTransitionPermission(ServiceDaos daos, Long actorUserId, Long projectId,
                                             Defect defect, DefectStatus target) {
        User actor = access.requireProjectMemberWrite(daos.users(), daos.members(), actorUserId, projectId);
        if (actor.systemRole() == SystemRole.ADMIN) return actor;
        ProjectMember member = daos.members().findForShare(projectId, actorUserId)
                .orElseThrow(() -> new ForbiddenException("Active project membership is required"));
        if (member.projectRole() == ProjectRole.TESTER) return actor;
        if (member.projectRole() == ProjectRole.DEVELOPER
                && Objects.equals(defect.assigneeId(), actorUserId)
                && (target == DefectStatus.IN_PROGRESS || target == DefectStatus.RESOLVED)) return actor;
        throw new ForbiddenException("Defect transition is not allowed for this actor");
    }

    private static void ensureAllowedTransition(DefectStatus current, DefectStatus target) {
        boolean allowed = (current == DefectStatus.OPEN || current == DefectStatus.REOPENED)
                && target == DefectStatus.IN_PROGRESS
                || current == DefectStatus.IN_PROGRESS && target == DefectStatus.RESOLVED;
        if (!allowed) throw new ConflictException("Invalid defect status transition: " + current + " -> " + target);
    }

    private static String requireNoResolution(String value) {
        if (value != null) throw new ValidationException("resolutionNote is only accepted for RESOLVED or CLOSED");
        return null;
    }

    private Project writableProject(ServiceDaos daos, Long projectId) {
        Project project = daos.projects().findByIdForShare(projectId)
                .orElseThrow(() -> new NotFoundException("Project does not exist"));
        if (project.status() != ProjectStatus.ACTIVE) throw new ConflictException("Archived project is read-only");
        return project;
    }

    private static void lockParticipants(ServiceDaos daos, Long projectId, Long... userIds) {
        List<Long> ids = Arrays.stream(userIds).filter(Objects::nonNull).distinct().sorted().toList();
        for (Long id : ids) daos.users().findByIdForShare(id);
        for (Long id : ids) daos.members().findForShare(projectId, id);
    }

    private static void validateAssignee(ServiceDaos daos, Long projectId, Long assigneeId) {
        if (assigneeId == null) return;
        User assignee = daos.users().findByIdForShare(assigneeId)
                .orElseThrow(() -> new ValidationException("Assignee does not exist"));
        if (assignee.status() != UserStatus.ACTIVE) throw new ConflictException("Assignee is disabled");
        if (assignee.systemRole() == SystemRole.ADMIN) return;
        ProjectMember member = daos.members().findForShare(projectId, assigneeId)
                .orElseThrow(() -> new ConflictException("Assignee must be an active project DEVELOPER"));
        if (member.status() != MembershipStatus.ACTIVE || member.projectRole() != ProjectRole.DEVELOPER) {
            throw new ConflictException("Assignee must be an active project DEVELOPER");
        }
    }

    private static Defect findDefect(ServiceDaos daos, Long id) {
        return daos.defects().findById(id).orElseThrow(() -> new NotFoundException("Defect does not exist"));
    }

    private static Defect lockDefect(ServiceDaos daos, Long id, Integer suppliedVersion) {
        Defect current = daos.defects().findByIdForUpdate(id)
                .orElseThrow(() -> new NotFoundException("Defect does not exist"));
        if (!Objects.equals(current.lockVersion(), suppliedVersion)) {
            throw new ConflictException("Defect was changed or removed");
        }
        return current;
    }

    private static Defect updateRow(ServiceDaos daos, Defect value) {
        try { return daos.defects().update(value); }
        catch (OptimisticLockException failure) { throw ServiceFailures.stale("Defect", failure); }
    }

    private static Defect copyForStatus(Defect current, DefectStatus status, Long assigneeId,
                                        String resolutionNote, Integer suppliedVersion) {
        return new Defect(current.id(), current.projectId(), current.keyNo(), current.title(),
                current.description(), current.severity(), current.priority(), status, current.reporterId(),
                assigneeId, resolutionNote, current.createdAt(), current.updatedAt(), suppliedVersion);
    }

    private static AttemptContext loadAttemptContext(ServiceDaos daos, Long attemptId) {
        TestAttempt attempt = daos.attempts().findById(attemptId)
                .orElseThrow(() -> new NotFoundException("Attempt does not exist"));
        TestRunCase runCase = daos.runCases().findById(attempt.testRunCaseId())
                .orElseThrow(() -> new NotFoundException("Test run case does not exist"));
        TestRun run = daos.testRuns().findById(runCase.testRunId())
                .orElseThrow(() -> new NotFoundException("Test run does not exist"));
        return new AttemptContext(attempt, runCase, run);
    }

    private static AttemptContext lockAttemptContext(ServiceDaos daos, AttemptContext preliminary) {
        TestCase testCase = daos.testCases().findByIdForUpdate(preliminary.runCase().testCaseId())
                .orElseThrow(() -> new NotFoundException("Test case does not exist"));
        ensureSameProject(testCase.projectId(), preliminary.run().projectId(), "Test case");
        TestRun run = daos.testRuns().findByIdForUpdate(preliminary.run().id())
                .orElseThrow(() -> new NotFoundException("Test run does not exist"));
        TestRunCase runCase = daos.runCases().findByIdForUpdate(preliminary.runCase().id())
                .orElseThrow(() -> new NotFoundException("Test run case does not exist"));
        TestAttempt attempt = daos.attempts().findByIdForUpdate(preliminary.attempt().id())
                .orElseThrow(() -> new NotFoundException("Attempt does not exist"));
        if (!Objects.equals(runCase.testRunId(), run.id())
                || !Objects.equals(attempt.testRunCaseId(), runCase.id())) {
            throw new ConflictException("Attempt execution hierarchy changed");
        }
        return new AttemptContext(attempt, runCase, run);
    }

    private static void validateEvidence(AttemptContext context, Long projectId) {
        ensureSameProject(context.run().projectId(), projectId, "Failure attempt");
        requireFail(context.attempt());
    }

    private static void requireFail(TestAttempt attempt) {
        if (attempt.status() != TestAttemptStatus.FAIL) {
            throw new ConflictException("Defect evidence must be a FAIL attempt");
        }
    }

    private static boolean containsAttempt(List<TestAttemptDefect> links, Long attemptId) {
        return links.stream().anyMatch(link -> Objects.equals(link.attemptId(), attemptId));
    }

    private static List<Long> attemptIds(List<TestAttemptDefect> links) {
        return links.stream().map(TestAttemptDefect::attemptId).sorted().toList();
    }

    private static void ensureSameProject(Long actual, Long expected, String entity) {
        if (!Objects.equals(actual, expected)) throw new ValidationException(entity + " belongs to another project");
    }

    private static void validateVersion(Integer value) {
        if (value == null || value < 0) throw new ValidationException("expectedVersion must be nonnegative");
    }

    private record AttemptContext(TestAttempt attempt, TestRunCase runCase, TestRun run) { }
}
