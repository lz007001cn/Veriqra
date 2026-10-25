package io.github.lz007001cn.veriqra.integration;

import io.github.lz007001cn.veriqra.dao.*;
import io.github.lz007001cn.veriqra.model.*;
import io.github.lz007001cn.veriqra.service.support.ServiceDaos;
import java.time.LocalDateTime;
import java.util.*;

final class ServiceDaoDelegates {
    private ServiceDaoDelegates() { }
    static ServiceDaos requirement(ServiceDaos d, RequirementDao replacement) {
        return new ServiceDaos(d.users(), d.projects(), d.members(), d.counters(), replacement,
                d.testCases(), d.steps(), d.traceability(), d.testPlans(), d.testPlanCases(),
                d.testRuns(), d.runCases(), d.runCaseSteps(), d.attempts(), d.defects(), d.attemptDefects(),
                d.automationIdentities(), d.automationMappings(), d.imports(), d.projectSettings(), d.retestLinks(), d.closureReceipts(), d.closureItems());
    }
    static ServiceDaos steps(ServiceDaos d, TestStepDao replacement) {
        return new ServiceDaos(d.users(), d.projects(), d.members(), d.counters(), d.requirements(),
                d.testCases(), replacement, d.traceability(), d.testPlans(), d.testPlanCases(),
                d.testRuns(), d.runCases(), d.runCaseSteps(), d.attempts(), d.defects(), d.attemptDefects(),
                d.automationIdentities(), d.automationMappings(), d.imports(), d.projectSettings(), d.retestLinks(), d.closureReceipts(), d.closureItems());
    }
    static ServiceDaos traceability(ServiceDaos d, TestCaseRequirementDao replacement) {
        return new ServiceDaos(d.users(), d.projects(), d.members(), d.counters(), d.requirements(),
                d.testCases(), d.steps(), replacement, d.testPlans(), d.testPlanCases(),
                d.testRuns(), d.runCases(), d.runCaseSteps(), d.attempts(), d.defects(), d.attemptDefects(),
                d.automationIdentities(), d.automationMappings(), d.imports(), d.projectSettings(), d.retestLinks(), d.closureReceipts(), d.closureItems());
    }
    static ServiceDaos planCases(ServiceDaos d, TestPlanCaseDao replacement) {
        return new ServiceDaos(d.users(), d.projects(), d.members(), d.counters(), d.requirements(),
                d.testCases(), d.steps(), d.traceability(), d.testPlans(), replacement,
                d.testRuns(), d.runCases(), d.runCaseSteps(), d.attempts(), d.defects(), d.attemptDefects(),
                d.automationIdentities(), d.automationMappings(), d.imports(), d.projectSettings(), d.retestLinks(), d.closureReceipts(), d.closureItems());
    }
    static ServiceDaos testRuns(ServiceDaos d, TestRunDao replacement) {
        return new ServiceDaos(d.users(), d.projects(), d.members(), d.counters(), d.requirements(),
                d.testCases(), d.steps(), d.traceability(), d.testPlans(), d.testPlanCases(),
                replacement, d.runCases(), d.runCaseSteps(), d.attempts(), d.defects(), d.attemptDefects(),
                d.automationIdentities(), d.automationMappings(), d.imports(), d.projectSettings(), d.retestLinks(), d.closureReceipts(), d.closureItems());
    }
    static ServiceDaos runCaseSteps(ServiceDaos d, TestRunCaseStepDao replacement) {
        return new ServiceDaos(d.users(), d.projects(), d.members(), d.counters(), d.requirements(),
                d.testCases(), d.steps(), d.traceability(), d.testPlans(), d.testPlanCases(),
                d.testRuns(), d.runCases(), replacement, d.attempts(), d.defects(), d.attemptDefects(),
                d.automationIdentities(), d.automationMappings(), d.imports(), d.projectSettings(), d.retestLinks(), d.closureReceipts(), d.closureItems());
    }
    static ServiceDaos attempts(ServiceDaos d, TestAttemptDao replacement) {
        return new ServiceDaos(d.users(), d.projects(), d.members(), d.counters(), d.requirements(),
                d.testCases(), d.steps(), d.traceability(), d.testPlans(), d.testPlanCases(),
                d.testRuns(), d.runCases(), d.runCaseSteps(), replacement, d.defects(), d.attemptDefects(),
                d.automationIdentities(), d.automationMappings(), d.imports(), d.projectSettings(), d.retestLinks(), d.closureReceipts(), d.closureItems());
    }
    static ServiceDaos defects(ServiceDaos d, DefectDao replacement) {
        return new ServiceDaos(d.users(), d.projects(), d.members(), d.counters(), d.requirements(),
                d.testCases(), d.steps(), d.traceability(), d.testPlans(), d.testPlanCases(),
                d.testRuns(), d.runCases(), d.runCaseSteps(), d.attempts(), replacement, d.attemptDefects(),
                d.automationIdentities(), d.automationMappings(), d.imports(), d.projectSettings(), d.retestLinks(), d.closureReceipts(), d.closureItems());
    }
    static ServiceDaos attemptDefects(ServiceDaos d, TestAttemptDefectDao replacement) {
        return new ServiceDaos(d.users(), d.projects(), d.members(), d.counters(), d.requirements(),
                d.testCases(), d.steps(), d.traceability(), d.testPlans(), d.testPlanCases(),
                d.testRuns(), d.runCases(), d.runCaseSteps(), d.attempts(), d.defects(), replacement,
                d.automationIdentities(), d.automationMappings(), d.imports(), d.projectSettings(), d.retestLinks(), d.closureReceipts(), d.closureItems());
    }
    static ServiceDaos automationIdentities(ServiceDaos d, TestAutomationIdentityDao replacement) {
        return new ServiceDaos(d.users(), d.projects(), d.members(), d.counters(), d.requirements(),
                d.testCases(), d.steps(), d.traceability(), d.testPlans(), d.testPlanCases(),
                d.testRuns(), d.runCases(), d.runCaseSteps(), d.attempts(), d.defects(), d.attemptDefects(),
                replacement, d.automationMappings(), d.imports(), d.projectSettings(), d.retestLinks(), d.closureReceipts(), d.closureItems());
    }

