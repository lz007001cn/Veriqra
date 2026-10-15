package io.github.lz007001cn.veriqra.web.dto;

public record RemoveEvidenceRequest(Integer expectedVersion) {
    public RemoveEvidenceRequest { new ExpectedVersionRequest(expectedVersion); }
}
