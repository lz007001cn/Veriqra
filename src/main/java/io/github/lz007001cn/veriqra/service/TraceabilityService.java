package io.github.lz007001cn.veriqra.service;

import io.github.lz007001cn.veriqra.model.TestCaseRequirement;

public interface TraceabilityService {
    java.util.List<CaseRequirementDetails> listByTestCase(Long actorUserId, Long projectId, Long testCaseId);
    java.util.List<TraceabilityDetails> listByRequirement(Long actorUserId, Long projectId, Long requirementId);
    TestCaseRequirement attach(Long actorUserId, Long projectId, Long requirementId, Long testCaseId);
    TestCaseRequirement remove(Long actorUserId, Long projectId, Long requirementId, Long testCaseId);
    TestCaseRequirement confirm(Long actorUserId, Long projectId, Long requirementId, Long testCaseId);
    TestCaseRequirement attach(Long actorUserId, Long requirementId, Long testCaseId);
    TestCaseRequirement remove(Long actorUserId, Long requirementId, Long testCaseId);
    TestCaseRequirement confirm(Long actorUserId, Long requirementId, Long testCaseId);
    boolean isActiveLink(Long actorUserId, Long requirementId, Long testCaseId);
    boolean isConfirmedLink(Long actorUserId, Long requirementId, Long testCaseId);
}
