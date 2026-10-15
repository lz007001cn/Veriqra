package io.github.lz007001cn.veriqra.service.query;
import java.util.UUID;
public record RetestOperationResult(UUID requestKey, String action, RetestSelection link,
        Integer resultDefectVersion, boolean replayed, Long replacedLinkId) { }
