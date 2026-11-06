package io.github.lz007001cn.veriqra.web.dto;
import io.github.lz007001cn.veriqra.model.*;
import java.util.*;
public record CreateRunRequest(String name, String environment, String buildVersion, Long testPlanId, List<Long> testCaseIds, Long assigneeId) {
    public CreateRunRequest {
        Objects.requireNonNull(name, "name");
        if ((testPlanId == null) == (testCaseIds == null)) throw new IllegalArgumentException("Choose exactly one run origin");
        if (testCaseIds != null) testCaseIds = List.copyOf(testCaseIds);
    }
}
