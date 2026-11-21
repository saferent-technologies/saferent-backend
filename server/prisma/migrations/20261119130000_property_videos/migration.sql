-- Video tours: one per building / unit / room, moderated.
CREATE TABLE `property_videos` (
  `id` CHAR(36) NOT NULL,
  `property_id` CHAR(36) NOT NULL,
  `unit_id` CHAR(36) NULL,
  `room_id` CHAR(36) NULL,
  `slot_key` VARCHAR(60) NOT NULL,
  `file_path` VARCHAR(255) NOT NULL,
  `mime_type` VARCHAR(50) NOT NULL DEFAULT 'video/mp4',
  `size_bytes` INTEGER NOT NULL,
  `duration_sec` INTEGER NOT NULL,
  `thumbnail_path` VARCHAR(255) NULL,
  `thumbnail_mime` VARCHAR(50) NULL,
  `status` ENUM('PENDING', 'APPROVED', 'REJECTED') NOT NULL DEFAULT 'PENDING',
  `rejection_reason` VARCHAR(500) NULL,
  `uploaded_by_id` CHAR(36) NOT NULL,
  `reviewed_by_id` CHAR(36) NULL,
  `reviewed_at` DATETIME(3) NULL,
  `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  `updated_at` DATETIME(3) NOT NULL,
  UNIQUE INDEX `property_videos_property_id_slot_key_key`(`property_id`, `slot_key`),
  INDEX `property_videos_status_created_at_idx`(`status`, `created_at`),
  PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

ALTER TABLE `property_videos` ADD CONSTRAINT `property_videos_property_id_fkey` FOREIGN KEY (`property_id`) REFERENCES `properties`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;
