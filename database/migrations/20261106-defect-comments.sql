CREATE TABLE `defect_comments` (
  `id` BIGINT NOT NULL AUTO_INCREMENT,
  `defect_id` BIGINT NOT NULL,
  `author_id` BIGINT NOT NULL,
  `comment_text` TEXT NOT NULL,
  `log_url` VARCHAR(2048) NULL,
  `image_content_type` VARCHAR(10) CHARACTER SET ascii COLLATE ascii_bin NULL,
  `image_bytes` MEDIUMBLOB NULL,
  `request_key` CHAR(36) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  `payload_sha256` BINARY(32) NOT NULL,
  `created_at` DATETIME(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
  PRIMARY KEY (`id`),
  UNIQUE KEY `uq_defect_comment_request` (`defect_id`, `author_id`, `request_key`),
  KEY `ix_defect_comment_thread` (`defect_id`, `id`),
  KEY `ix_defect_comment_author` (`author_id`),
  CONSTRAINT `fk_defect_comment_defect` FOREIGN KEY (`defect_id`) REFERENCES `defects` (`id`) ON DELETE RESTRICT ON UPDATE RESTRICT,
  CONSTRAINT `fk_defect_comment_author` FOREIGN KEY (`author_id`) REFERENCES `users` (`id`) ON DELETE RESTRICT ON UPDATE RESTRICT,
  CONSTRAINT `ck_defect_comment_image` CHECK ((`image_content_type` IS NULL AND `image_bytes` IS NULL) OR
    (`image_content_type` IS NOT NULL AND `image_content_type` IN ('image/png','image/jpeg') AND `image_bytes` IS NOT NULL AND OCTET_LENGTH(`image_bytes`) BETWEEN 1 AND 2097152)),
  CONSTRAINT `ck_defect_comment_text` CHECK (CHAR_LENGTH(`comment_text`) <= 4000 AND
    (CHAR_LENGTH(TRIM(`comment_text`)) > 0 OR `log_url` IS NOT NULL OR `image_bytes` IS NOT NULL))
) ENGINE=InnoDB ROW_FORMAT=DYNAMIC DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_0900_ai_ci;
