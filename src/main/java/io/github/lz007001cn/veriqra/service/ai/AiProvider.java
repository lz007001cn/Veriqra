package io.github.lz007001cn.veriqra.service.ai;

import io.github.lz007001cn.veriqra.model.Requirement;
import java.util.List;

@FunctionalInterface
public interface AiProvider {
    List<AiCandidate> generate(Requirement requirement, String instruction);
}
