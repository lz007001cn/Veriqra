package io.github.lz007001cn.veriqra.service.command;

import java.util.List;

public record CreateAdHocRunCommand(Long projectId, String name, String environment,
                                    String buildVersion, List<Long> testCaseIds, Long assigneeId) {
    public CreateAdHocRunCommand(Long projectId, String name, String environment, String buildVersion, List<Long> testCaseIds) {
        this(projectId, name, environment, buildVersion, testCaseIds, null);
    }
    public CreateAdHocRunCommand { testCaseIds = testCaseIds == null ? null : List.copyOf(testCaseIds); }
}
