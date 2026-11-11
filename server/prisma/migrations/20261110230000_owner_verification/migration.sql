-- Owner verification: DigiLocker identity + live selfie, reviewed by staff
ALTER TABLE `landlord_profiles`
    ADD COLUMN `kyc_submitted_at` DATETIME(3) NULL,
    ADD COLUMN `selfie_path` VARCHAR(255) NULL;

CREATE TABLE `identity_verifications` (
    `id` CHAR(36) NOT NULL,
    `user_id` CHAR(36) NOT NULL,
    `provider` ENUM('SETU', 'MOCK') NOT NULL,
    `provider_ref` VARCHAR(80) NOT NULL,
    `status` ENUM('STARTED', 'COMPLETED', 'FAILED') NOT NULL DEFAULT 'STARTED',
    `name` VARCHAR(150) NULL,
    `dob` VARCHAR(20) NULL,
    `gender` VARCHAR(10) NULL,
    `aadhaar_last4` VARCHAR(4) NULL,
    `city` VARCHAR(80) NULL,
    `state` VARCHAR(80) NULL,
    `pincode` VARCHAR(10) NULL,
    `photo_path` VARCHAR(255) NULL,
    `error` VARCHAR(300) NULL,
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `completed_at` DATETIME(3) NULL,
    UNIQUE INDEX `identity_verifications_provider_ref_key`(`provider_ref`),
    INDEX `identity_verifications_user_id_created_at_idx`(`user_id`, `created_at`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;
