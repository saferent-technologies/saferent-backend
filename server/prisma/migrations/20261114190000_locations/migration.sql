-- Places from property addresses (state / city / locality) for search suggestions.
CREATE TABLE `locations` (
    `id` BIGINT NOT NULL AUTO_INCREMENT,
    `kind` ENUM('STATE', 'CITY', 'LOCALITY') NOT NULL,
    `name` VARCHAR(120) NOT NULL,
    `city` VARCHAR(80) NULL,
    `state` VARCHAR(80) NULL,
    `key` VARCHAR(320) NOT NULL,
    `latitude` DECIMAL(9, 6) NULL,
    `longitude` DECIMAL(9, 6) NULL,
    `listing_count` INTEGER NOT NULL DEFAULT 0,
    `property_count` INTEGER NOT NULL DEFAULT 0,
    `updated_at` DATETIME(3) NOT NULL,

    UNIQUE INDEX `locations_key_key`(`key`),
    INDEX `locations_name_idx`(`name`),
    INDEX `locations_kind_listing_count_idx`(`kind`, `listing_count`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;
