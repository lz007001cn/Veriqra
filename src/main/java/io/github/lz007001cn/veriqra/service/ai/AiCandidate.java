package io.github.lz007001cn.veriqra.service.ai;

import io.github.lz007001cn.veriqra.model.Priority;
import io.github.lz007001cn.veriqra.service.command.TestStepInput;
import java.util.List;

public record AiCandidate(String title, String description, String preconditions,
                          Priority priority, List<TestStepInput> steps) { }
