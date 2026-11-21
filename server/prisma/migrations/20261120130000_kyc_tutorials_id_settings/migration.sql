-- Owner verification guides (app) + Super Admin on/off per ID type.
CREATE TABLE `kyc_tutorials` (
  `id` CHAR(36) NOT NULL,
  `title` VARCHAR(120) NOT NULL,
  `type` VARCHAR(10) NOT NULL,
  `external_url` VARCHAR(500) NULL,
  `file_path` VARCHAR(255) NULL,
  `mime_type` VARCHAR(50) NULL,
  `size_bytes` INTEGER NULL,
  `note` VARCHAR(150) NULL,
  `order` INTEGER NOT NULL DEFAULT 0,
  `active` BOOLEAN NOT NULL DEFAULT true,
  `created_by_id` CHAR(36) NULL,
  `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  `updated_at` DATETIME(3) NOT NULL,
  INDEX `kyc_tutorials_active_order_idx`(`active`, `order`),
  PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

CREATE TABLE `kyc_id_type_settings` (
  `type` VARCHAR(20) NOT NULL,
  `enabled` BOOLEAN NOT NULL DEFAULT true,
  `updated_by_id` CHAR(36) NULL,
  `updated_at` DATETIME(3) NOT NULL,
  PRIMARY KEY (`type`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;
