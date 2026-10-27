package io.github.lz007001cn.veriqra.model;

/** Effective current coverage, not an association-row count. */
public record RequirementCoverage(Long requirementId, long confirmedCaseCount) { }
