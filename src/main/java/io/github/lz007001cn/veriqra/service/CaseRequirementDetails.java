package io.github.lz007001cn.veriqra.service;

import io.github.lz007001cn.veriqra.model.Requirement;
import io.github.lz007001cn.veriqra.model.TestCaseRequirement;

/** The persisted reverse relationship, including removed and review-needed links. */
public record CaseRequirementDetails(Requirement requirement, TestCaseRequirement link) { }
