-- R1 additive foundation. No backfill, existing-table ALTER, or automatic startup migration.
-- Run only after explicit environment identity/preflight checks and migration authorization.
CREATE TABLE `defect_retest_links` (
  `id` BIGINT NOT NULL AUTO_INCREMENT,
  `defect_id` BIGINT NOT NULL,
  `failure_attempt_id` BIGINT NOT NULL,
  `pass_attempt_id` BIGINT NOT NULL,
  `policy_version` VARCHAR(32) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  `linked_by` BIGINT NOT NULL,
  `linked_at` DATETIME(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
  `review_note` VARCHAR(2000) NOT NULL,
  `timing_basis` VARCHAR(32) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  `request_key` BINARY(16) NOT NULL,
  `request_hash` BINARY(32) NOT NULL,
  `result_defect_version` INT UNSIGNED NOT NULL,
  `revoked_by` BIGINT NULL,
  `revoked_at` DATETIME(6) NULL,
  `revoke_reason` VARCHAR(2000) NULL,
  `revocation_operation` VARCHAR(16) CHARACTER SET ascii COLLATE ascii_bin NULL,
  `revoke_request_key` BINARY(16) NULL,
  `revoke_request_hash` BINARY(32) NULL,
  `revoke_result_version` INT UNSIGNED NULL,
  `active_failure_id` BIGINT GENERATED ALWAYS AS
    (CASE WHEN `revoked_at` IS NULL THEN `failure_attempt_id` ELSE NULL END) STORED,
  PRIMARY KEY (`id`),
  UNIQUE KEY `uq_retests_active_source` (`defect_id`,`active_failure_id`),
  UNIQUE KEY `uq_retests_endpoints` (`id`,`defect_id`,`failure_attempt_id`,`pass_attempt_id`),
  UNIQUE KEY `uq_retests_request` (`request_key`),
  UNIQUE KEY `uq_retests_revoke_request` (`revoke_request_key`),
  KEY `ix_retests_defect_failure` (`defect_id`,`failure_attempt_id`,`id`),
  KEY `ix_retests_source` (`failure_attempt_id`,`defect_id`),
  KEY `ix_retests_pass` (`pass_attempt_id`),
  KEY `ix_retests_linked_by` (`linked_by`),
  KEY `ix_retests_revoked_by` (`revoked_by`),
  CONSTRAINT `fk_retests_defect` FOREIGN KEY (`defect_id`) REFERENCES `defects` (`id`) ON DELETE RESTRICT ON UPDATE RESTRICT,
  CONSTRAINT `fk_retests_source` FOREIGN KEY (`failure_attempt_id`,`defect_id`) REFERENCES `test_attempt_defects` (`attempt_id`,`defect_id`) ON DELETE RESTRICT ON UPDATE RESTRICT,
  CONSTRAINT `fk_retests_pass` FOREIGN KEY (`pass_attempt_id`) REFERENCES `test_attempts` (`id`) ON DELETE RESTRICT ON UPDATE RESTRICT,
  CONSTRAINT `fk_retests_linked_by` FOREIGN KEY (`linked_by`) REFERENCES `users` (`id`) ON DELETE RESTRICT ON UPDATE RESTRICT,
  CONSTRAINT `fk_retests_revoked_by` FOREIGN KEY (`revoked_by`) REFERENCES `users` (`id`) ON DELETE RESTRICT ON UPDATE RESTRICT,
  CONSTRAINT `ck_retests_different_attempts` CHECK (`failure_attempt_id` <> `pass_attempt_id`),
  CONSTRAINT `ck_retests_policy` CHECK (`policy_version` = 'EXACT_SEMANTIC_V1'),
  CONSTRAINT `ck_retests_note` CHECK (CHAR_LENGTH(TRIM(`review_note`)) > 0),
  CONSTRAINT `ck_retests_timing` CHECK (`timing_basis` IN ('MANUAL_SERVER_RECORD','IMPORT_REVIEW_ATTESTATION')),
  CONSTRAINT `ck_retests_revocation` CHECK (
    (`revoked_by` IS NULL AND `revoked_at` IS NULL AND `revoke_reason` IS NULL
      AND `revocation_operation` IS NULL AND `revoke_request_key` IS NULL
      AND `revoke_request_hash` IS NULL AND `revoke_result_version` IS NULL)
    OR
    (`revoked_by` IS NOT NULL AND `revoked_at` IS NOT NULL AND `revoke_reason` IS NOT NULL
      AND `revocation_operation` IS NOT NULL AND `revoke_request_key` IS NOT NULL
      AND `revoke_request_hash` IS NOT NULL AND `revoke_result_version` IS NOT NULL
      AND `revoked_at` >= `linked_at` AND CHAR_LENGTH(TRIM(`revoke_reason`)) > 0
      AND `revocation_operation` IN ('REVOKE','REPLACE')))
) ENGINE=InnoDB ROW_FORMAT=DYNAMIC DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_0900_ai_ci;

CREATE TABLE `defect_closure_receipts` (
  `id` BIGINT NOT NULL AUTO_INCREMENT,
  `defect_id` BIGINT NOT NULL,
  `closed_defect_version` INT UNSIGNED NOT NULL,
  `closed_by` BIGINT NOT NULL,
  `closed_at` DATETIME(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
  `policy_version` VARCHAR(32) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  `resolution_note` TEXT NOT NULL,
  `evidence_count` INT UNSIGNED NOT NULL,
  PRIMARY KEY (`id`),
  UNIQUE KEY `uq_closures_defect_version` (`defect_id`,`closed_defect_version`),
  UNIQUE KEY `uq_closures_owner` (`id`,`defect_id`),
  KEY `ix_closures_defect_time` (`defect_id`,`closed_at`,`id`),
  KEY `ix_closures_closed_by` (`closed_by`),
  CONSTRAINT `fk_closures_defect` FOREIGN KEY (`defect_id`) REFERENCES `defects` (`id`) ON DELETE RESTRICT ON UPDATE RESTRICT,
  CONSTRAINT `fk_closures_actor` FOREIGN KEY (`closed_by`) REFERENCES `users` (`id`) ON DELETE RESTRICT ON UPDATE RESTRICT,
  CONSTRAINT `ck_closures_policy` CHECK (`policy_version` = 'R1_CLOSURE_V1'),
  CONSTRAINT `ck_closures_note` CHECK (CHAR_LENGTH(TRIM(`resolution_note`)) > 0),
  CONSTRAINT `ck_closures_count` CHECK (`evidence_count` > 0)
) ENGINE=InnoDB ROW_FORMAT=DYNAMIC DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_0900_ai_ci;

CREATE TABLE `defect_closure_items` (
  `receipt_id` BIGINT NOT NULL,
  `failure_attempt_id` BIGINT NOT NULL,
  `defect_id` BIGINT NOT NULL,
  `pass_attempt_id` BIGINT NOT NULL,
  `retest_link_id` BIGINT NULL,
  `evidence_policy` VARCHAR(32) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  PRIMARY KEY (`receipt_id`,`failure_attempt_id`),
  KEY `ix_closure_items_owner` (`receipt_id`,`defect_id`),
  KEY `ix_closure_items_source` (`failure_attempt_id`,`defect_id`),
  KEY `ix_closure_items_pass` (`pass_attempt_id`),
  KEY `ix_closure_items_link` (`retest_link_id`,`defect_id`,`failure_attempt_id`,`pass_attempt_id`),
  CONSTRAINT `fk_closure_items_owner` FOREIGN KEY (`receipt_id`,`defect_id`) REFERENCES `defect_closure_receipts` (`id`,`defect_id`) ON DELETE RESTRICT ON UPDATE RESTRICT,
  CONSTRAINT `fk_closure_items_source` FOREIGN KEY (`failure_attempt_id`,`defect_id`) REFERENCES `test_attempt_defects` (`attempt_id`,`defect_id`) ON DELETE RESTRICT ON UPDATE RESTRICT,
  CONSTRAINT `fk_closure_items_pass` FOREIGN KEY (`pass_attempt_id`) REFERENCES `test_attempts` (`id`) ON DELETE RESTRICT ON UPDATE RESTRICT,
  CONSTRAINT `fk_closure_items_link` FOREIGN KEY (`retest_link_id`,`defect_id`,`failure_attempt_id`,`pass_attempt_id`) REFERENCES `defect_retest_links` (`id`,`defect_id`,`failure_attempt_id`,`pass_attempt_id`) ON DELETE RESTRICT ON UPDATE RESTRICT,
  CONSTRAINT `ck_closure_items_different` CHECK (`failure_attempt_id` <> `pass_attempt_id`),
  CONSTRAINT `ck_closure_items_policy` CHECK (
    (`evidence_policy` = 'SAME_RUN_CASE_V1' AND `retest_link_id` IS NULL)
    OR (`evidence_policy` = 'EXACT_SEMANTIC_V1' AND `retest_link_id` IS NOT NULL))
) ENGINE=InnoDB ROW_FORMAT=DYNAMIC DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_0900_ai_ci;
