package io.github.lz007001cn.veriqra.service.query;
import java.util.List;
public record RetestCandidates(Long failureAttemptId, List<Candidate> candidates, Long nextCursor) {
    public RetestCandidates{candidates=List.copyOf(candidates);}
    public record Candidate(ExecutionEvidence execution, List<String> reasons,
                            boolean eligible, boolean requiresImportConfirmation) {
        public Candidate{reasons=List.copyOf(reasons);}
    }
}
