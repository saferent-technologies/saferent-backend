-- What an owner asks a tenant when inviting them, and the tenant's answers (minimum data; references encrypted).
ALTER TABLE `tenant_invitations` ADD COLUMN `requirements` JSON NULL;

CREATE TABLE `tenant_rental_details` (
    `id` CHAR(36) NOT NULL,
    `tenant_id` CHAR(36) NOT NULL,
    `invitation_id` CHAR(36) NOT NULL,
    `lease_id` CHAR(36) NULL,
    `tenant_type` VARCHAR(30) NULL,
    `employment_type` VARCHAR(30) NULL,
    `company_name` VARCHAR(120) NULL,
    `adults` INTEGER NULL,
    `children` INTEGER NULL,
    `has_pets` BOOLEAN NULL,
    `pet_details` VARCHAR(120) NULL,
    `smokes` BOOLEAN NULL,
    `stay_months` INTEGER NULL,
    `references_enc` TEXT NULL,
    `background_consent_at` DATETIME(3) NULL,
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updated_at` DATETIME(3) NOT NULL,

    UNIQUE INDEX `tenant_rental_details_invitation_id_key`(`invitation_id`),
    INDEX `tenant_rental_details_tenant_id_idx`(`tenant_id`),
    INDEX `tenant_rental_details_lease_id_idx`(`lease_id`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;
