package io.github.lz007001cn.veriqra.service.ai;

import io.github.lz007001cn.veriqra.model.*;
import io.github.lz007001cn.veriqra.service.exception.*;
import io.github.lz007001cn.veriqra.service.support.*;
import java.util.*;

/** Generation holds no database connection. Accept is one transaction for the whole selection. */
public final class AiCaseService {
    private final ServiceTransaction transactions;
    private final ServiceDaoFactory factory;
    private final ProjectAccessPolicy access;
    private final AiProvider provider;
    public AiCaseService(ServiceTransaction transactions, ServiceDaoFactory factory, ProjectAccessPolicy access, AiProvider provider) {
        this.transactions = transactions; this.factory = factory; this.access = access; this.provider = provider;
    }
    public record Preview(Long requirementId, Integer expectedVersion, List<AiCandidate> candidates) { }
    public Preview generate(Long actor, Long project, Long requirementId, String instruction) {
        ServiceValidation.optionalText(instruction, 2000, "instruction");
        Requirement requirement = transactions.execute(c -> requirement(factory.create(c), actor, project, requirementId, false));
        List<AiCandidate> candidates = provider.generate(requirement, instruction);
        try { validate(candidates, 3); }
        catch (ValidationException e) { throw new AiUnavailableException("AI_INVALID_RESPONSE"); }
        return new Preview(requirement.id(), requirement.lockVersion(), candidates);
    }
    public List<TestCase> accept(Long actor, Long project, Long requirementId, Integer version, List<AiCandidate> candidates) {
        ServiceValidation.required(version, "expectedVersion");
        validate(candidates, 1);
        return transactions.execute(c -> {
            ServiceDaos daos = factory.create(c);
            Requirement requirement = requirement(daos, actor, project, requirementId, true);
            if (!Objects.equals(version, requirement.lockVersion())) throw new ConflictException("Requirement changed; generate or review against the latest version");
            List<TestCase> saved = new ArrayList<>();
            for (AiCandidate item : candidates) {
                long key = daos.counters().allocateNext(project, CounterEntityType.TC);
                TestCase row = daos.testCases().insert(new TestCase(null, project, key, item.title(), item.description(),
                        item.preconditions(), item.priority(), TestCaseStatus.DRAFT, actor, null, null, null));
                for (var step : item.steps()) daos.steps().add(new TestStep(row.id(), step.stepOrder(), step.action(), step.expectedResult()));
                daos.traceability().add(new TestCaseRequirement(requirement.id(), row.id(), TraceabilityStatus.NEEDS_REVIEW,
                        actor, null, null, null, null));
                saved.add(row);
            }
            return List.copyOf(saved);
        });
    }
    private Requirement requirement(ServiceDaos daos, Long actor, Long projectId, Long id, boolean lock) {
        Project project = daos.projects().findByIdForShare(projectId).orElseThrow(() -> new NotFoundException("Project does not exist"));
        access.requireAssetWrite(daos.users(), daos.members(), actor, project.id());
        if (project.status() != ProjectStatus.ACTIVE) throw new ConflictException("Archived project is read-only");
        Requirement row = (lock ? daos.requirements().findByIdForUpdate(id) : daos.requirements().findById(id))
                .filter(r -> Objects.equals(r.projectId(), projectId)).orElseThrow(() -> new NotFoundException("Requirement does not exist in project"));
        if (row.status() == RequirementStatus.ARCHIVED) throw new ConflictException("Archived requirement is read-only");
        return row;
    }
    public static void validate(List<AiCandidate> candidates, int minimum) {
        if (candidates == null || candidates.size() < minimum || candidates.size() > 5) throw new ValidationException("Choose one to five candidates");
        for (AiCandidate item : candidates) {
            ServiceValidation.required(item, "candidate");
            ServiceValidation.requiredText(item.title(), 240, "title");
            ServiceValidation.optionalText(item.description(), 16000, "description");
            ServiceValidation.optionalText(item.preconditions(), 16000, "preconditions");
            ServiceValidation.required(item.priority(), "priority");
            if (item.steps() == null || item.steps().isEmpty() || item.steps().size() > 30) throw new ValidationException("Each candidate requires 1 to 30 steps");
            for (var step : ServiceValidation.steps(item.steps())) {
                ServiceValidation.requiredText(step.action(), 8000, "action");
                ServiceValidation.requiredText(step.expectedResult(), 8000, "expectedResult");
            }
        }
    }
}
