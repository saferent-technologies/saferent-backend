-- Tenant ID documents vault: encrypted pages (envelope encryption), shares with a lease's landlord,
-- and an access log (ids only).
CREATE TABLE `tenant_documents` (
    `id` CHAR(36) NOT NULL,
    `tenant_id` CHAR(36) NOT NULL,
    `type` VARCHAR(30) NOT NULL,
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    INDEX `tenant_documents_tenant_id_type_idx`(`tenant_id`, `type`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

CREATE TABLE `tenant_document_pages` (
    `id` CHAR(36) NOT NULL,
    `document_id` CHAR(36) NOT NULL,
    `page_no` INTEGER NOT NULL,
    `storage_key` VARCHAR(255) NOT NULL,
    `mime_type` VARCHAR(20) NOT NULL,
    `size` INTEGER NOT NULL,
    `iv` VARCHAR(32) NOT NULL,
    `auth_tag` VARCHAR(32) NOT NULL,
    `wrapped_key` VARCHAR(255) NOT NULL,
    `key_id` VARCHAR(40) NOT NULL,
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    UNIQUE INDEX `tenant_document_pages_document_id_page_no_key`(`document_id`, `page_no`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

CREATE TABLE `tenant_document_shares` (
    `id` CHAR(36) NOT NULL,
    `document_id` CHAR(36) NOT NULL,
    `lease_id` CHAR(36) NOT NULL,
    `landlord_id` CHAR(36) NOT NULL,
    `tenant_id` CHAR(36) NOT NULL,
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    UNIQUE INDEX `tenant_document_shares_document_id_lease_id_key`(`document_id`, `lease_id`),
    INDEX `tenant_document_shares_lease_id_idx`(`lease_id`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

CREATE TABLE `tenant_document_access_logs` (
    `id` CHAR(36) NOT NULL,
    `actor_id` CHAR(36) NOT NULL,
    `action` VARCHAR(20) NOT NULL,
    `document_id` CHAR(36) NULL,
    `page_id` CHAR(36) NULL,
    `lease_id` CHAR(36) NULL,
    `tenant_id` CHAR(36) NULL,
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    INDEX `tenant_document_access_logs_tenant_id_created_at_idx`(`tenant_id`, `created_at`),
    INDEX `tenant_document_access_logs_document_id_idx`(`document_id`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

ALTER TABLE `tenant_document_pages` ADD CONSTRAINT `tenant_document_pages_document_id_fkey` FOREIGN KEY (`document_id`) REFERENCES `tenant_documents`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE `tenant_document_shares` ADD CONSTRAINT `tenant_document_shares_document_id_fkey` FOREIGN KEY (`document_id`) REFERENCES `tenant_documents`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;
