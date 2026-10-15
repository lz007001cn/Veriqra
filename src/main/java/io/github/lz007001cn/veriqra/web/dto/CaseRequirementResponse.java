package io.github.lz007001cn.veriqra.web.dto;

import io.github.lz007001cn.veriqra.model.TraceabilityStatus;
import io.github.lz007001cn.veriqra.service.CaseRequirementDetails;

public record CaseRequirementResponse(Long testCaseId, RequirementResponse requirement, TraceabilityStatus status) {
    public static CaseRequirementResponse from(CaseRequirementDetails value) {
        return new CaseRequirementResponse(value.link().testCaseId(), RequirementResponse.from(value.requirement()),
                value.link().status());
    }
}
