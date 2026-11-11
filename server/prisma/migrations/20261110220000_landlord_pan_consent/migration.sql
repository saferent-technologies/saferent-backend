-- Landlord PAN + consent to share it with tenants (HRA)
ALTER TABLE `landlord_profiles`
    ADD COLUMN `pan` VARCHAR(10) NULL,
    ADD COLUMN `pan_share_all` BOOLEAN NOT NULL DEFAULT false,
    ADD COLUMN `pan_share_all_at` DATETIME(3) NULL;

CREATE TABLE `pan_share_requests` (
    `id` CHAR(36) NOT NULL,
    `lease_id` CHAR(36) NOT NULL,
    `tenant_id` CHAR(36) NOT NULL,
    `landlord_id` CHAR(36) NOT NULL,
    `status` ENUM('PENDING', 'APPROVED', 'DENIED', 'REVOKED') NOT NULL DEFAULT 'PENDING',
    `note` VARCHAR(300) NULL,
    `requested_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `decided_at` DATETIME(3) NULL,
    `decided_by_id` CHAR(36) NULL,
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updated_at` DATETIME(3) NOT NULL,
    UNIQUE INDEX `pan_share_requests_lease_id_key`(`lease_id`),
    INDEX `pan_share_requests_landlord_id_status_idx`(`landlord_id`, `status`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

ALTER TABLE `pan_share_requests` ADD CONSTRAINT `pan_share_requests_lease_id_fkey` FOREIGN KEY (`lease_id`) REFERENCES `leases`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;