    abstract static class RequirementDelegate implements RequirementDao {
        final RequirementDao target;
        RequirementDelegate(RequirementDao target) { this.target = target; }
        public Optional<Requirement> findById(Long id) { return target.findById(id); }
        public Optional<Requirement> findByIdForUpdate(Long id) { return target.findByIdForUpdate(id); }
        public Optional<Requirement> findByKey(Long projectId, Long keyNo) { return target.findByKey(projectId, keyNo); }
        public List<Requirement> listByProject(Long projectId) { return target.listByProject(projectId); }
        public Requirement insert(Requirement value) { return target.insert(value); }
        public Requirement update(Requirement value) { return target.update(value); }
    }
    abstract static class StepDelegate implements TestStepDao {
        final TestStepDao target;
        StepDelegate(TestStepDao target) { this.target = target; }
        public TestStep add(TestStep value) { return target.add(value); }
        public Optional<TestStep> find(Long caseId, Integer order) { return target.find(caseId, order); }
        public List<TestStep> listByTestCase(Long caseId) { return target.listByTestCase(caseId); }
        public List<TestStep> listByTestCaseForShare(Long caseId) { return target.listByTestCaseForShare(caseId); }
        public boolean updateContent(TestStep value) { return target.updateContent(value); }
        public boolean remove(Long caseId, Integer order) { return target.remove(caseId, order); }
        public int deleteByTestCase(Long caseId) { return target.deleteByTestCase(caseId); }
    }
    abstract static class TraceabilityDelegate implements TestCaseRequirementDao {
        final TestCaseRequirementDao target;
        TraceabilityDelegate(TestCaseRequirementDao target) { this.target = target; }
        public TestCaseRequirement add(TestCaseRequirement value) { return target.add(value); }
        public Optional<TestCaseRequirement> find(Long r, Long c) { return target.find(r, c); }
        public boolean existsRecord(Long r, Long c) { return target.existsRecord(r, c); }
        public List<TestCaseRequirement> listByRequirement(Long r) { return target.listByRequirement(r); }
        public List<TestCaseRequirement> listByTestCase(Long c) { return target.listByTestCase(c); }
        public boolean updateReviewState(Long r, Long c, TraceabilityStatus s, Long by, LocalDateTime at) {
            return target.updateReviewState(r, c, s, by, at);
        }
        public boolean markRemoved(Long r, Long c) { return target.markRemoved(r, c); }
        public int markConfirmedNeedsReviewByRequirement(Long r) { return target.markConfirmedNeedsReviewByRequirement(r); }
        public int markConfirmedNeedsReviewByTestCase(Long c) { return target.markConfirmedNeedsReviewByTestCase(c); }
    }
    abstract static class PlanCaseDelegate implements TestPlanCaseDao {
        final TestPlanCaseDao target;
        PlanCaseDelegate(TestPlanCaseDao target) { this.target = target; }
        public TestPlanCase add(TestPlanCase value) { return target.add(value); }
        public Optional<TestPlanCase> find(Long p, Long c) { return target.find(p, c); }
        public boolean exists(Long p, Long c) { return target.exists(p, c); }
        public List<TestPlanCase> listByTestPlan(Long p) { return target.listByTestPlan(p); }
        public List<TestPlanCase> listByTestPlanForUpdate(Long p) { return target.listByTestPlanForUpdate(p); }
        public List<TestPlanCase> listByTestCase(Long c) { return target.listByTestCase(c); }
        public boolean remove(Long p, Long c) { return target.remove(p, c); }
    }
    abstract static class TestRunDelegate implements TestRunDao {
        final TestRunDao target;
        TestRunDelegate(TestRunDao target) { this.target = target; }
        public Optional<TestRun> findById(Long id) { return target.findById(id); }
        public Optional<TestRun> findByIdForUpdate(Long id) { return target.findByIdForUpdate(id); }
        public List<TestRun> listByProject(Long id) { return target.listByProject(id); }
        public List<TestRun> listByProjectForUpdate(Long id) { return target.listByProjectForUpdate(id); }
        public List<TestRun> listByPlan(Long id) { return target.listByPlan(id); }
        public TestRun insert(TestRun value) { return target.insert(value); }
        public TestRun update(TestRun value) { return target.update(value); }
    }
    abstract static class RunCaseStepDelegate implements TestRunCaseStepDao {
        final TestRunCaseStepDao target;
        RunCaseStepDelegate(TestRunCaseStepDao target) { this.target = target; }
        public TestRunCaseStep insert(TestRunCaseStep value) { return target.insert(value); }
        public Optional<TestRunCaseStep> find(Long id, Integer order) { return target.find(id, order); }
        public List<TestRunCaseStep> listByRunCase(Long id) { return target.listByRunCase(id); }
        public List<TestRunCaseStep> listByRunCaseForShare(Long id) { return target.listByRunCaseForShare(id); }
    }
    abstract static class RunCaseDelegate implements TestRunCaseDao {
        final TestRunCaseDao target;
        RunCaseDelegate(TestRunCaseDao target) { this.target = target; }
        public Optional<TestRunCase> findById(Long id) { return target.findById(id); }
        public Optional<TestRunCase> findByIdForUpdate(Long id) { return target.findByIdForUpdate(id); }
        public Optional<TestRunCase> findByRunAndCase(Long run, Long testCase) { return target.findByRunAndCase(run, testCase); }
        public List<TestRunCase> listByRun(Long run) { return target.listByRun(run); }
        public List<TestRunCase> listByRunForUpdate(Long run) { return target.listByRunForUpdate(run); }
        public List<TestRunCase> listByTestCase(Long testCase) { return target.listByTestCase(testCase); }
        public TestRunCase insert(TestRunCase value) { return target.insert(value); }
    }
    abstract static class AttemptDelegate implements TestAttemptDao {
        final TestAttemptDao target;
        AttemptDelegate(TestAttemptDao target) { this.target = target; }
        public Optional<TestAttempt> findById(Long id) { return target.findById(id); }
        public Optional<TestAttempt> findByIdForUpdate(Long id) { return target.findByIdForUpdate(id); }
        public List<TestAttempt> listByRunCase(Long id) { return target.listByRunCase(id); }
        public List<TestAttempt> listByRunCaseForUpdate(Long id) { return target.listByRunCaseForUpdate(id); }
        public List<TestAttempt> listByImport(Long id) { return target.listByImport(id); }
        public Optional<TestAttempt> findLatestByRunCase(Long id) { return target.findLatestByRunCase(id); }
        public Optional<TestAttempt> findLatestByRunCaseForUpdate(Long id) { return target.findLatestByRunCaseForUpdate(id); }
        public Optional<TestAttempt> findBySubmissionKey(java.util.UUID key) { return target.findBySubmissionKey(key); }
        public boolean hasAutomationMappingReferenceForUpdate(Long id) {
            return target.hasAutomationMappingReferenceForUpdate(id);
        }
        public TestAttempt insert(TestAttempt value) { return target.insert(value); }
    }
    abstract static class DefectDelegate implements DefectDao {
        final DefectDao target;
        DefectDelegate(DefectDao target) { this.target = target; }
        public Optional<Defect> findById(Long id) { return target.findById(id); }
        public Optional<Defect> findByIdForUpdate(Long id) { return target.findByIdForUpdate(id); }
        public Optional<Defect> findByKey(Long p, Long k) { return target.findByKey(p, k); }
        public List<Defect> listByProject(Long p) { return target.listByProject(p); }
        public Defect insert(Defect value) { return target.insert(value); }
        public Defect update(Defect value) { return target.update(value); }
    }

