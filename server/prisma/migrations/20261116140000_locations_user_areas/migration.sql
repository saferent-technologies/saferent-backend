-- Locations: normalized keys (no duplicates, ever), user counts; users' approximate area; home alerts
-- by locality / city.

ALTER TABLE `locations`
  ADD COLUMN `name_key` VARCHAR(120) NOT NULL DEFAULT '',
  ADD COLUMN `city_key` VARCHAR(80) NOT NULL DEFAULT '',
  ADD COLUMN `state_key` VARCHAR(80) NOT NULL DEFAULT '',
  ADD COLUMN `user_count` INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3);

UPDATE `locations` SET
  `name_key` = LOWER(TRIM(REGEXP_REPLACE(`name`, '[[:space:]]+', ' '))),
  `city_key` = IF(`kind` = 'LOCALITY', LOWER(TRIM(REGEXP_REPLACE(COALESCE(`city`, ''), '[[:space:]]+', ' '))), ''),
  `state_key` = LOWER(TRIM(REGEXP_REPLACE(COALESCE(`state`, ''), '[[:space:]]+', ' ')));

-- Merge duplicates into the oldest row (counts are recomputed by the locations job; nothing references ids).
DELETE l1 FROM `locations` l1
  JOIN `locations` l2
    ON l1.`kind` = l2.`kind` AND l1.`name_key` = l2.`name_key` AND l1.`city_key` = l2.`city_key` AND l1.`state_key` = l2.`state_key` AND l1.`id` > l2.`id`;

CREATE UNIQUE INDEX `locations_kind_name_key_city_key_state_key_key` ON `locations`(`kind`, `name_key`, `city_key`, `state_key`);
CREATE INDEX `locations_name_key_idx` ON `locations`(`name_key`);
CREATE INDEX `locations_latitude_longitude_idx` ON `locations`(`latitude`, `longitude`);

ALTER TABLE `users`
  ADD COLUMN `area_latitude` DECIMAL(5, 2) NULL,
  ADD COLUMN `area_longitude` DECIMAL(6, 2) NULL,
  ADD COLUMN `area_locality` VARCHAR(120) NULL,
  ADD COLUMN `area_city` VARCHAR(80) NULL,
  ADD COLUMN `area_state` VARCHAR(80) NULL,
  ADD COLUMN `area_pincode` VARCHAR(10) NULL,
  ADD COLUMN `area_role` VARCHAR(20) NULL,
  ADD COLUMN `area_updated_at` DATETIME(3) NULL;
CREATE INDEX `users_area_city_area_locality_idx` ON `users`(`area_city`, `area_locality`);

ALTER TABLE `home_alerts`
  ADD COLUMN `locality` VARCHAR(120) NULL,
  ADD COLUMN `city` VARCHAR(80) NULL,
  ADD COLUMN `locality_key` VARCHAR(120) NULL,
  ADD COLUMN `city_key` VARCHAR(80) NULL;
CREATE INDEX `home_alerts_enabled_locality_key_idx` ON `home_alerts`(`enabled`, `locality_key`);
CREATE INDEX `home_alerts_enabled_city_key_idx` ON `home_alerts`(`enabled`, `city_key`);
