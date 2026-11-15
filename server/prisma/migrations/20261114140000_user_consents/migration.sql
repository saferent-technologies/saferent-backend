-- Consent records: append-only audit log of Terms / Privacy acceptance and WhatsApp opt-in / opt-out.
CREATE TABLE `user_consents` (
    `id` BIGINT NOT NULL AUTO_INCREMENT,
    `user_uid` VARCHAR(128) NOT NULL,
    `consent_type` ENUM('TERMS', 'PRIVACY', 'WHATSAPP') NOT NULL,
    `version` VARCHAR(32) NOT NULL,
    `granted` BOOLEAN NOT NULL DEFAULT true,
    `accepted_at` DATETIME(3) NOT NULL,
    `client_accepted_at` DATETIME(3) NULL,
    `role` ENUM('TENANT', 'LANDLORD') NULL,
    `source` ENUM('ANDROID', 'IOS', 'WEB') NOT NULL,
    `app_version` VARCHAR(32) NULL,
    `ip_address` VARCHAR(45) NULL,
    `user_agent` VARCHAR(255) NULL,
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    INDEX `user_consents_user_uid_consent_type_accepted_at_idx`(`user_uid`, `consent_type`, `accepted_at`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- Append-only: the database itself refuses UPDATE and DELETE (TRUNCATE in a test reset is unaffected).
CREATE TRIGGER `user_consents_no_update` BEFORE UPDATE ON `user_consents`
FOR EACH ROW SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'user_consents is append-only: insert a new row instead of updating';

CREATE TRIGGER `user_consents_no_delete` BEFORE DELETE ON `user_consents`
FOR EACH ROW SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'user_consents is append-only: rows cannot be deleted';
