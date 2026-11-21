-- Undo an accepted lease close (the other side must agree).
CREATE TABLE `lease_exit_undos` (
  `id` CHAR(36) NOT NULL,
  `exit_request_id` CHAR(36) NOT NULL,
  `lease_id` CHAR(36) NOT NULL,
  `open_exit_id` CHAR(36) NULL,
  `requested_by_id` CHAR(36) NOT NULL,
  `requested_by_role` ENUM('TENANT', 'LANDLORD') NOT NULL,
  `reason` TEXT NOT NULL,
  `status` ENUM('PENDING', 'ACCEPTED', 'DECLINED', 'CANCELLED') NOT NULL DEFAULT 'PENDING',
  `responded_by_id` CHAR(36) NULL,
  `responded_at` DATETIME(3) NULL,
  `response_note` VARCHAR(1000) NULL,
  `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  `updated_at` DATETIME(3) NOT NULL,
  UNIQUE INDEX `lease_exit_undos_open_exit_id_key`(`open_exit_id`),
  INDEX `lease_exit_undos_exit_request_id_created_at_idx`(`exit_request_id`, `created_at`),
  INDEX `lease_exit_undos_lease_id_idx`(`lease_id`),
  PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

ALTER TABLE `lease_exit_undos` ADD CONSTRAINT `lease_exit_undos_exit_request_id_fkey` FOREIGN KEY (`exit_request_id`) REFERENCES `lease_exit_requests`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;
