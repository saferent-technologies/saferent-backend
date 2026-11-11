-- Property / unit documents: sharing, versions, archive; tenant document requests
ALTER TABLE `property_documents`
    ADD COLUMN `room_id` CHAR(36) NULL,
    ADD COLUMN `bed_id` CHAR(36) NULL,
    ADD COLUMN `custom_name` VARCHAR(150) NULL,
    ADD COLUMN `description` VARCHAR(1000) NULL,
    ADD COLUMN `document_date` DATE NULL,
    ADD COLUMN `expiry_date` DATE NULL,
    ADD COLUMN `shared_with_tenant` BOOLEAN NOT NULL DEFAULT false,
    ADD COLUMN `shared_notified_at` DATETIME(3) NULL,
    ADD COLUMN `needs_verification` BOOLEAN NOT NULL DEFAULT true,
    ADD COLUMN `group_id` CHAR(36) NULL,
    ADD COLUMN `version` INTEGER NOT NULL DEFAULT 1,
    ADD COLUMN `is_current` BOOLEAN NOT NULL DEFAULT true,
    ADD COLUMN `archived_at` DATETIME(3) NULL,
    ADD COLUMN `archived_by_id` CHAR(36) NULL,
    ADD COLUMN `file_size` INTEGER NULL,
    ADD COLUMN `updated_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3);
CREATE INDEX `property_documents_property_id_is_current_archived_at_idx` ON `property_documents`(`property_id`, `is_current`, `archived_at`);
CREATE INDEX `property_documents_group_id_version_idx` ON `property_documents`(`group_id`, `version`);
-- Existing non-ownership uploads never needed SafeRent verification.
UPDATE `property_documents` SET `needs_verification` = false WHERE `doc_type` NOT IN ('OWNERSHIP_PROOF', 'SALE_DEED', 'PROPERTY_TAX_RECEIPT');

CREATE TABLE `document_requests` (
    `id` CHAR(36) NOT NULL,
    `code` VARCHAR(20) NOT NULL,
    `tenant_id` CHAR(36) NOT NULL,
    `landlord_id` CHAR(36) NOT NULL,
    `lease_id` CHAR(36) NOT NULL,
    `property_id` CHAR(36) NOT NULL,
    `unit_id` CHAR(36) NULL,
    `bed_id` CHAR(36) NULL,
    `document_name` VARCHAR(150) NOT NULL,
    `reason` VARCHAR(1000) NULL,
    `status` ENUM('PENDING', 'IN_PROGRESS', 'FULFILLED', 'REJECTED', 'CANCELLED') NOT NULL DEFAULT 'PENDING',
    `linked_document_id` CHAR(36) NULL,
    `rejection_reason` VARCHAR(500) NULL,
    `responded_by_id` CHAR(36) NULL,
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updated_at` DATETIME(3) NOT NULL,
    UNIQUE INDEX `document_requests_code_key`(`code`),
    INDEX `document_requests_property_id_status_idx`(`property_id`, `status`),
    INDEX `document_requests_tenant_id_status_idx`(`tenant_id`, `status`),
    INDEX `document_requests_landlord_id_status_idx`(`landlord_id`, `status`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;
