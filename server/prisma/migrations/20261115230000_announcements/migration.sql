-- Landlord → tenants announcements, with a recipient snapshot and "viewed" tracking.
CREATE TABLE `announcements` (
    `id` CHAR(36) NOT NULL,
    `landlord_id` CHAR(36) NOT NULL,
    `title` VARCHAR(100) NOT NULL,
    `body` TEXT NOT NULL,
    `audience` VARCHAR(20) NOT NULL,
    `audience_label` VARCHAR(255) NOT NULL,
    `property_ids` JSON NULL,
    `image_key` VARCHAR(255) NULL,
    `image_mime` VARCHAR(50) NULL,
    `recipient_count` INTEGER NOT NULL DEFAULT 0,
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    INDEX `announcements_landlord_id_created_at_idx`(`landlord_id`, `created_at`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

CREATE TABLE `announcement_recipients` (
    `id` CHAR(36) NOT NULL,
    `announcement_id` CHAR(36) NOT NULL,
    `lease_id` CHAR(36) NOT NULL,
    `tenant_id` CHAR(36) NOT NULL,
    `viewed_at` DATETIME(3) NULL,
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    UNIQUE INDEX `announcement_recipients_announcement_id_tenant_id_key`(`announcement_id`, `tenant_id`),
    INDEX `announcement_recipients_tenant_id_created_at_idx`(`tenant_id`, `created_at`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

ALTER TABLE `announcement_recipients` ADD CONSTRAINT `announcement_recipients_announcement_id_fkey` FOREIGN KEY (`announcement_id`) REFERENCES `announcements`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;
