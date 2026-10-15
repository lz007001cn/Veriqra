package io.github.lz007001cn.veriqra.service.query;
import io.github.lz007001cn.veriqra.model.*;
import java.util.List;
public record ClosureEligibility(Defect defect, Integer defectVersion, boolean canClose,
        List<String> reasons, List<Failure> failures, List<History> history, boolean legacyClosed) {
    public ClosureEligibility {reasons=List.copyOf(reasons);failures=List.copyOf(failures);history=List.copyOf(history);}
    public record Failure(ExecutionEvidence source, ExecutionEvidence selectedPass, RetestSelection selection,
            List<String> reasons, boolean eligible, boolean canRetestOriginal, boolean currentCaseCompatible) {
        public Failure {reasons=List.copyOf(reasons);}
    }
    public record History(DefectClosureReceipt receipt, List<ClosedEvidence> items) {public History{items=List.copyOf(items);}}
    public record ClosedEvidence(ExecutionEvidence failure, ExecutionEvidence pass,
                                 Long retestLinkId, DefectClosureEvidencePolicy policy) { }
}
