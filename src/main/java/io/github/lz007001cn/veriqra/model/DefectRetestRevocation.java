package io.github.lz007001cn.veriqra.model;
import java.time.LocalDateTime;
import java.util.UUID;

/** One-time revocation fact. The DAO generates revokedAt, never accepts a fabricated time. */
public record DefectRetestRevocation(Long revokedBy, LocalDateTime revokedAt, String reason,
        DefectRetestRevocationOperation operation, UUID requestKey, Sha256Digest requestHash,
        Integer resultDefectVersion) { }
