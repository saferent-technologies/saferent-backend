-- Android / client app configuration: versioned, append-only snapshots (history + rollback)
CREATE TABLE `app_config_versions` (
    `id` CHAR(36) NOT NULL,
    `version` INTEGER NOT NULL,
    `data` JSON NOT NULL,
    `action` VARCHAR(20) NOT NULL,
    `note` VARCHAR(300) NULL,
    `rolled_back_from_version` INTEGER NULL,
    `changed_paths` JSON NULL,
    `created_by_id` CHAR(36) NULL,
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updated_at` DATETIME(3) NOT NULL,
    UNIQUE INDEX `app_config_versions_version_key`(`version`),
    INDEX `app_config_versions_created_at_idx`(`created_at`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;
