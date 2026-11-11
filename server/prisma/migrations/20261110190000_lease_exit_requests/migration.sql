-- Mutual lease close requests
CREATE TABLE `lease_exit_requests` (
    `id` CHAR(36) NOT NULL,
    `lease_id` CHAR(36) NOT NULL,
    `open_lease_id` CHAR(36) NULL,
    `requested_by_id` CHAR(36) NOT NULL,
    `requested_by_role` ENUM('TENANT', 'LANDLORD') NOT NULL,
    `reason` TEXT NOT NULL,
    `move_out_date` DATE NOT NULL,
    `status` ENUM('PENDING', 'ACCEPTED', 'DECLINED', 'CANCELLED', 'COMPLETED') NOT NULL DEFAULT 'PENDING',
    `responded_by_id` CHAR(36) NULL,
    `responded_at` DATETIME(3) NULL,
    `response_note` VARCHAR(1000) NULL,
    `requester_review` JSON NULL,
    `responder_review` JSON NULL,
    `completed_at` DATETIME(3) NULL,
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updated_at` DATETIME(3) NOT NULL,
    UNIQUE INDEX `lease_exit_requests_open_lease_id_key`(`open_lease_id`),
    INDEX `lease_exit_requests_lease_id_created_at_idx`(`lease_id`, `created_at`),
    INDEX `lease_exit_requests_status_move_out_date_idx`(`status`, `move_out_date`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

ALTER TABLE `lease_exit_requests` ADD CONSTRAINT `lease_exit_requests_lease_id_fkey` FOREIGN KEY (`lease_id`) REFERENCES `leases`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;
