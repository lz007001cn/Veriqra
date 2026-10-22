package io.github.lz007001cn.veriqra.dao;

import io.github.lz007001cn.veriqra.model.TestImport;
import java.util.*;

/** Append-only import evidence; no parsing, payload comparison or idempotency retry. */
public interface TestImportDao {
    /** Ignores generated id/importedAt. Caller supplies UUID and exactly 32 hash bytes. */
    TestImport insert(TestImport value);
    Optional<TestImport> findById(Long id);
    /** Lookup only; caller decides whether the existing payload/target matches. */
    Optional<TestImport> findByRequestKey(UUID requestKey);
    /** Ordered by importedAt, then id. */
    List<TestImport> listByRun(Long testRunId);
    /** Newest first across all Runs in the project. */
    List<TestImport> listByProject(Long projectId);
}
