-- Veriqra V1 Domain Model Freeze v1.0 plus additive Administration and Collaboration tables
-- MySQL 8.0.46; execute in an EMPTY, explicitly selected database.
-- No CREATE DATABASE / USE / DROP / IF NOT EXISTS: never hide a partial installation.
SET NAMES utf8mb4 COLLATE utf8mb4_0900_ai_ci;
SET SESSION time_zone = '+00:00';
SET SESSION sql_mode = 'ONLY_FULL_GROUP_BY,STRICT_TRANS_TABLES,NO_ZERO_IN_DATE,NO_ZERO_DATE,ERROR_FOR_DIVISION_BY_ZERO,NO_ENGINE_SUBSTITUTION';

CREATE TABLE `users` (
  `id` BIGINT NOT NULL AUTO_INCREMENT,
  `username` VARCHAR(64) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  `display_name` VARCHAR(80) NOT NULL,
  `password_hash` VARCHAR(255) NOT NULL,
  `system_role` VARCHAR(16) CHARACTER SET ascii COLLATE ascii_bin NOT NULL DEFAULT 'USER',
  `status` VARCHAR(16) CHARACTER SET ascii COLLATE ascii_bin NOT NULL DEFAULT 'ACTIVE',
  `created_at` DATETIME(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
  `updated_at` DATETIME(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
  `lock_version` INT UNSIGNED NOT NULL DEFAULT 0,
  PRIMARY KEY (`id`),
  UNIQUE KEY `uq_users_username` (`username`),
  KEY `ix_users_admin_lock` (`system_role`, `status`, `id`),
  CONSTRAINT `ck_users_username_nonblank` CHECK (CHAR_LENGTH(TRIM(`username`)) > 0),
  CONSTRAINT `ck_users_display_name_nonblank` CHECK (CHAR_LENGTH(TRIM(`display_name`)) > 0),
  CONSTRAINT `ck_users_password_hash_nonblank` CHECK (CHAR_LENGTH(TRIM(`password_hash`)) > 0),
  CONSTRAINT `ck_users_system_role` CHECK (`system_role` IN ('ADMIN','USER')),
  CONSTRAINT `ck_users_status` CHECK (`status` IN ('ACTIVE','DISABLED'))
) ENGINE=InnoDB ROW_FORMAT=DYNAMIC DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_0900_ai_ci;

CREATE TABLE `projects` (
  `id` BIGINT NOT NULL AUTO_INCREMENT,
  `project_key` VARCHAR(16) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  `name` VARCHAR(160) NOT NULL,
  `description` TEXT NULL DEFAULT NULL,
  `status` VARCHAR(16) CHARACTER SET ascii COLLATE ascii_bin NOT NULL DEFAULT 'ACTIVE',
  `created_by` BIGINT NOT NULL,
  `created_at` DATETIME(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
  `updated_at` DATETIME(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
  `lock_version` INT UNSIGNED NOT NULL DEFAULT 0,
  PRIMARY KEY (`id`),
  UNIQUE KEY `uq_projects_key` (`project_key`),
  KEY `ix_projects_created_by` (`created_by`),
  CONSTRAINT `fk_projects_created_by` FOREIGN KEY (`created_by`) REFERENCES `users` (`id`) ON DELETE RESTRICT ON UPDATE RESTRICT,
  CONSTRAINT `ck_projects_name_nonblank` CHECK (CHAR_LENGTH(TRIM(`name`)) > 0),
  CONSTRAINT `ck_projects_status` CHECK (`status` IN ('ACTIVE','ARCHIVED'))
) ENGINE=InnoDB ROW_FORMAT=DYNAMIC DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_0900_ai_ci;

CREATE TABLE `project_members` (
  `project_id` BIGINT NOT NULL,
  `user_id` BIGINT NOT NULL,
  `project_role` VARCHAR(16) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  `status` VARCHAR(16) CHARACTER SET ascii COLLATE ascii_bin NOT NULL DEFAULT 'ACTIVE',
  `joined_at` DATETIME(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
  `updated_at` DATETIME(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
  `lock_version` INT UNSIGNED NOT NULL DEFAULT 0,
  PRIMARY KEY (`project_id`, `user_id`),
  KEY `ix_members_user_status_project` (`user_id`, `status`, `project_id`),
  CONSTRAINT `fk_project_members_project_id` FOREIGN KEY (`project_id`) REFERENCES `projects` (`id`) ON DELETE RESTRICT ON UPDATE RESTRICT,
  CONSTRAINT `fk_project_members_user_id` FOREIGN KEY (`user_id`) REFERENCES `users` (`id`) ON DELETE RESTRICT ON UPDATE RESTRICT,
  CONSTRAINT `ck_project_members_project_role` CHECK (`project_role` IN ('TESTER','DEVELOPER')),
  CONSTRAINT `ck_project_members_status` CHECK (`status` IN ('ACTIVE','INACTIVE'))
) ENGINE=InnoDB ROW_FORMAT=DYNAMIC DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_0900_ai_ci;

CREATE TABLE `project_counters` (
  `project_id` BIGINT NOT NULL,
  `entity_type` VARCHAR(16) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  `next_value` BIGINT NOT NULL DEFAULT 1,
  PRIMARY KEY (`project_id`, `entity_type`),
  CONSTRAINT `fk_project_counters_project_id` FOREIGN KEY (`project_id`) REFERENCES `projects` (`id`) ON DELETE RESTRICT ON UPDATE RESTRICT,
  CONSTRAINT `ck_project_counters_entity_type` CHECK (`entity_type` IN ('REQ','TC','PLAN','BUG')),
  CONSTRAINT `ck_project_counters_next_value` CHECK (`next_value` > 0)
) ENGINE=InnoDB ROW_FORMAT=DYNAMIC DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_0900_ai_ci;

CREATE TABLE `requirements` (
  `id` BIGINT NOT NULL AUTO_INCREMENT,
  `project_id` BIGINT NOT NULL,
  `key_no` BIGINT NOT NULL,
  `title` VARCHAR(240) NOT NULL,
  `description` TEXT NULL DEFAULT NULL,
  `priority` VARCHAR(16) CHARACTER SET ascii COLLATE ascii_bin NOT NULL DEFAULT 'MEDIUM',
  `status` VARCHAR(16) CHARACTER SET ascii COLLATE ascii_bin NOT NULL DEFAULT 'DRAFT',
  `created_by` BIGINT NOT NULL,
  `created_at` DATETIME(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
  `updated_at` DATETIME(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
  `lock_version` INT UNSIGNED NOT NULL DEFAULT 0,
  PRIMARY KEY (`id`),
  UNIQUE KEY `uq_requirements_project_key` (`project_id`, `key_no`),
  KEY `ix_requirements_created_by` (`created_by`),
  CONSTRAINT `fk_requirements_project_id` FOREIGN KEY (`project_id`) REFERENCES `projects` (`id`) ON DELETE RESTRICT ON UPDATE RESTRICT,
  CONSTRAINT `fk_requirements_created_by` FOREIGN KEY (`created_by`) REFERENCES `users` (`id`) ON DELETE RESTRICT ON UPDATE RESTRICT,
  CONSTRAINT `ck_requirements_key_no` CHECK (`key_no` > 0),
  CONSTRAINT `ck_requirements_title_nonblank` CHECK (CHAR_LENGTH(TRIM(`title`)) > 0),
  CONSTRAINT `ck_requirements_priority` CHECK (`priority` IN ('LOW','MEDIUM','HIGH')),
  CONSTRAINT `ck_requirements_status` CHECK (`status` IN ('DRAFT','ACTIVE','ARCHIVED'))
) ENGINE=InnoDB ROW_FORMAT=DYNAMIC DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_0900_ai_ci;

CREATE TABLE `test_cases` (
  `id` BIGINT NOT NULL AUTO_INCREMENT,
  `project_id` BIGINT NOT NULL,
  `key_no` BIGINT NOT NULL,
  `title` VARCHAR(240) NOT NULL,
  `description` TEXT NULL DEFAULT NULL,
  `preconditions` TEXT NULL DEFAULT NULL,
  `priority` VARCHAR(16) CHARACTER SET ascii COLLATE ascii_bin NOT NULL DEFAULT 'MEDIUM',
  `status` VARCHAR(16) CHARACTER SET ascii COLLATE ascii_bin NOT NULL DEFAULT 'DRAFT',
  `created_by` BIGINT NOT NULL,
  `created_at` DATETIME(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
  `updated_at` DATETIME(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
  `lock_version` INT UNSIGNED NOT NULL DEFAULT 0,
  PRIMARY KEY (`id`),
  UNIQUE KEY `uq_test_cases_project_key` (`project_id`, `key_no`),
  KEY `ix_test_cases_created_by` (`created_by`),
  CONSTRAINT `fk_test_cases_project_id` FOREIGN KEY (`project_id`) REFERENCES `projects` (`id`) ON DELETE RESTRICT ON UPDATE RESTRICT,
  CONSTRAINT `fk_test_cases_created_by` FOREIGN KEY (`created_by`) REFERENCES `users` (`id`) ON DELETE RESTRICT ON UPDATE RESTRICT,
  CONSTRAINT `ck_test_cases_key_no` CHECK (`key_no` > 0),
  CONSTRAINT `ck_test_cases_title_nonblank` CHECK (CHAR_LENGTH(TRIM(`title`)) > 0),
  CONSTRAINT `ck_test_cases_priority` CHECK (`priority` IN ('LOW','MEDIUM','HIGH')),
  CONSTRAINT `ck_test_cases_status` CHECK (`status` IN ('DRAFT','READY','ARCHIVED'))
) ENGINE=InnoDB ROW_FORMAT=DYNAMIC DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_0900_ai_ci;

CREATE TABLE `test_automation_identities` (
  `id` BIGINT NOT NULL AUTO_INCREMENT,
  `project_id` BIGINT NOT NULL,
  `source` VARCHAR(16) CHARACTER SET ascii COLLATE ascii_bin NOT NULL DEFAULT 'JUNIT',
  `namespace` VARCHAR(128) CHARACTER SET utf8mb4 COLLATE utf8mb4_0900_bin NOT NULL,
  `external_key` VARCHAR(512) CHARACTER SET utf8mb4 COLLATE utf8mb4_0900_bin NOT NULL,
  `created_at` DATETIME(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
  PRIMARY KEY (`id`),
  UNIQUE KEY `uq_automation_identity` (`project_id`, `source`, `namespace`, `external_key`),
  CONSTRAINT `fk_test_automation_identities_project_id` FOREIGN KEY (`project_id`) REFERENCES `projects` (`id`) ON DELETE RESTRICT ON UPDATE RESTRICT,
  CONSTRAINT `ck_test_automation_identities_source` CHECK (`source` IN ('JUNIT')),
  CONSTRAINT `ck_test_automation_identities_namespace_nonblank` CHECK (CHAR_LENGTH(TRIM(`namespace`)) > 0),
  CONSTRAINT `ck_automation_external_key_nonempty` CHECK (CHAR_LENGTH(`external_key`) > 0)
) ENGINE=InnoDB ROW_FORMAT=DYNAMIC DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_0900_ai_ci;

CREATE TABLE `test_automation_mappings` (
  `id` BIGINT NOT NULL AUTO_INCREMENT,
  `automation_identity_id` BIGINT NOT NULL,
  `test_case_id` BIGINT NOT NULL,
  `status` VARCHAR(16) CHARACTER SET ascii COLLATE ascii_bin NOT NULL DEFAULT 'ACTIVE',
  `created_by` BIGINT NOT NULL,
  `created_at` DATETIME(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
  `updated_at` DATETIME(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
  `lock_version` INT UNSIGNED NOT NULL DEFAULT 0,
  PRIMARY KEY (`id`),
  UNIQUE KEY `uq_automation_mapping_identity` (`automation_identity_id`),
  KEY `ix_automation_mappings_case_status` (`test_case_id`, `status`, `id`),
  KEY `ix_automation_mappings_created_by` (`created_by`),
  CONSTRAINT `fk_test_automation_mappings_automation_identity_id` FOREIGN KEY (`automation_identity_id`) REFERENCES `test_automation_identities` (`id`) ON DELETE RESTRICT ON UPDATE RESTRICT,
  CONSTRAINT `fk_test_automation_mappings_test_case_id` FOREIGN KEY (`test_case_id`) REFERENCES `test_cases` (`id`) ON DELETE RESTRICT ON UPDATE RESTRICT,
  CONSTRAINT `fk_test_automation_mappings_created_by` FOREIGN KEY (`created_by`) REFERENCES `users` (`id`) ON DELETE RESTRICT ON UPDATE RESTRICT,
  CONSTRAINT `ck_test_automation_mappings_status` CHECK (`status` IN ('ACTIVE','INACTIVE'))
) ENGINE=InnoDB ROW_FORMAT=DYNAMIC DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_0900_ai_ci;

CREATE TABLE `test_steps` (
  `test_case_id` BIGINT NOT NULL,
  `step_order` SMALLINT UNSIGNED NOT NULL,
  `action` TEXT NOT NULL,
  `expected_result` TEXT NOT NULL,
  PRIMARY KEY (`test_case_id`, `step_order`),
  CONSTRAINT `fk_test_steps_test_case_id` FOREIGN KEY (`test_case_id`) REFERENCES `test_cases` (`id`) ON DELETE RESTRICT ON UPDATE RESTRICT,
  CONSTRAINT `ck_test_steps_step_order` CHECK (`step_order` > 0),
  CONSTRAINT `ck_test_steps_action_nonblank` CHECK (CHAR_LENGTH(TRIM(`action`)) > 0),
  CONSTRAINT `ck_test_steps_expected_result_nonblank` CHECK (CHAR_LENGTH(TRIM(`expected_result`)) > 0)
) ENGINE=InnoDB ROW_FORMAT=DYNAMIC DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_0900_ai_ci;

CREATE TABLE `test_case_requirements` (
  `requirement_id` BIGINT NOT NULL,
  `test_case_id` BIGINT NOT NULL,
  `status` VARCHAR(16) CHARACTER SET ascii COLLATE ascii_bin NOT NULL DEFAULT 'NEEDS_REVIEW',
  `linked_by` BIGINT NOT NULL,
  `linked_at` DATETIME(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
  `reviewed_by` BIGINT NULL DEFAULT NULL,
  `reviewed_at` DATETIME(6) NULL DEFAULT NULL,
  `updated_at` DATETIME(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
  PRIMARY KEY (`requirement_id`, `test_case_id`),
  KEY `ix_trace_case_requirement` (`test_case_id`, `requirement_id`),
  KEY `ix_test_case_requirements_linked_by` (`linked_by`),
  KEY `ix_test_case_requirements_reviewed_by` (`reviewed_by`),
  CONSTRAINT `fk_test_case_requirements_requirement_id` FOREIGN KEY (`requirement_id`) REFERENCES `requirements` (`id`) ON DELETE RESTRICT ON UPDATE RESTRICT,
  CONSTRAINT `fk_test_case_requirements_test_case_id` FOREIGN KEY (`test_case_id`) REFERENCES `test_cases` (`id`) ON DELETE RESTRICT ON UPDATE RESTRICT,
  CONSTRAINT `fk_test_case_requirements_linked_by` FOREIGN KEY (`linked_by`) REFERENCES `users` (`id`) ON DELETE RESTRICT ON UPDATE RESTRICT,
  CONSTRAINT `fk_test_case_requirements_reviewed_by` FOREIGN KEY (`reviewed_by`) REFERENCES `users` (`id`) ON DELETE RESTRICT ON UPDATE RESTRICT,
  CONSTRAINT `ck_test_case_requirements_status` CHECK (`status` IN ('CONFIRMED','NEEDS_REVIEW','REMOVED')),
  CONSTRAINT `ck_trace_review_shape` CHECK ((`status` = 'CONFIRMED' AND `reviewed_by` IS NOT NULL AND `reviewed_at` IS NOT NULL) OR (`status` IN ('NEEDS_REVIEW','REMOVED') AND `reviewed_by` IS NULL AND `reviewed_at` IS NULL))
) ENGINE=InnoDB ROW_FORMAT=DYNAMIC DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_0900_ai_ci;

CREATE TABLE `test_plans` (
  `id` BIGINT NOT NULL AUTO_INCREMENT,
  `project_id` BIGINT NOT NULL,
  `key_no` BIGINT NOT NULL,
  `name` VARCHAR(160) NOT NULL,
  `description` TEXT NULL DEFAULT NULL,
  `status` VARCHAR(16) CHARACTER SET ascii COLLATE ascii_bin NOT NULL DEFAULT 'DRAFT',
  `created_by` BIGINT NOT NULL,
  `created_at` DATETIME(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
  `updated_at` DATETIME(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
  `lock_version` INT UNSIGNED NOT NULL DEFAULT 0,
  PRIMARY KEY (`id`),
  UNIQUE KEY `uq_test_plans_project_key` (`project_id`, `key_no`),
  KEY `ix_test_plans_created_by` (`created_by`),
  CONSTRAINT `fk_test_plans_project_id` FOREIGN KEY (`project_id`) REFERENCES `projects` (`id`) ON DELETE RESTRICT ON UPDATE RESTRICT,
  CONSTRAINT `fk_test_plans_created_by` FOREIGN KEY (`created_by`) REFERENCES `users` (`id`) ON DELETE RESTRICT ON UPDATE RESTRICT,
  CONSTRAINT `ck_test_plans_key_no` CHECK (`key_no` > 0),
  CONSTRAINT `ck_test_plans_name_nonblank` CHECK (CHAR_LENGTH(TRIM(`name`)) > 0),
  CONSTRAINT `ck_test_plans_status` CHECK (`status` IN ('DRAFT','READY','ARCHIVED'))
) ENGINE=InnoDB ROW_FORMAT=DYNAMIC DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_0900_ai_ci;

CREATE TABLE `test_plan_cases` (
  `test_plan_id` BIGINT NOT NULL,
  `test_case_id` BIGINT NOT NULL,
  `added_by` BIGINT NOT NULL,
  `added_at` DATETIME(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
  PRIMARY KEY (`test_plan_id`, `test_case_id`),
  KEY `ix_plan_cases_case_plan` (`test_case_id`, `test_plan_id`),
  KEY `ix_test_plan_cases_added_by` (`added_by`),
  CONSTRAINT `fk_test_plan_cases_test_plan_id` FOREIGN KEY (`test_plan_id`) REFERENCES `test_plans` (`id`) ON DELETE RESTRICT ON UPDATE RESTRICT,
  CONSTRAINT `fk_test_plan_cases_test_case_id` FOREIGN KEY (`test_case_id`) REFERENCES `test_cases` (`id`) ON DELETE RESTRICT ON UPDATE RESTRICT,
  CONSTRAINT `fk_test_plan_cases_added_by` FOREIGN KEY (`added_by`) REFERENCES `users` (`id`) ON DELETE RESTRICT ON UPDATE RESTRICT
) ENGINE=InnoDB ROW_FORMAT=DYNAMIC DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_0900_ai_ci;

CREATE TABLE `test_runs` (
  `id` BIGINT NOT NULL AUTO_INCREMENT,
  `project_id` BIGINT NOT NULL,
  `test_plan_id` BIGINT NULL DEFAULT NULL,
  `name` VARCHAR(160) NOT NULL,
  `environment` VARCHAR(160) NULL DEFAULT NULL,
  `build_version` VARCHAR(80) NULL DEFAULT NULL,
  `status` VARCHAR(16) CHARACTER SET ascii COLLATE ascii_bin NOT NULL DEFAULT 'IN_PROGRESS',
  `ended_at` DATETIME(6) NULL DEFAULT NULL,
  `created_by` BIGINT NOT NULL,
  `created_at` DATETIME(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
  `updated_at` DATETIME(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
  `lock_version` INT UNSIGNED NOT NULL DEFAULT 0,
  `assignee_id` BIGINT NULL DEFAULT NULL,
  PRIMARY KEY (`id`),
  KEY `ix_runs_plan_created_id` (`test_plan_id`, `created_at`, `id`),
  KEY `ix_test_runs_created_by` (`created_by`),
  KEY `ix_runs_project_created_id` (`project_id`, `created_at`, `id`),
  KEY `ix_runs_assignee_status` (`project_id`, `assignee_id`, `status`),
  CONSTRAINT `fk_test_runs_project_id` FOREIGN KEY (`project_id`) REFERENCES `projects` (`id`) ON DELETE RESTRICT ON UPDATE RESTRICT,
  CONSTRAINT `fk_test_runs_assignee` FOREIGN KEY (`project_id`, `assignee_id`) REFERENCES `project_members` (`project_id`, `user_id`) ON DELETE RESTRICT ON UPDATE RESTRICT,
  CONSTRAINT `fk_test_runs_test_plan_id` FOREIGN KEY (`test_plan_id`) REFERENCES `test_plans` (`id`) ON DELETE RESTRICT ON UPDATE RESTRICT,
  CONSTRAINT `fk_test_runs_created_by` FOREIGN KEY (`created_by`) REFERENCES `users` (`id`) ON DELETE RESTRICT ON UPDATE RESTRICT,
  CONSTRAINT `ck_test_runs_name_nonblank` CHECK (CHAR_LENGTH(TRIM(`name`)) > 0),
  CONSTRAINT `ck_test_runs_status` CHECK (`status` IN ('IN_PROGRESS','COMPLETED','CANCELLED')),
  CONSTRAINT `ck_runs_ended_at` CHECK ((`status` <> 'IN_PROGRESS' OR `ended_at` IS NULL) AND (`status` NOT IN ('COMPLETED','CANCELLED') OR (`ended_at` IS NOT NULL AND `ended_at` >= `created_at`)))
) ENGINE=InnoDB ROW_FORMAT=DYNAMIC DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_0900_ai_ci;

CREATE TABLE `test_run_cases` (
  `id` BIGINT NOT NULL AUTO_INCREMENT,
  `test_run_id` BIGINT NOT NULL,
  `test_case_id` BIGINT NOT NULL,
  `snapshot_title` VARCHAR(240) NOT NULL,
  `snapshot_description` TEXT NULL DEFAULT NULL,
  `snapshot_preconditions` TEXT NULL DEFAULT NULL,
  `snapshot_priority` VARCHAR(16) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  `captured_at` DATETIME(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
  PRIMARY KEY (`id`),
  UNIQUE KEY `uq_run_cases_run_case` (`test_run_id`, `test_case_id`),
  KEY `ix_run_cases_case_run` (`test_case_id`, `test_run_id`),
  CONSTRAINT `fk_test_run_cases_test_run_id` FOREIGN KEY (`test_run_id`) REFERENCES `test_runs` (`id`) ON DELETE RESTRICT ON UPDATE RESTRICT,
  CONSTRAINT `fk_test_run_cases_test_case_id` FOREIGN KEY (`test_case_id`) REFERENCES `test_cases` (`id`) ON DELETE RESTRICT ON UPDATE RESTRICT,
  CONSTRAINT `ck_test_run_cases_snapshot_title_nonblank` CHECK (CHAR_LENGTH(TRIM(`snapshot_title`)) > 0),
  CONSTRAINT `ck_test_run_cases_snapshot_priority` CHECK (`snapshot_priority` IN ('LOW','MEDIUM','HIGH'))
) ENGINE=InnoDB ROW_FORMAT=DYNAMIC DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_0900_ai_ci;

CREATE TABLE `test_run_case_steps` (
  `test_run_case_id` BIGINT NOT NULL,
  `step_order` SMALLINT UNSIGNED NOT NULL,
  `action` TEXT NOT NULL,
  `expected_result` TEXT NOT NULL,
  PRIMARY KEY (`test_run_case_id`, `step_order`),
  CONSTRAINT `fk_test_run_case_steps_test_run_case_id` FOREIGN KEY (`test_run_case_id`) REFERENCES `test_run_cases` (`id`) ON DELETE RESTRICT ON UPDATE RESTRICT,
  CONSTRAINT `ck_test_run_case_steps_step_order` CHECK (`step_order` > 0),
  CONSTRAINT `ck_test_run_case_steps_action_nonblank` CHECK (CHAR_LENGTH(TRIM(`action`)) > 0),
  CONSTRAINT `ck_test_run_case_steps_expected_result_nonblank` CHECK (CHAR_LENGTH(TRIM(`expected_result`)) > 0)
) ENGINE=InnoDB ROW_FORMAT=DYNAMIC DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_0900_ai_ci;

CREATE TABLE `test_imports` (
  `id` BIGINT NOT NULL AUTO_INCREMENT,
  `test_run_id` BIGINT NOT NULL,
  `request_key` BINARY(16) NOT NULL,
  `report_sha256` BINARY(32) NOT NULL,
  `source_namespace` VARCHAR(128) CHARACTER SET utf8mb4 COLLATE utf8mb4_0900_bin NOT NULL,
  `original_filename` VARCHAR(255) NOT NULL,
  `imported_by` BIGINT NOT NULL,
  `imported_at` DATETIME(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
  PRIMARY KEY (`id`),
  UNIQUE KEY `uq_imports_request` (`request_key`),
  KEY `ix_imports_run_time_id` (`test_run_id`, `imported_at`, `id`),
  KEY `ix_test_imports_imported_by` (`imported_by`),
  CONSTRAINT `fk_test_imports_test_run_id` FOREIGN KEY (`test_run_id`) REFERENCES `test_runs` (`id`) ON DELETE RESTRICT ON UPDATE RESTRICT,
  CONSTRAINT `fk_test_imports_imported_by` FOREIGN KEY (`imported_by`) REFERENCES `users` (`id`) ON DELETE RESTRICT ON UPDATE RESTRICT,
  CONSTRAINT `ck_test_imports_source_namespace_nonblank` CHECK (CHAR_LENGTH(TRIM(`source_namespace`)) > 0),
  CONSTRAINT `ck_test_imports_original_filename_nonblank` CHECK (CHAR_LENGTH(TRIM(`original_filename`)) > 0)
) ENGINE=InnoDB ROW_FORMAT=DYNAMIC DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_0900_ai_ci;

CREATE TABLE `test_attempts` (
  `id` BIGINT NOT NULL AUTO_INCREMENT,
  `test_run_case_id` BIGINT NOT NULL,
  `attempt_no` INT UNSIGNED NOT NULL,
  `status` VARCHAR(16) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  `executed_by` BIGINT NULL DEFAULT NULL,
  `import_id` BIGINT NULL DEFAULT NULL,
  `automation_mapping_id` BIGINT NULL DEFAULT NULL,
  `executed_at` DATETIME(6) NULL DEFAULT NULL,
  `recorded_at` DATETIME(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
  `duration_ms` BIGINT UNSIGNED NULL DEFAULT NULL,
  `comment` TEXT NULL DEFAULT NULL,
  `failure_message` TEXT NULL DEFAULT NULL,
  `submission_key` BINARY(16) NOT NULL,
  PRIMARY KEY (`id`),
  UNIQUE KEY `uq_attempts_run_case_no` (`test_run_case_id`, `attempt_no`),
  UNIQUE KEY `uq_attempts_submission` (`submission_key`),
  UNIQUE KEY `uq_attempts_import_run_case` (`import_id`, `test_run_case_id`),
  KEY `ix_test_attempts_executed_by` (`executed_by`),
  KEY `ix_attempts_automation_mapping` (`automation_mapping_id`),
  CONSTRAINT `fk_test_attempts_test_run_case_id` FOREIGN KEY (`test_run_case_id`) REFERENCES `test_run_cases` (`id`) ON DELETE RESTRICT ON UPDATE RESTRICT,
  CONSTRAINT `fk_test_attempts_executed_by` FOREIGN KEY (`executed_by`) REFERENCES `users` (`id`) ON DELETE RESTRICT ON UPDATE RESTRICT,
  CONSTRAINT `fk_test_attempts_import_id` FOREIGN KEY (`import_id`) REFERENCES `test_imports` (`id`) ON DELETE RESTRICT ON UPDATE RESTRICT,
  CONSTRAINT `fk_test_attempts_automation_mapping_id` FOREIGN KEY (`automation_mapping_id`) REFERENCES `test_automation_mappings` (`id`) ON DELETE RESTRICT ON UPDATE RESTRICT,
  CONSTRAINT `ck_test_attempts_attempt_no` CHECK (`attempt_no` > 0),
  CONSTRAINT `ck_test_attempts_status` CHECK (`status` IN ('PASS','FAIL','BLOCKED','SKIPPED')),
  CONSTRAINT `ck_attempts_failure_message` CHECK (`status` = 'FAIL' OR `failure_message` IS NULL),
  CONSTRAINT `ck_attempts_source_shape` CHECK ((`import_id` IS NULL AND `automation_mapping_id` IS NULL AND `executed_by` IS NOT NULL) OR (`import_id` IS NOT NULL AND `automation_mapping_id` IS NOT NULL AND `executed_by` IS NULL))
) ENGINE=InnoDB ROW_FORMAT=DYNAMIC DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_0900_ai_ci;

CREATE TABLE `defects` (
  `id` BIGINT NOT NULL AUTO_INCREMENT,
  `project_id` BIGINT NOT NULL,
  `key_no` BIGINT NOT NULL,
  `title` VARCHAR(240) NOT NULL,
  `description` TEXT NULL DEFAULT NULL,
  `severity` VARCHAR(16) CHARACTER SET ascii COLLATE ascii_bin NOT NULL DEFAULT 'MEDIUM',
  `priority` VARCHAR(16) CHARACTER SET ascii COLLATE ascii_bin NOT NULL DEFAULT 'MEDIUM',
  `status` VARCHAR(16) CHARACTER SET ascii COLLATE ascii_bin NOT NULL DEFAULT 'OPEN',
  `reporter_id` BIGINT NOT NULL,
  `assignee_id` BIGINT NULL DEFAULT NULL,
  `resolution_note` TEXT NULL DEFAULT NULL,
  `created_at` DATETIME(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
  `updated_at` DATETIME(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
  `lock_version` INT UNSIGNED NOT NULL DEFAULT 0,
  PRIMARY KEY (`id`),
  UNIQUE KEY `uq_defects_project_key` (`project_id`, `key_no`),
  KEY `ix_defects_assignee_status_id` (`assignee_id`, `status`, `id`),
  KEY `ix_defects_reporter_id` (`reporter_id`),
  CONSTRAINT `fk_defects_project_id` FOREIGN KEY (`project_id`) REFERENCES `projects` (`id`) ON DELETE RESTRICT ON UPDATE RESTRICT,
  CONSTRAINT `fk_defects_reporter_id` FOREIGN KEY (`reporter_id`) REFERENCES `users` (`id`) ON DELETE RESTRICT ON UPDATE RESTRICT,
  CONSTRAINT `fk_defects_assignee_id` FOREIGN KEY (`assignee_id`) REFERENCES `users` (`id`) ON DELETE RESTRICT ON UPDATE RESTRICT,
  CONSTRAINT `ck_defects_key_no` CHECK (`key_no` > 0),
  CONSTRAINT `ck_defects_title_nonblank` CHECK (CHAR_LENGTH(TRIM(`title`)) > 0),
  CONSTRAINT `ck_defects_severity` CHECK (`severity` IN ('LOW','MEDIUM','HIGH','CRITICAL')),
  CONSTRAINT `ck_defects_priority` CHECK (`priority` IN ('LOW','MEDIUM','HIGH')),
  CONSTRAINT `ck_defects_status` CHECK (`status` IN ('OPEN','IN_PROGRESS','RESOLVED','CLOSED','REOPENED')),
  CONSTRAINT `ck_defects_resolution_note` CHECK (`status` NOT IN ('RESOLVED','CLOSED') OR (`resolution_note` IS NOT NULL AND CHAR_LENGTH(TRIM(`resolution_note`)) > 0))
) ENGINE=InnoDB ROW_FORMAT=DYNAMIC DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_0900_ai_ci;

CREATE TABLE `test_attempt_defects` (
  `attempt_id` BIGINT NOT NULL,
  `defect_id` BIGINT NOT NULL,
  `linked_by` BIGINT NOT NULL,
  `linked_at` DATETIME(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
  PRIMARY KEY (`attempt_id`, `defect_id`),
  KEY `ix_attempt_defects_defect_attempt` (`defect_id`, `attempt_id`),
  KEY `ix_test_attempt_defects_linked_by` (`linked_by`),
  CONSTRAINT `fk_test_attempt_defects_attempt_id` FOREIGN KEY (`attempt_id`) REFERENCES `test_attempts` (`id`) ON DELETE RESTRICT ON UPDATE RESTRICT,
  CONSTRAINT `fk_test_attempt_defects_defect_id` FOREIGN KEY (`defect_id`) REFERENCES `defects` (`id`) ON DELETE RESTRICT ON UPDATE RESTRICT,
  CONSTRAINT `fk_test_attempt_defects_linked_by` FOREIGN KEY (`linked_by`) REFERENCES `users` (`id`) ON DELETE RESTRICT ON UPDATE RESTRICT
) ENGINE=InnoDB ROW_FORMAT=DYNAMIC DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_0900_ai_ci;

-- Phase 5 R5 additive Administration tables. The preceding 19 business tables retain their V1 meaning.
CREATE TABLE `credit_accounts` (
  `user_id` BIGINT NOT NULL,
  `balance` BIGINT NOT NULL DEFAULT 0,
  `updated_at` DATETIME(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
  `lock_version` INT UNSIGNED NOT NULL DEFAULT 0,
  PRIMARY KEY (`user_id`),
  CONSTRAINT `fk_credit_accounts_user` FOREIGN KEY (`user_id`) REFERENCES `users` (`id`) ON DELETE RESTRICT ON UPDATE RESTRICT,
  CONSTRAINT `ck_credit_accounts_balance` CHECK (`balance` >= 0)
) ENGINE=InnoDB ROW_FORMAT=DYNAMIC DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_0900_ai_ci;

CREATE TABLE `credit_transactions` (
  `id` BIGINT NOT NULL AUTO_INCREMENT,
  `user_id` BIGINT NOT NULL,
  `amount` BIGINT NOT NULL,
  `type` VARCHAR(16) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  `actor_user_id` BIGINT NOT NULL,
  `reason` VARCHAR(500) NULL,
  `batch_id` CHAR(36) CHARACTER SET ascii COLLATE ascii_bin NULL,
  `created_at` DATETIME(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
  PRIMARY KEY (`id`),
  KEY `ix_credit_user_created` (`user_id`, `created_at`, `id`),
  KEY `ix_credit_actor` (`actor_user_id`),
  UNIQUE KEY `uq_credit_batch_user` (`batch_id`, `user_id`),
  KEY `ix_credit_type_created` (`type`, `created_at`),
  CONSTRAINT `fk_credit_transactions_account` FOREIGN KEY (`user_id`) REFERENCES `credit_accounts` (`user_id`) ON DELETE RESTRICT ON UPDATE RESTRICT,
  CONSTRAINT `fk_credit_transactions_actor` FOREIGN KEY (`actor_user_id`) REFERENCES `users` (`id`) ON DELETE RESTRICT ON UPDATE RESTRICT,
  CONSTRAINT `ck_credit_transactions_amount` CHECK (`amount` > 0),
  CONSTRAINT `ck_credit_transactions_type` CHECK (`type` IN ('GRANT','RECLAIM'))
) ENGINE=InnoDB ROW_FORMAT=DYNAMIC DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_0900_ai_ci;

CREATE TABLE `login_events` (
  `id` BIGINT NOT NULL AUTO_INCREMENT,
  `user_id` BIGINT NULL,
  `username_attempted` VARCHAR(64) NOT NULL,
  `ip_address` VARCHAR(45) NOT NULL,
  `user_agent` VARCHAR(512) NULL,
  `browser` VARCHAR(16) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  `operating_system` VARCHAR(16) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  `device_type` VARCHAR(16) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  `result` VARCHAR(16) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  `failure_reason` VARCHAR(32) CHARACTER SET ascii COLLATE ascii_bin NULL,
  `created_at` DATETIME(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
  PRIMARY KEY (`id`),
  KEY `ix_login_created` (`created_at`, `id`),
  KEY `ix_login_user_created` (`user_id`, `created_at`),
  KEY `ix_login_username_created` (`username_attempted`, `created_at`),
  KEY `ix_login_ip_created` (`ip_address`, `created_at`),
  KEY `ix_login_result_created` (`result`, `created_at`),
  CONSTRAINT `fk_login_events_user` FOREIGN KEY (`user_id`) REFERENCES `users` (`id`) ON DELETE RESTRICT ON UPDATE RESTRICT,
  CONSTRAINT `ck_login_events_result` CHECK (`result` IN ('SUCCESS','FAILURE','RATE_LIMITED'))
) ENGINE=InnoDB ROW_FORMAT=DYNAMIC DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_0900_ai_ci;

CREATE TABLE `access_logs` (
  `id` BIGINT NOT NULL AUTO_INCREMENT,
  `user_id` BIGINT NULL,
  `ip_address` VARCHAR(45) NOT NULL,
  `user_agent` VARCHAR(512) NULL,
  `browser` VARCHAR(16) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  `operating_system` VARCHAR(16) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  `device_type` VARCHAR(16) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  `http_method` VARCHAR(16) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  `request_path` VARCHAR(512) NOT NULL,
  `status_code` SMALLINT UNSIGNED NOT NULL,
  `request_id` CHAR(36) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  `duration_ms` INT UNSIGNED NOT NULL,
  `created_at` DATETIME(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
  PRIMARY KEY (`id`),
  KEY `ix_access_created` (`created_at`, `id`),
  KEY `ix_access_user_created` (`user_id`, `created_at`),
  KEY `ix_access_ip_created` (`ip_address`, `created_at`),
  KEY `ix_access_status_created` (`status_code`, `created_at`),
  CONSTRAINT `fk_access_logs_user` FOREIGN KEY (`user_id`) REFERENCES `users` (`id`) ON DELETE RESTRICT ON UPDATE RESTRICT,
  CONSTRAINT `ck_access_status` CHECK (`status_code` BETWEEN 100 AND 599)
) ENGINE=InnoDB ROW_FORMAT=DYNAMIC DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_0900_ai_ci;

CREATE TABLE `audit_logs` (
  `id` BIGINT NOT NULL AUTO_INCREMENT,
  `actor_user_id` BIGINT NOT NULL,
  `action` VARCHAR(40) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  `target_type` VARCHAR(32) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  `target_id` BIGINT NULL,
  `summary` VARCHAR(500) NOT NULL,
  `metadata_json` JSON NULL,
  `ip_address` VARCHAR(45) NOT NULL,
  `request_id` CHAR(36) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  `created_at` DATETIME(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
  PRIMARY KEY (`id`),
  KEY `ix_audit_created` (`created_at`, `id`),
  KEY `ix_audit_actor_created` (`actor_user_id`, `created_at`),
  KEY `ix_audit_action_created` (`action`, `created_at`),
  KEY `ix_audit_target` (`target_type`, `target_id`),
  CONSTRAINT `fk_audit_actor` FOREIGN KEY (`actor_user_id`) REFERENCES `users` (`id`) ON DELETE RESTRICT ON UPDATE RESTRICT,
  CONSTRAINT `ck_audit_summary` CHECK (CHAR_LENGTH(TRIM(`summary`)) > 0)
) ENGINE=InnoDB ROW_FORMAT=DYNAMIC DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_0900_ai_ci;

-- Project collaboration is additive. Platform ADMIN remains an account-administration role;
-- project and team authority is scoped to an ACTIVE project membership.
CREATE TABLE `project_managers` (
  `project_id` BIGINT NOT NULL,
  `user_id` BIGINT NOT NULL,
  `appointed_by` BIGINT NOT NULL,
  `status` VARCHAR(16) CHARACTER SET ascii COLLATE ascii_bin NOT NULL DEFAULT 'ACTIVE',
  `appointed_at` DATETIME(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
  `updated_at` DATETIME(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
  PRIMARY KEY (`project_id`, `user_id`),
  KEY `ix_project_managers_user` (`user_id`, `status`, `project_id`),
  KEY `ix_project_managers_appointed_by` (`appointed_by`),
  CONSTRAINT `fk_project_managers_member` FOREIGN KEY (`project_id`, `user_id`) REFERENCES `project_members` (`project_id`, `user_id`) ON DELETE RESTRICT ON UPDATE RESTRICT,
  CONSTRAINT `fk_project_managers_appointed_by` FOREIGN KEY (`appointed_by`) REFERENCES `users` (`id`) ON DELETE RESTRICT ON UPDATE RESTRICT,
  CONSTRAINT `ck_project_managers_status` CHECK (`status` IN ('ACTIVE','INACTIVE'))
) ENGINE=InnoDB ROW_FORMAT=DYNAMIC DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_0900_ai_ci;

CREATE TABLE `project_teams` (
  `id` BIGINT NOT NULL AUTO_INCREMENT,
  `project_id` BIGINT NOT NULL,
  `name` VARCHAR(120) NOT NULL,
  `lead_user_id` BIGINT NOT NULL,
  `status` VARCHAR(16) CHARACTER SET ascii COLLATE ascii_bin NOT NULL DEFAULT 'ACTIVE',
  `created_by` BIGINT NOT NULL,
  `created_at` DATETIME(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
  `updated_at` DATETIME(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
  `lock_version` INT UNSIGNED NOT NULL DEFAULT 0,
  PRIMARY KEY (`id`),
  UNIQUE KEY `uq_project_teams_project_name` (`project_id`, `name`),
  UNIQUE KEY `uq_project_teams_id_project` (`id`, `project_id`),
  KEY `ix_project_teams_lead` (`project_id`, `lead_user_id`),
  KEY `ix_project_teams_creator` (`created_by`),
  CONSTRAINT `fk_project_teams_project` FOREIGN KEY (`project_id`) REFERENCES `projects` (`id`) ON DELETE RESTRICT ON UPDATE RESTRICT,
  CONSTRAINT `fk_project_teams_lead` FOREIGN KEY (`project_id`, `lead_user_id`) REFERENCES `project_members` (`project_id`, `user_id`) ON DELETE RESTRICT ON UPDATE RESTRICT,
  CONSTRAINT `fk_project_teams_creator` FOREIGN KEY (`created_by`) REFERENCES `users` (`id`) ON DELETE RESTRICT ON UPDATE RESTRICT,
  CONSTRAINT `ck_project_teams_name` CHECK (CHAR_LENGTH(TRIM(`name`)) > 0),
  CONSTRAINT `ck_project_teams_status` CHECK (`status` IN ('ACTIVE','ARCHIVED'))
) ENGINE=InnoDB ROW_FORMAT=DYNAMIC DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_0900_ai_ci;

CREATE TABLE `team_members` (
  `team_id` BIGINT NOT NULL,
  `project_id` BIGINT NOT NULL,
  `user_id` BIGINT NOT NULL,
  `status` VARCHAR(16) CHARACTER SET ascii COLLATE ascii_bin NOT NULL DEFAULT 'ACTIVE',
  `joined_at` DATETIME(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
  `updated_at` DATETIME(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
  PRIMARY KEY (`team_id`, `user_id`),
  KEY `ix_team_members_team_project` (`team_id`, `project_id`),
  KEY `ix_team_members_project_user` (`project_id`, `user_id`),
  CONSTRAINT `fk_team_members_team` FOREIGN KEY (`team_id`, `project_id`) REFERENCES `project_teams` (`id`, `project_id`) ON DELETE RESTRICT ON UPDATE RESTRICT,
  CONSTRAINT `fk_team_members_project_member` FOREIGN KEY (`project_id`, `user_id`) REFERENCES `project_members` (`project_id`, `user_id`) ON DELETE RESTRICT ON UPDATE RESTRICT,
  CONSTRAINT `ck_team_members_status` CHECK (`status` IN ('ACTIVE','INACTIVE'))
) ENGINE=InnoDB ROW_FORMAT=DYNAMIC DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_0900_ai_ci;

CREATE TABLE `work_tasks` (
  `id` BIGINT NOT NULL AUTO_INCREMENT,
  `project_id` BIGINT NOT NULL,
  `team_id` BIGINT NOT NULL,
  `title` VARCHAR(240) NOT NULL,
  `description` TEXT NULL,
  `assignee_user_id` BIGINT NOT NULL,
  `created_by` BIGINT NOT NULL,
  `status` VARCHAR(16) CHARACTER SET ascii COLLATE ascii_bin NOT NULL DEFAULT 'OPEN',
  `accepted_by` BIGINT NULL,
  `accepted_at` DATETIME(6) NULL,
  `created_at` DATETIME(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
  `updated_at` DATETIME(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
  `lock_version` INT UNSIGNED NOT NULL DEFAULT 0,
  PRIMARY KEY (`id`),
  KEY `ix_work_tasks_team_status` (`team_id`, `status`, `id`),
  KEY `ix_work_tasks_project_status` (`project_id`, `status`, `id`),
  KEY `ix_work_tasks_assignee_status` (`assignee_user_id`, `status`, `id`),
  KEY `ix_work_tasks_created_by` (`created_by`),
  KEY `ix_work_tasks_accepted_by` (`accepted_by`),
  CONSTRAINT `fk_work_tasks_team` FOREIGN KEY (`team_id`, `project_id`) REFERENCES `project_teams` (`id`, `project_id`) ON DELETE RESTRICT ON UPDATE RESTRICT,
  CONSTRAINT `fk_work_tasks_assignee` FOREIGN KEY (`project_id`, `assignee_user_id`) REFERENCES `project_members` (`project_id`, `user_id`) ON DELETE RESTRICT ON UPDATE RESTRICT,
  CONSTRAINT `fk_work_tasks_created_by` FOREIGN KEY (`created_by`) REFERENCES `users` (`id`) ON DELETE RESTRICT ON UPDATE RESTRICT,
  CONSTRAINT `fk_work_tasks_accepted_by` FOREIGN KEY (`accepted_by`) REFERENCES `users` (`id`) ON DELETE RESTRICT ON UPDATE RESTRICT,
  CONSTRAINT `ck_work_tasks_title` CHECK (CHAR_LENGTH(TRIM(`title`)) > 0),
  CONSTRAINT `ck_work_tasks_status` CHECK (`status` IN ('OPEN','IN_PROGRESS','SUBMITTED','ACCEPTED','CANCELLED')),
  CONSTRAINT `ck_work_tasks_acceptance` CHECK ((`status` = 'ACCEPTED' AND `accepted_by` IS NOT NULL AND `accepted_at` IS NOT NULL) OR (`status` <> 'ACCEPTED' AND `accepted_by` IS NULL AND `accepted_at` IS NULL))
) ENGINE=InnoDB ROW_FORMAT=DYNAMIC DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_0900_ai_ci;

CREATE TABLE `work_task_events` (
  `id` BIGINT NOT NULL AUTO_INCREMENT,
  `task_id` BIGINT NOT NULL,
  `actor_user_id` BIGINT NOT NULL,
  `event_type` VARCHAR(16) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  `from_status` VARCHAR(16) CHARACTER SET ascii COLLATE ascii_bin NULL,
  `to_status` VARCHAR(16) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  `from_assignee_user_id` BIGINT NULL,
  `to_assignee_user_id` BIGINT NOT NULL,
  `note` VARCHAR(500) NULL,
  `created_at` DATETIME(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
  PRIMARY KEY (`id`),
  KEY `ix_work_task_events_task` (`task_id`, `id`),
  KEY `ix_work_task_events_actor` (`actor_user_id`, `created_at`),
  CONSTRAINT `fk_work_task_events_task` FOREIGN KEY (`task_id`) REFERENCES `work_tasks` (`id`) ON DELETE RESTRICT ON UPDATE RESTRICT,
  CONSTRAINT `fk_work_task_events_actor` FOREIGN KEY (`actor_user_id`) REFERENCES `users` (`id`) ON DELETE RESTRICT ON UPDATE RESTRICT,
  CONSTRAINT `ck_work_task_events_type` CHECK (`event_type` IN ('CREATED','STARTED','SUBMITTED','ACCEPTED','RETURNED','CANCELLED','REASSIGNED')),
  CONSTRAINT `ck_work_task_events_from_status` CHECK (`from_status` IS NULL OR `from_status` IN ('OPEN','IN_PROGRESS','SUBMITTED','ACCEPTED','CANCELLED')),
  CONSTRAINT `ck_work_task_events_to_status` CHECK (`to_status` IN ('OPEN','IN_PROGRESS','SUBMITTED','ACCEPTED','CANCELLED'))
) ENGINE=InnoDB ROW_FORMAT=DYNAMIC DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_0900_ai_ci;

-- R5.2-B task credit, handoff and contribution structures.
-- R5.2-B. Apply once after 20260926-collaboration.sql with a DDL-capable account.
-- MySQL DDL auto-commits: take a current backup and verify each statement before deployment.
ALTER TABLE `work_tasks`
  ADD COLUMN `reward_credit` BIGINT NOT NULL DEFAULT 0 AFTER `description`,
  ADD UNIQUE KEY `uq_work_tasks_id_project` (`id`, `project_id`),
  ADD CONSTRAINT `ck_work_tasks_reward` CHECK (`reward_credit` >= 0);

ALTER TABLE `work_task_events`
  DROP CHECK `ck_work_task_events_type`,
  ADD CONSTRAINT `ck_work_task_events_type` CHECK (`event_type` IN
    ('CREATED','STARTED','SUBMITTED','ACCEPTED','RETURNED','CANCELLED','REASSIGNED','HANDOFF_ACCEPTED'));

CREATE TABLE `task_handoff_offers` (
  `id` BIGINT NOT NULL AUTO_INCREMENT,
  `request_key` CHAR(36) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  `project_id` BIGINT NOT NULL,
  `task_id` BIGINT NOT NULL,
  `from_user_id` BIGINT NOT NULL,
  `to_user_id` BIGINT NOT NULL,
  `credit_amount` BIGINT NOT NULL,
  `note` VARCHAR(500) NULL,
  `status` VARCHAR(16) CHARACTER SET ascii COLLATE ascii_bin NOT NULL DEFAULT 'PENDING',
  `created_at` DATETIME(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
  `resolved_at` DATETIME(6) NULL,
  `pending_task_id` BIGINT GENERATED ALWAYS AS (CASE WHEN `status` = 'PENDING' THEN `task_id` ELSE NULL END) STORED,
  PRIMARY KEY (`id`),
  UNIQUE KEY `uq_handoff_request` (`request_key`),
  UNIQUE KEY `uq_handoff_id_project` (`id`, `project_id`),
  UNIQUE KEY `uq_handoff_pending_task` (`pending_task_id`),
  KEY `ix_handoff_task_status` (`task_id`, `status`, `id`),
  KEY `ix_handoff_recipient_status` (`to_user_id`, `status`, `id`),
  KEY `ix_handoff_project_task` (`project_id`, `task_id`),
  KEY `ix_handoff_project_from` (`project_id`, `from_user_id`),
  KEY `ix_handoff_project_to` (`project_id`, `to_user_id`),
  CONSTRAINT `fk_handoff_task` FOREIGN KEY (`task_id`, `project_id`) REFERENCES `work_tasks` (`id`, `project_id`) ON DELETE RESTRICT ON UPDATE RESTRICT,
  CONSTRAINT `fk_handoff_from` FOREIGN KEY (`project_id`, `from_user_id`) REFERENCES `project_members` (`project_id`, `user_id`) ON DELETE RESTRICT ON UPDATE RESTRICT,
  CONSTRAINT `fk_handoff_to` FOREIGN KEY (`project_id`, `to_user_id`) REFERENCES `project_members` (`project_id`, `user_id`) ON DELETE RESTRICT ON UPDATE RESTRICT,
  CONSTRAINT `ck_handoff_amount` CHECK (`credit_amount` > 0),
  CONSTRAINT `ck_handoff_distinct_users` CHECK (`from_user_id` <> `to_user_id`),
  CONSTRAINT `ck_handoff_status` CHECK (`status` IN ('PENDING','ACCEPTED','DECLINED','CANCELLED')),
  CONSTRAINT `ck_handoff_resolution` CHECK ((`status` = 'PENDING' AND `resolved_at` IS NULL) OR (`status` <> 'PENDING' AND `resolved_at` IS NOT NULL))
) ENGINE=InnoDB ROW_FORMAT=DYNAMIC DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_0900_ai_ci;

CREATE TABLE `credit_transfers` (
  `id` CHAR(36) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  `project_id` BIGINT NOT NULL,
  `sender_user_id` BIGINT NOT NULL,
  `recipient_user_id` BIGINT NOT NULL,
  `amount` BIGINT NOT NULL,
  `kind` VARCHAR(16) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  `offer_id` BIGINT NULL,
  `note` VARCHAR(500) NULL,
  `created_at` DATETIME(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
  PRIMARY KEY (`id`),
  UNIQUE KEY `uq_credit_transfers_id_project` (`id`, `project_id`),
  UNIQUE KEY `uq_credit_transfers_offer_project` (`offer_id`, `project_id`),
  KEY `ix_credit_transfers_project_created` (`project_id`, `created_at`, `id`),
  KEY `ix_credit_transfers_sender_created` (`sender_user_id`, `created_at`, `id`),
  KEY `ix_credit_transfers_recipient_created` (`recipient_user_id`, `created_at`, `id`),
  KEY `ix_credit_transfers_project_sender` (`project_id`, `sender_user_id`),
  KEY `ix_credit_transfers_project_recipient` (`project_id`, `recipient_user_id`),
  CONSTRAINT `fk_credit_transfers_project` FOREIGN KEY (`project_id`) REFERENCES `projects` (`id`) ON DELETE RESTRICT ON UPDATE RESTRICT,
  CONSTRAINT `fk_credit_transfers_sender` FOREIGN KEY (`project_id`, `sender_user_id`) REFERENCES `project_members` (`project_id`, `user_id`) ON DELETE RESTRICT ON UPDATE RESTRICT,
  CONSTRAINT `fk_credit_transfers_recipient` FOREIGN KEY (`project_id`, `recipient_user_id`) REFERENCES `project_members` (`project_id`, `user_id`) ON DELETE RESTRICT ON UPDATE RESTRICT,
  CONSTRAINT `fk_credit_transfers_offer` FOREIGN KEY (`offer_id`, `project_id`) REFERENCES `task_handoff_offers` (`id`, `project_id`) ON DELETE RESTRICT ON UPDATE RESTRICT,
  CONSTRAINT `ck_credit_transfers_amount` CHECK (`amount` > 0),
  CONSTRAINT `ck_credit_transfers_distinct_users` CHECK (`sender_user_id` <> `recipient_user_id`),
  CONSTRAINT `ck_credit_transfers_kind` CHECK ((`kind` = 'PEER' AND `offer_id` IS NULL) OR (`kind` = 'HANDOFF' AND `offer_id` IS NOT NULL))
) ENGINE=InnoDB ROW_FORMAT=DYNAMIC DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_0900_ai_ci;

CREATE TABLE `contribution_events` (
  `id` BIGINT NOT NULL AUTO_INCREMENT,
  `project_id` BIGINT NOT NULL,
  `user_id` BIGINT NOT NULL,
  `task_id` BIGINT NOT NULL,
  `points` INT NOT NULL,
  `event_type` VARCHAR(24) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  `created_at` DATETIME(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
  PRIMARY KEY (`id`),
  UNIQUE KEY `uq_contribution_task` (`task_id`),
  KEY `ix_contribution_project_created` (`project_id`, `created_at`, `user_id`),
  KEY `ix_contribution_user_created` (`user_id`, `created_at`, `id`),
  KEY `ix_contribution_project_user` (`project_id`, `user_id`),
  CONSTRAINT `fk_contribution_task` FOREIGN KEY (`task_id`, `project_id`) REFERENCES `work_tasks` (`id`, `project_id`) ON DELETE RESTRICT ON UPDATE RESTRICT,
  CONSTRAINT `fk_contribution_member` FOREIGN KEY (`project_id`, `user_id`) REFERENCES `project_members` (`project_id`, `user_id`) ON DELETE RESTRICT ON UPDATE RESTRICT,
  CONSTRAINT `ck_contribution_points` CHECK (`points` = 1),
  CONSTRAINT `ck_contribution_type` CHECK (`event_type` = 'TASK_ACCEPTED')
) ENGINE=InnoDB ROW_FORMAT=DYNAMIC DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_0900_ai_ci;

ALTER TABLE `credit_transactions`
  DROP CHECK `ck_credit_transactions_type`,
  MODIFY COLUMN `type` VARCHAR(24) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  ADD COLUMN `project_id` BIGINT NULL AFTER `batch_id`,
  ADD COLUMN `transfer_id` CHAR(36) CHARACTER SET ascii COLLATE ascii_bin NULL AFTER `project_id`,
  ADD COLUMN `task_id` BIGINT NULL AFTER `transfer_id`,
  ADD UNIQUE KEY `uq_credit_transfer_user` (`transfer_id`, `user_id`),
  ADD UNIQUE KEY `uq_credit_task_reward` (`task_id`, `type`),
  ADD KEY `ix_credit_project_created` (`project_id`, `created_at`, `id`),
  ADD CONSTRAINT `fk_credit_tx_project` FOREIGN KEY (`project_id`) REFERENCES `projects` (`id`) ON DELETE RESTRICT ON UPDATE RESTRICT,
  ADD CONSTRAINT `fk_credit_tx_transfer` FOREIGN KEY (`transfer_id`, `project_id`) REFERENCES `credit_transfers` (`id`, `project_id`) ON DELETE RESTRICT ON UPDATE RESTRICT,
  ADD CONSTRAINT `fk_credit_tx_task` FOREIGN KEY (`task_id`, `project_id`) REFERENCES `work_tasks` (`id`, `project_id`) ON DELETE RESTRICT ON UPDATE RESTRICT,
  ADD CONSTRAINT `ck_credit_transactions_type` CHECK (
    (`type` IN ('GRANT','RECLAIM') AND `project_id` IS NULL AND `transfer_id` IS NULL AND `task_id` IS NULL) OR
    (`type` IN ('PEER_TRANSFER_OUT','PEER_TRANSFER_IN','HANDOFF_OUT','HANDOFF_IN') AND `project_id` IS NOT NULL AND `transfer_id` IS NOT NULL AND `task_id` IS NULL) OR
    (`type` = 'TASK_REWARD' AND `project_id` IS NOT NULL AND `transfer_id` IS NULL AND `task_id` IS NOT NULL));
