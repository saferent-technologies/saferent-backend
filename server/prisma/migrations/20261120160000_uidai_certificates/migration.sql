-- UIDAI Offline e-KYC certificates uploaded from the Super Admin portal.
CREATE TABLE `uidai_certificates` (
  `id` CHAR(36) NOT NULL,
  `pem` TEXT NOT NULL,
  `fingerprint` VARCHAR(100) NOT NULL,
  `subject` VARCHAR(300) NOT NULL,
  `valid_from` DATETIME(3) NOT NULL,
  `valid_to` DATETIME(3) NOT NULL,
  `uploaded_by_id` CHAR(36) NULL,
  `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  UNIQUE INDEX `uidai_certificates_fingerprint_key`(`fingerprint`),
  PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;
