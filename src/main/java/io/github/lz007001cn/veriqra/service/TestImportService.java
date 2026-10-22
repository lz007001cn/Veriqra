package io.github.lz007001cn.veriqra.service;

import io.github.lz007001cn.veriqra.service.command.*;
import io.github.lz007001cn.veriqra.service.importing.*;
import io.github.lz007001cn.veriqra.model.TestImport;
import java.util.List;
import java.util.UUID;

public interface TestImportService {
    ImportPreview analyzeImport(Long actorUserId, AnalyzeTestImportCommand command);
    ImportExecutionResult importReport(Long actorUserId, ImportTestResultsCommand command);
    List<TestImport> list(Long actor, Long project, Long run);
    ImportExecutionResult get(Long actor, Long project, Long id, UUID requestKey);
}
