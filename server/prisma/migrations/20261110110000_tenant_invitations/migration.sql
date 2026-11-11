-- Tenant invitation links + extra lease terms
ALTER TABLE `leases`
    ADD COLUMN `maintenance_charges` DECIMAL(12, 2) NULL,
    ADD COLUMN `notice_period_days` INTEGER NULL,
    ADD COLUMN `lock_in_months` INTEGER NULL,
    ADD COLUMN `invitation_id` CHAR(36) NULL,
    ADD UNIQUE INDEX `leases_invitation_id_key`(`invitation_id`);

CREATE TABLE `tenant_invitations` (
    `id` CHAR(36) NOT NULL,
    `code` VARCHAR(20) NOT NULL,
    `token_hash` CHAR(64) NOT NULL,
    `property_id` CHAR(36) NOT NULL,
    `unit_id` CHAR(36) NULL,
    `bed_id` CHAR(36) NULL,
    `landlord_id` CHAR(36) NOT NULL,
    `created_by_id` CHAR(36) NOT NULL,
    `recipient_name` VARCHAR(120) NOT NULL,
    `recipient_phone` VARCHAR(20) NULL,
    `recipient_email` VARCHAR(254) NULL,
    `monthly_rent` DECIMAL(12, 2) NOT NULL,
    `security_deposit` DECIMAL(12, 2) NOT NULL,
    `maintenance_charges` DECIMAL(12, 2) NULL,
    `other_charges` JSON NULL,
    `start_date` DATE NOT NULL,
    `end_date` DATE NULL,
    `rent_due_day` INTEGER NOT NULL,
    `notice_period_days` INTEGER NULL,
    `lock_in_months` INTEGER NULL,
    `additional_terms` TEXT NULL,
    `status` ENUM('PENDING', 'ACCEPTED', 'REJECTED', 'REVOKED', 'EXPIRED') NOT NULL DEFAULT 'PENDING',
    `expires_at` DATETIME(3) NOT NULL,
    `responded_by_id` CHAR(36) NULL,
    `responded_at` DATETIME(3) NULL,
    `revoked_by_id` CHAR(36) NULL,
    `lease_id` CHAR(36) NULL,
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updated_at` DATETIME(3) NOT NULL,

    UNIQUE INDEX `tenant_invitations_code_key`(`code`),
    UNIQUE INDEX `tenant_invitations_token_hash_key`(`token_hash`),
    UNIQUE INDEX `tenant_invitations_lease_id_key`(`lease_id`),
    INDEX `tenant_invitations_property_id_status_idx`(`property_id`, `status`),
    INDEX `tenant_invitations_landlord_id_status_idx`(`landlord_id`, `status`),
    INDEX `tenant_invitations_unit_id_status_idx`(`unit_id`, `status`),
    INDEX `tenant_invitations_bed_id_status_idx`(`bed_id`, `status`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

ALTER TABLE `tenant_invitations` ADD CONSTRAINT `tenant_invitations_property_id_fkey` FOREIGN KEY (`property_id`) REFERENCES `properties`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;
