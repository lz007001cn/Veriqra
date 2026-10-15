package io.github.lz007001cn.veriqra.service;

import io.github.lz007001cn.veriqra.model.*;
import io.github.lz007001cn.veriqra.service.command.*;
import java.util.List;
import java.util.Optional;
import java.util.UUID;
import io.github.lz007001cn.veriqra.service.query.*;

public interface DefectService {
    List<Defect> listForAttempt(Long actorUserId, Long projectId, Long runId, Long runCaseId, Long attemptId);
    ClosureEligibility closureEligibility(Long actorUserId, Long projectId, Long defectId);
    RetestCandidates retestCandidates(Long actorUserId, Long projectId, Long defectId, Long failureAttemptId, Long cursor, int pageSize);
    RetestOperationResult linkRetest(Long actorUserId, Long projectId, LinkRetestCommand command);
    RetestOperationResult revokeRetest(Long actorUserId, Long projectId, RevokeRetestCommand command);
    Optional<RetestOperationResult> recoverRetestOperation(Long actorUserId, Long projectId, Long defectId, UUID requestKey, String action);
    TestAttemptDefect addEvidence(Long actorUserId, Long projectId, Long defectId, Long failureAttemptId, Integer expectedVersion);
    void removeEvidence(Long actorUserId, Long projectId, Long defectId, Long failureAttemptId, Integer expectedVersion);
    io.github.lz007001cn.veriqra.service.query.DefectDetails getDetails(Long actorUserId, Long projectId, Long defectId);
    Defect update(Long actorUserId, Long projectId, UpdateDefectCommand command);
    Defect transition(Long actorUserId, Long projectId, TransitionDefectCommand command);
    Defect reopen(Long actorUserId, Long projectId, ReopenDefectCommand command);
    TestAttemptDefect addEvidence(Long actorUserId, Long projectId, Long defectId, Long failureAttemptId);
    void removeEvidence(Long actorUserId, Long projectId, Long defectId, Long failureAttemptId);
    Defect create(Long actorUserId, CreateDefectCommand command);
    Defect get(Long actorUserId, Long defectId);
    List<Defect> listByProject(Long actorUserId, Long projectId);
    Defect update(Long actorUserId, UpdateDefectCommand command);
    Defect transition(Long actorUserId, TransitionDefectCommand command);
    Defect reopen(Long actorUserId, ReopenDefectCommand command);
    TestAttemptDefect addEvidence(Long actorUserId, Long defectId, Long failureAttemptId);
    void removeEvidence(Long actorUserId, Long defectId, Long failureAttemptId);
    List<TestAttemptDefect> listEvidence(Long actorUserId, Long defectId);
    List<TestAttemptDefect> listDefectsForAttempt(Long actorUserId, Long attemptId);
}
