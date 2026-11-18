-- Tenant "Open to new homes" alerts: one per user, the listings already pushed, and a per-listing flag
-- that queues matching (set when a listing goes live or a unit / bed frees up).
CREATE TABLE `home_alerts` (
    `id` CHAR(36) NOT NULL,
    `user_id` CHAR(36) NOT NULL,
    `enabled` BOOLEAN NOT NULL DEFAULT false,
    `latitude` DECIMAL(9, 6) NULL,
    `longitude` DECIMAL(9, 6) NULL,
    `area_label` VARCHAR(120) NULL,
    `radius_km` INTEGER NOT NULL DEFAULT 5,
    `max_rent` INTEGER NULL,
    `property_types` JSON NULL,
    `last_digest_at` DATETIME(3) NULL,
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updated_at` DATETIME(3) NOT NULL,

    UNIQUE INDEX `home_alerts_user_id_key`(`user_id`),
    INDEX `home_alerts_enabled_latitude_longitude_idx`(`enabled`, `latitude`, `longitude`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

CREATE TABLE `home_alert_matches` (
    `id` CHAR(36) NOT NULL,
    `user_id` CHAR(36) NOT NULL,
    `property_id` CHAR(36) NOT NULL,
    `pushed` BOOLEAN NOT NULL DEFAULT true,
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    UNIQUE INDEX `home_alert_matches_user_id_property_id_key`(`user_id`, `property_id`),
    INDEX `home_alert_matches_user_id_created_at_idx`(`user_id`, `created_at`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

ALTER TABLE `properties` ADD COLUMN `home_alert_pending_at` DATETIME(3) NULL;
CREATE INDEX `properties_home_alert_pending_at_idx` ON `properties`(`home_alert_pending_at`);
