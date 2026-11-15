-- Change requests for approved / live properties: edits go to a hidden working copy of the property
-- and reach the live listing only after SafeRent approves them.
ALTER TABLE `properties` ADD COLUMN `revision_of_id` CHAR(36) NULL;
CREATE INDEX `properties_revision_of_id_idx` ON `properties`(`revision_of_id`);
ALTER TABLE `property_units` ADD COLUMN `source_id` CHAR(36) NULL;
ALTER TABLE `property_rooms` ADD COLUMN `source_id` CHAR(36) NULL;
ALTER TABLE `property_beds` ADD COLUMN `source_id` CHAR(36) NULL;
ALTER TABLE `property_images` ADD COLUMN `source_id` CHAR(36) NULL;

CREATE TABLE `property_revisions` (
    `id` CHAR(36) NOT NULL,
    `property_id` CHAR(36) NOT NULL,
    `landlord_id` CHAR(36) NOT NULL,
    `status` ENUM('DRAFT', 'PENDING_VERIFICATION', 'APPROVED', 'REJECTED', 'DISCARDED') NOT NULL DEFAULT 'DRAFT',
    `draft_property_id` CHAR(36) NULL,
    `data` JSON NULL,
    `changed_sections` JSON NULL,
    `moderation_note` VARCHAR(500) NULL,
    `created_by_id` CHAR(36) NOT NULL,
    `decided_by_id` CHAR(36) NULL,
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `submitted_at` DATETIME(3) NULL,
    `decided_at` DATETIME(3) NULL,
    `version` INTEGER NOT NULL DEFAULT 1,
    `updated_at` DATETIME(3) NOT NULL,

    UNIQUE INDEX `property_revisions_draft_property_id_key`(`draft_property_id`),
    INDEX `property_revisions_property_id_status_idx`(`property_id`, `status`),
    INDEX `property_revisions_status_submitted_at_idx`(`status`, `submitted_at`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;
