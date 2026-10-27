package io.github.lz007001cn.veriqra.service;

import io.github.lz007001cn.veriqra.model.*;
import io.github.lz007001cn.veriqra.service.exception.*;
import io.github.lz007001cn.veriqra.service.support.*;
import java.time.*;
import java.util.Objects;

public final class DefaultTraceabilityService implements TraceabilityService {
    private final ServiceTransaction transactions;
    private final ServiceDaoFactory daoFactory;
    private final ProjectAccessPolicy access;
    private final Clock clock;

    public DefaultTraceabilityService(ServiceTransaction transactions, ServiceDaoFactory daoFactory,
                                      ProjectAccessPolicy access, Clock clock) {
        this.transactions = Objects.requireNonNull(transactions);
        this.daoFactory = Objects.requireNonNull(daoFactory);
        this.access = Objects.requireNonNull(access);
        this.clock = Objects.requireNonNull(clock);
    }

    @Override public java.util.List<RequirementCoverage> listCoverageByProject(Long actorUserId, Long projectId) {
        ServiceValidation.required(projectId, "projectId");
        return transactions.execute(connection -> {
            ServiceDaos daos = daoFactory.create(connection);
            daos.projects().findById(projectId).orElseThrow(() -> new NotFoundException("Project does not exist"));
            access.requireProjectRead(daos.users(), daos.members(), actorUserId, projectId);
            return daos.traceability().listCoverageByProject(projectId);
        });
    }

    @Override public TestCaseRequirement attach(Long actorUserId, Long requirementId, Long testCaseId) {
        return attach(actorUserId, null, requirementId, testCaseId);
    }

    @Override public TestCaseRequirement attach(Long actorUserId, Long projectId, Long requirementId, Long testCaseId) {
        return transactions.execute(connection -> {
            ServiceDaos daos = daoFactory.create(connection);
            lockWritableEndpoints(daos, actorUserId, projectId, requirementId, testCaseId);
            var existing = daos.traceability().find(requirementId, testCaseId);
            if (existing.isEmpty()) {
                return daos.traceability().add(new TestCaseRequirement(requirementId, testCaseId,
                        TraceabilityStatus.NEEDS_REVIEW, actorUserId, null, null, null, null));
            }
            if (existing.get().status() != TraceabilityStatus.REMOVED) {
                throw new ConflictException("Traceability link is already active");
            }
            if (!daos.traceability().updateReviewState(requirementId, testCaseId,
                    TraceabilityStatus.NEEDS_REVIEW, null, null)) {
                throw new ConflictException("Traceability link changed during reattach");
            }
            return daos.traceability().find(requirementId, testCaseId).orElseThrow();
        });
    }

    @Override public TestCaseRequirement remove(Long actorUserId, Long requirementId, Long testCaseId) {
        return remove(actorUserId, null, requirementId, testCaseId);
    }

    @Override public TestCaseRequirement remove(Long actorUserId, Long projectId, Long requirementId, Long testCaseId) {
        return transactions.execute(connection -> {
            ServiceDaos daos = daoFactory.create(connection);
            lockWritableEndpoints(daos, actorUserId, projectId, requirementId, testCaseId);
            TestCaseRequirement existing = daos.traceability().find(requirementId, testCaseId)
                    .orElseThrow(() -> new NotFoundException("Traceability link does not exist"));
            if (existing.status() == TraceabilityStatus.REMOVED) return existing;
            if (!daos.traceability().markRemoved(requirementId, testCaseId)) {
                throw new ConflictException("Traceability link changed during removal");
            }
            return daos.traceability().find(requirementId, testCaseId).orElseThrow();
        });
    }

    @Override public TestCaseRequirement confirm(Long actorUserId, Long requirementId, Long testCaseId) {
        return confirm(actorUserId, null, requirementId, testCaseId);
    }

    @Override public TestCaseRequirement confirm(Long actorUserId, Long projectId, Long requirementId, Long testCaseId) {
        return transactions.execute(connection -> {
            ServiceDaos daos = daoFactory.create(connection);
            lockWritableEndpoints(daos, actorUserId, projectId, requirementId, testCaseId);
            TestCaseRequirement existing = daos.traceability().find(requirementId, testCaseId)
                    .orElseThrow(() -> new NotFoundException("Traceability link does not exist"));
            if (existing.status() != TraceabilityStatus.NEEDS_REVIEW) {
                throw new ConflictException("Only NEEDS_REVIEW traceability can be confirmed");
            }
            if (!daos.traceability().updateReviewState(requirementId, testCaseId,
                    TraceabilityStatus.CONFIRMED, actorUserId, LocalDateTime.now(clock))) {
                throw new ConflictException("Traceability link changed during confirmation");
            }
            return daos.traceability().find(requirementId, testCaseId).orElseThrow();
        });
    }

    @Override public boolean isActiveLink(Long actorUserId, Long requirementId, Long testCaseId) {
        return readState(actorUserId, requirementId, testCaseId, false);
    }

    @Override public boolean isConfirmedLink(Long actorUserId, Long requirementId, Long testCaseId) {
        return readState(actorUserId, requirementId, testCaseId, true);
    }

