-- History of lease date changes (move-in / "occupied since"): who changed it, when, from → to and why.
CREATE TABLE `lease_date_changes` (
    `id` CHAR(36) NOT NULL,
    `lease_id` CHAR(36) NOT NULL,
    `field` VARCHAR(30) NOT NULL,
    `old_value` DATE NOT NULL,
    `new_value` DATE NOT NULL,
    `reason` VARCHAR(500) NOT NULL,
    `changed_by_id` CHAR(36) NOT NULL,
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    INDEX `lease_date_changes_lease_id_created_at_idx`(`lease_id`, `created_at`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

ALTER TABLE `lease_date_changes` ADD CONSTRAINT `lease_date_changes_lease_id_fkey` FOREIGN KEY (`lease_id`) REFERENCES `leases`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;
