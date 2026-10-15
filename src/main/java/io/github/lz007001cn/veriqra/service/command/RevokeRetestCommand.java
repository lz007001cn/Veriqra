package io.github.lz007001cn.veriqra.service.command;
import java.util.UUID;
public record RevokeRetestCommand(Long defectId, Long linkId, Integer expectedVersion,
        UUID requestKey, String reason) { }