    private boolean readState(Long actorUserId, Long requirementId, Long testCaseId, boolean confirmedOnly) {
        ServiceValidation.required(requirementId, "requirementId");
        ServiceValidation.required(testCaseId, "testCaseId");
        return transactions.execute(connection -> {
            ServiceDaos daos = daoFactory.create(connection);
            Requirement requirement = daos.requirements().findById(requirementId)
                    .orElseThrow(() -> new NotFoundException("Requirement does not exist"));
            TestCase testCase = daos.testCases().findById(testCaseId)
                    .orElseThrow(() -> new NotFoundException("Test case does not exist"));
            access.requireProjectRead(daos.users(), daos.members(), actorUserId, requirement.projectId());
            if (!Objects.equals(requirement.projectId(), testCase.projectId())) return false;
            return daos.traceability().find(requirementId, testCaseId)
                    .map(link -> confirmedOnly ? link.status() == TraceabilityStatus.CONFIRMED
                            : link.status() != TraceabilityStatus.REMOVED)
                    .orElse(false);
        });
    }

    @Override public java.util.List<TraceabilityDetails> listByRequirement(Long actorUserId, Long projectId, Long requirementId) {
        ServiceValidation.required(projectId, "projectId");
        ServiceValidation.required(requirementId, "requirementId");
        return transactions.execute(connection -> {
            ServiceDaos daos = daoFactory.create(connection);
            Requirement requirement = daos.requirements().findById(requirementId)
                    .orElseThrow(() -> new NotFoundException("Requirement does not exist"));
            access.requireProjectRead(daos.users(), daos.members(), actorUserId, requirement.projectId());
            ProjectOwnership.require(requirement.projectId(), projectId);
            return daos.traceability().listByRequirement(requirementId).stream().map(link -> {
                TestCase testCase = daos.testCases().findById(link.testCaseId())
                        .orElseThrow(() -> new NotFoundException("Test case does not exist"));
                ProjectOwnership.require(testCase.projectId(), projectId);
                return new TraceabilityDetails(testCase, link);
            }).toList();
        });
    }

    @Override public java.util.List<CaseRequirementDetails> listByTestCase(Long actorUserId, Long projectId, Long testCaseId) {
        ServiceValidation.required(projectId, "projectId");
        ServiceValidation.required(testCaseId, "testCaseId");
        return transactions.execute(connection -> {
            ServiceDaos daos = daoFactory.create(connection);
            access.requireProjectRead(daos.users(), daos.members(), actorUserId, projectId);
            TestCase testCase = daos.testCases().findById(testCaseId)
                    .filter(value -> Objects.equals(value.projectId(), projectId))
                    .orElseThrow(() -> new NotFoundException("Test case does not exist in project"));
            return daos.traceability().listByTestCase(testCase.id()).stream().map(link -> {
                Requirement requirement = daos.requirements().findById(link.requirementId())
                        .filter(value -> Objects.equals(value.projectId(), projectId))
                        .orElseThrow(() -> new NotFoundException("Requirement does not exist in project"));
                return new CaseRequirementDetails(requirement, link);
            }).toList();
        });
    }

    private LockedEndpoints lockWritableEndpoints(ServiceDaos daos, Long actorUserId, Long projectId,
                                                    Long requirementId, Long testCaseId) {
        ServiceValidation.required(requirementId, "requirementId");
        ServiceValidation.required(testCaseId, "testCaseId");
        Requirement preliminaryRequirement = daos.requirements().findById(requirementId)
                .orElseThrow(() -> new NotFoundException("Requirement does not exist"));
        TestCase preliminaryCase = daos.testCases().findById(testCaseId)
                .orElseThrow(() -> new NotFoundException("Test case does not exist"));
        if (!Objects.equals(preliminaryRequirement.projectId(), preliminaryCase.projectId())) {
            throw new ValidationException("Requirement and test case must belong to the same project");
        }
        Project project = daos.projects().findByIdForShare(preliminaryRequirement.projectId())
                .orElseThrow(() -> new NotFoundException("Project does not exist"));
        access.requireAssetWrite(daos.users(), daos.members(), actorUserId, project.id());
        ProjectOwnership.require(project.id(), projectId);
        if (project.status() != ProjectStatus.ACTIVE) throw new ConflictException("Archived project is read-only");
        Requirement requirement = daos.requirements().findByIdForUpdate(requirementId)
                .orElseThrow(() -> new NotFoundException("Requirement does not exist"));
        TestCase testCase = daos.testCases().findByIdForUpdate(testCaseId)
                .orElseThrow(() -> new NotFoundException("Test case does not exist"));
        if (!Objects.equals(requirement.projectId(), project.id()) || !Objects.equals(testCase.projectId(), project.id())) {
            throw new ConflictException("Traceability endpoints changed project");
        }
        if (requirement.status() == RequirementStatus.ARCHIVED || testCase.status() == TestCaseStatus.ARCHIVED) {
            throw new ConflictException("Archived assets cannot change traceability");
        }
        return new LockedEndpoints(requirement, testCase);
    }

    private record LockedEndpoints(Requirement requirement, TestCase testCase) { }
}
