-- Furniture & appliance register (furnished / semi-furnished properties): items, photos, repair history.
CREATE TABLE `inventory_items` (
    `id` CHAR(36) NOT NULL,
    `property_id` CHAR(36) NOT NULL,
    `unit_id` CHAR(36) NULL,
    `room_id` CHAR(36) NULL,
    `name` VARCHAR(80) NOT NULL,
    `category` ENUM('BEDROOM', 'LIVING_ROOM', 'KITCHEN', 'BATHROOM', 'APPLIANCES', 'OTHER') NOT NULL DEFAULT 'OTHER',
    `quantity` INTEGER NOT NULL DEFAULT 1,
    `brand` VARCHAR(80) NULL,
    `model` VARCHAR(80) NULL,
    `purchase_date` DATE NULL,
    `condition` ENUM('GOOD', 'FAIR', 'POOR', 'NOT_APPLICABLE', 'NOT_INSPECTED') NOT NULL DEFAULT 'GOOD',
    `working_status` ENUM('WORKING', 'NEEDS_REPAIR', 'NOT_WORKING') NOT NULL DEFAULT 'WORKING',
    `serial_number` VARCHAR(80) NULL,
    `notes` VARCHAR(500) NULL,
    `display_order` INTEGER NOT NULL DEFAULT 0,
    `created_by_id` CHAR(36) NOT NULL,
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updated_at` DATETIME(3) NOT NULL,

    INDEX `inventory_items_property_id_unit_id_idx`(`property_id`, `unit_id`),
    INDEX `inventory_items_property_id_room_id_idx`(`property_id`, `room_id`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

CREATE TABLE `inventory_photos` (
    `id` CHAR(36) NOT NULL,
    `item_id` CHAR(36) NOT NULL,
    `file_path` VARCHAR(255) NOT NULL,
    `mime_type` VARCHAR(50) NOT NULL,
    `uploaded_by_id` CHAR(36) NOT NULL,
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    INDEX `inventory_photos_item_id_idx`(`item_id`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

CREATE TABLE `inventory_repairs` (
    `id` CHAR(36) NOT NULL,
    `item_id` CHAR(36) NOT NULL,
    `repair_date` DATE NOT NULL,
    `description` VARCHAR(1000) NOT NULL,
    `cost` DECIMAL(12, 2) NULL,
    `paid_by` ENUM('OWNER', 'TENANT', 'SHARED') NOT NULL DEFAULT 'OWNER',
    `done_by` VARCHAR(120) NULL,
    `status` ENUM('OPEN', 'IN_PROGRESS', 'DONE') NOT NULL DEFAULT 'DONE',
    `created_by_id` CHAR(36) NOT NULL,
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updated_at` DATETIME(3) NOT NULL,

    INDEX `inventory_repairs_item_id_repair_date_idx`(`item_id`, `repair_date`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

ALTER TABLE `inventory_items` ADD CONSTRAINT `inventory_items_property_id_fkey` FOREIGN KEY (`property_id`) REFERENCES `properties`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE `inventory_photos` ADD CONSTRAINT `inventory_photos_item_id_fkey` FOREIGN KEY (`item_id`) REFERENCES `inventory_items`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE `inventory_repairs` ADD CONSTRAINT `inventory_repairs_item_id_fkey` FOREIGN KEY (`item_id`) REFERENCES `inventory_items`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;
