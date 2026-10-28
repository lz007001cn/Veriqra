package io.github.lz007001cn.veriqra.service.support;

import io.github.lz007001cn.veriqra.dao.*;

/** Connection-scoped DAO set. Every DAO in one instance shares the caller's transaction. */
public record ServiceDaos(UserDao users, ProjectDao projects, ProjectMemberDao members,
                           ProjectCounterDao counters, RequirementDao requirements,
                           TestCaseDao testCases, TestStepDao steps,
                           TestCaseRequirementDao traceability,
                           TestPlanDao testPlans, TestPlanCaseDao testPlanCases,
                           TestRunDao testRuns, TestRunCaseDao runCases,
                           TestRunCaseStepDao runCaseSteps, TestAttemptDao attempts,
                           DefectDao defects, TestAttemptDefectDao attemptDefects,
                           TestAutomationIdentityDao automationIdentities,
                           TestAutomationMappingDao automationMappings,
                           TestImportDao imports, ProjectSettingsDao projectSettings,
                           DefectRetestLinkDao retestLinks, DefectClosureReceiptDao closureReceipts,
                           DefectClosureItemDao closureItems) { }
