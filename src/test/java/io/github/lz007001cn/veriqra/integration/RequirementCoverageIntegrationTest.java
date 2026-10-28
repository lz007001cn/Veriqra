package io.github.lz007001cn.veriqra.integration;

import io.github.lz007001cn.veriqra.dao.jdbc.JdbcTestCaseRequirementDao;
import io.github.lz007001cn.veriqra.model.*;
import io.github.lz007001cn.veriqra.service.command.*;
import org.junit.jupiter.api.Test;
import java.time.LocalDateTime;
import java.util.List;
import static org.junit.jupiter.api.Assertions.*;

class RequirementCoverageIntegrationTest extends ServiceFixture {
    private Requirement active(User actor, Project project, String title) {
        Requirement r = createRequirement(actor, project, title);
        return requirements.update(actor.id(), new UpdateRequirementCommand(r.id(), r.title(), r.description(),
                r.priority(), RequirementStatus.ACTIVE, r.lockVersion()));
    }
    private void confirm(User actor, Requirement requirement, TestCase testCase) {
        traceability.attach(actor.id(), requirement.id(), testCase.id());
        traceability.confirm(actor.id(), requirement.id(), testCase.id());
    }
    private long count(User actor, Project project, Requirement requirement) {
        return traceability.listCoverageByProject(actor.id(), project.id()).stream()
                .filter(row -> row.requirementId().equals(requirement.id())).findFirst().orElseThrow().confirmedCaseCount();
    }
    private TestCase updateCase(User actor, TestCase current, String title, TestCaseStatus status) {
        return testCases.update(actor.id(), new UpdateTestCaseCommand(current.id(), title, current.description(),
                current.preconditions(), current.priority(), status, current.lockVersion(),
                List.of(new TestStepInput(1, "action 1", "expected 1"))));
    }

    @Test void coverageRequiresActiveRequirementCurrentReviewAndSameProjectReadyCase() {
        User admin = actor("coverage-admin", SystemRole.ADMIN, UserStatus.ACTIVE);
        User developer = actor("coverage-developer", SystemRole.USER, UserStatus.ACTIVE);
        Project project = createProject(admin, "COVER", developer, ProjectRole.DEVELOPER);
        Requirement requirement = active(admin, project, "Covered");
        Requirement empty = active(admin, project, "Empty");
        Requirement draftRequirement = createRequirement(admin, project, "Draft requirement");
        Requirement archivedRequirement = active(admin, project, "Archived requirement");
        TestCase ready = readyCase(admin, project, "Ready confirmed", 1);
        confirm(admin, requirement, ready);
        confirm(admin, draftRequirement, ready);
        confirm(admin, archivedRequirement, ready);
        requirements.update(admin.id(), new UpdateRequirementCommand(archivedRequirement.id(), archivedRequirement.title(),
                archivedRequirement.description(), archivedRequirement.priority(), RequirementStatus.ARCHIVED, archivedRequirement.lockVersion()));

        TestCase draft = createCase(admin, project, "Draft confirmed", 1);
        confirm(admin, requirement, draft);
        TestCase archived = readyCase(admin, project, "Archived confirmed", 1);
        confirm(admin, requirement, archived);
        updateCase(admin, archived, archived.title(), TestCaseStatus.ARCHIVED);
        TestCase pending = readyCase(admin, project, "Pending review", 1);
        traceability.attach(admin.id(), requirement.id(), pending.id());
        TestCase removed = readyCase(admin, project, "Removed review", 1);
        confirm(admin, requirement, removed);
        traceability.remove(admin.id(), requirement.id(), removed.id());
        Project other = createProject(admin, "OTHER", null, null);
        TestCase foreign = readyCase(admin, other, "Other project", 1);
        tx.inTransaction(c -> new JdbcTestCaseRequirementDao(c).add(new TestCaseRequirement(requirement.id(), foreign.id(),
                TraceabilityStatus.CONFIRMED, admin.id(), null, admin.id(), LocalDateTime.now(clock), null)));

        assertEquals(List.of(new RequirementCoverage(requirement.id(), 1), new RequirementCoverage(empty.id(), 0),
                        new RequirementCoverage(draftRequirement.id(), 0), new RequirementCoverage(archivedRequirement.id(), 0)),
                traceability.listCoverageByProject(developer.id(), project.id()));
        assertEquals(0, count(admin, project, empty));
        assertEquals(List.of(), traceability.listCoverageByProject(admin.id(), createProject(admin, "EMPTY", null, null).id()));
    }

    @Test void semanticEditsInvalidateCoverageWhileStatusAndPriorityChangesKeepTheReview() {
        User admin = actor("coverage-edit-admin", SystemRole.ADMIN, UserStatus.ACTIVE);
        Project project = createProject(admin, "COVEDIT", null, null);
        Requirement requirement = active(admin, project, "Original requirement");
        TestCase testCase = readyCase(admin, project, "Original case", 1);
        confirm(admin, requirement, testCase);
        assertEquals(1, count(admin, project, requirement));

        requirement = requirements.update(admin.id(), new UpdateRequirementCommand(requirement.id(), requirement.title(),
                requirement.description(), Priority.HIGH, RequirementStatus.ACTIVE, requirement.lockVersion()));
        assertEquals(1, count(admin, project, requirement));
        requirement = requirements.update(admin.id(), new UpdateRequirementCommand(requirement.id(), "Changed requirement",
                requirement.description(), requirement.priority(), RequirementStatus.ACTIVE, requirement.lockVersion()));
        assertEquals(0, count(admin, project, requirement));
        traceability.confirm(admin.id(), requirement.id(), testCase.id());
        assertEquals(1, count(admin, project, requirement));

        testCase = updateCase(admin, testCase, "Changed case", TestCaseStatus.READY);
        assertEquals(TestCaseStatus.DRAFT, testCase.status());
        assertEquals(0, count(admin, project, requirement));
        testCase = updateCase(admin, testCase, testCase.title(), TestCaseStatus.READY);
        assertEquals(0, count(admin, project, requirement));
        traceability.confirm(admin.id(), requirement.id(), testCase.id());
        assertEquals(1, count(admin, project, requirement));
    }
}
