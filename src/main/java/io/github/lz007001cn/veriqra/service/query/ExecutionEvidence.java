package io.github.lz007001cn.veriqra.service.query;
import io.github.lz007001cn.veriqra.model.*;
import java.util.List;
public record ExecutionEvidence(TestAttempt attempt, TestRunCase runCase, TestRun run,
        List<TestRunCaseStep> steps, TestCase currentCase, boolean currentDefinitionCompatible) {
    public ExecutionEvidence { steps=List.copyOf(steps); }
}