    abstract static class AutomationIdentityDelegate implements TestAutomationIdentityDao {
        protected final TestAutomationIdentityDao target;
        AutomationIdentityDelegate(TestAutomationIdentityDao target) { this.target = target; }
        public TestAutomationIdentity insert(TestAutomationIdentity value) { return target.insert(value); }
        public Optional<TestAutomationIdentity> findById(Long id) { return target.findById(id); }
        public Optional<TestAutomationIdentity> findByExternalKey(Long projectId, AutomationSource source,
                                                                  String namespace, String externalKey) {
            return target.findByExternalKey(projectId, source, namespace, externalKey);
        }
        public List<TestAutomationIdentity> listByProject(Long projectId) { return target.listByProject(projectId); }
        public Optional<TestAutomationIdentity> findByIdForUpdate(Long id) { return target.findByIdForUpdate(id); }
    }
    abstract static class AttemptDefectDelegate implements TestAttemptDefectDao {
        final TestAttemptDefectDao target;
        AttemptDefectDelegate(TestAttemptDefectDao target) { this.target = target; }
        public TestAttemptDefect add(TestAttemptDefect value) { return target.add(value); }
        public Optional<TestAttemptDefect> find(Long a, Long d) { return target.find(a, d); }
        public boolean existsRecord(Long a, Long d) { return target.existsRecord(a, d); }
        public List<TestAttemptDefect> listDefectsByAttempt(Long a) { return target.listDefectsByAttempt(a); }
        public List<TestAttemptDefect> listAttemptsByDefect(Long d) { return target.listAttemptsByDefect(d); }
        public List<TestAttemptDefect> listAttemptsByDefectForUpdate(Long d) {
            return target.listAttemptsByDefectForUpdate(d);
        }
        public boolean remove(Long a, Long d) { return target.remove(a, d); }
    }
}
