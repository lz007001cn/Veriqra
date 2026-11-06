ALTER TABLE `test_runs`
  ADD COLUMN `assignee_id` BIGINT NULL DEFAULT NULL,
  ADD KEY `ix_runs_assignee_status` (`project_id`, `assignee_id`, `status`),
  ADD CONSTRAINT `fk_test_runs_assignee` FOREIGN KEY (`project_id`, `assignee_id`)
    REFERENCES `project_members` (`project_id`, `user_id`) ON DELETE RESTRICT ON UPDATE RESTRICT;
