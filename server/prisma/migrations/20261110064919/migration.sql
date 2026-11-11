/*
  Warnings:

  - You are about to drop the column `area_sqft` on the `properties` table. All the data in the column will be lost.
  - You are about to drop the column `available_from` on the `properties` table. All the data in the column will be lost.
  - You are about to drop the column `bathrooms` on the `properties` table. All the data in the column will be lost.
  - You are about to drop the column `bedrooms` on the `properties` table. All the data in the column will be lost.
  - You are about to drop the column `furnishing` on the `properties` table. All the data in the column will be lost.
  - You are about to drop the column `is_available` on the `properties` table. All the data in the column will be lost.
  - You are about to drop the column `monthly_rent` on the `properties` table. All the data in the column will be lost.
  - You are about to drop the column `security_deposit` on the `properties` table. All the data in the column will be lost.
  - You are about to drop the column `status` on the `properties` table. All the data in the column will be lost.
  - You are about to drop the column `verified` on the `properties` table. All the data in the column will be lost.
  - You are about to alter the column `property_type` on the `properties` table. The data in that column could be lost. The data in that column will be cast from `Enum(EnumId(11))` to `VarChar(40)`.
  - You are about to drop the column `note` on the `property_documents` table. All the data in the column will be lost.
  - You are about to drop the column `reviewed_by_id` on the `property_documents` table. All the data in the column will be lost.
  - The values [OWNERSHIP_DEED,TAX_RECEIPT,UTILITY_BILL,ID_PROOF] on the enum `property_documents_doc_type` will be removed. If these variants are still used in the database, this will fail.
  - A unique constraint covering the columns `[code]` on the table `leases` will be added. If there are existing duplicate values, this will fail.
  - A unique constraint covering the columns `[code]` on the table `properties` will be added. If there are existing duplicate values, this will fail.
  - A unique constraint covering the columns `[code]` on the table `property_documents` will be added. If there are existing duplicate values, this will fail.
  - A unique constraint covering the columns `[lease_id,type]` on the table `property_inspections` will be added. If there are existing duplicate values, this will fail.
  - Added the required column `category` to the `properties` table without a default value. This is not possible if the table is not empty.
  - Added the required column `code` to the `properties` table without a default value. This is not possible if the table is not empty.
  - Added the required column `code` to the `property_documents` table without a default value. This is not possible if the table is not empty.
  - Added the required column `updated_at` to the `property_inspections` table without a default value. This is not possible if the table is not empty.

*/
-- DropIndex
DROP INDEX `properties_status_city_idx` ON `properties`;

-- DropIndex
DROP INDEX `properties_status_monthly_rent_idx` ON `properties`;

-- AlterTable
ALTER TABLE `leases` ADD COLUMN `bed_id` CHAR(36) NULL,
    ADD COLUMN `code` VARCHAR(20) NULL,
    ADD COLUMN `unit_id` CHAR(36) NULL;

-- AlterTable
ALTER TABLE `properties` DROP COLUMN `area_sqft`,
    DROP COLUMN `available_from`,
    DROP COLUMN `bathrooms`,
    DROP COLUMN `bedrooms`,
    DROP COLUMN `furnishing`,
    DROP COLUMN `is_available`,
    DROP COLUMN `monthly_rent`,
    DROP COLUMN `security_deposit`,
    DROP COLUMN `status`,
    DROP COLUMN `verified`,
    ADD COLUMN `active_status` ENUM('ACTIVE', 'INACTIVE', 'SUSPENDED', 'ARCHIVED') NOT NULL DEFAULT 'ACTIVE',
    ADD COLUMN `archived_at` DATETIME(3) NULL,
    ADD COLUMN `attributes` JSON NULL,
    ADD COLUMN `available_count` INTEGER NOT NULL DEFAULT 0,
    ADD COLUMN `category` ENUM('RESIDENTIAL', 'COMMERCIAL', 'LAND') NOT NULL,
    ADD COLUMN `code` VARCHAR(20) NOT NULL,
    ADD COLUMN `completeness_score` INTEGER NOT NULL DEFAULT 0,
    ADD COLUMN `country` VARCHAR(60) NOT NULL DEFAULT 'India',
    ADD COLUMN `latitude` DECIMAL(9, 6) NULL,
    ADD COLUMN `listing_type` ENUM('RENT', 'LEASE', 'SALE') NOT NULL DEFAULT 'RENT',
    ADD COLUMN `longitude` DECIMAL(9, 6) NULL,
    ADD COLUMN `name` VARCHAR(150) NULL,
    ADD COLUMN `occupied_count` INTEGER NOT NULL DEFAULT 0,
    ADD COLUMN `publication_status` ENUM('DRAFT', 'PENDING_VERIFICATION', 'APPROVED', 'REJECTED', 'PUBLISHED') NOT NULL DEFAULT 'DRAFT',
    ADD COLUMN `published_at` DATETIME(3) NULL,
    ADD COLUMN `rent_from` DECIMAL(12, 2) NULL,
    ADD COLUMN `rent_to` DECIMAL(12, 2) NULL,
    ADD COLUMN `submitted_at` DATETIME(3) NULL,
    ADD COLUMN `total_floors` INTEGER NULL,
    ADD COLUMN `total_units` INTEGER NULL,
    ADD COLUMN `verification_status` ENUM('UNVERIFIED', 'PENDING', 'VERIFIED', 'REJECTED') NOT NULL DEFAULT 'UNVERIFIED',
    ADD COLUMN `version` INTEGER NOT NULL DEFAULT 1,
    ADD COLUMN `wizard_step` INTEGER NOT NULL DEFAULT 1,
    MODIFY `title` VARCHAR(150) NULL,
    MODIFY `description` TEXT NULL,
    MODIFY `property_type` VARCHAR(40) NOT NULL,
    MODIFY `address_line` VARCHAR(255) NULL,
    MODIFY `city` VARCHAR(80) NULL,
    MODIFY `state` VARCHAR(80) NULL,
    MODIFY `pincode` VARCHAR(10) NULL;

-- AlterTable
ALTER TABLE `property_documents` DROP COLUMN `note`,
    DROP COLUMN `reviewed_by_id`,
    ADD COLUMN `code` VARCHAR(20) NOT NULL,
    ADD COLUMN `rejection_reason` VARCHAR(500) NULL,
    ADD COLUMN `unit_id` CHAR(36) NULL,
    ADD COLUMN `verified_at` DATETIME(3) NULL,
    ADD COLUMN `verified_by_id` CHAR(36) NULL,
    MODIFY `doc_type` ENUM('OWNERSHIP_PROOF', 'SALE_DEED', 'PROPERTY_TAX_RECEIPT', 'ELECTRICITY_BILL', 'BUILDING_PERMISSION', 'RENTAL_AGREEMENT', 'LANDLORD_IDENTITY', 'OTHER') NOT NULL;

-- AlterTable
ALTER TABLE `property_images` ADD COLUMN `category` ENUM('FRONT_VIEW', 'ENTRANCE', 'LIVING_ROOM', 'BEDROOM', 'KITCHEN', 'BATHROOM', 'BALCONY', 'PARKING', 'BUILDING_EXTERIOR', 'COMMON_AREA', 'METER_READING', 'INSPECTION', 'OTHER') NOT NULL DEFAULT 'OTHER',
    ADD COLUMN `display_order` INTEGER NOT NULL DEFAULT 0,
    ADD COLUMN `inspection_id` CHAR(36) NULL,
    ADD COLUMN `room_id` CHAR(36) NULL,
    ADD COLUMN `unit_id` CHAR(36) NULL;

-- AlterTable
ALTER TABLE `property_inspections` ADD COLUMN `bed_id` CHAR(36) NULL,
    ADD COLUMN `doors_and_windows` ENUM('GOOD', 'FAIR', 'POOR', 'NOT_APPLICABLE', 'NOT_INSPECTED') NOT NULL DEFAULT 'NOT_INSPECTED',
    ADD COLUMN `electrical_condition` ENUM('GOOD', 'FAIR', 'POOR', 'NOT_APPLICABLE', 'NOT_INSPECTED') NOT NULL DEFAULT 'NOT_INSPECTED',
    ADD COLUMN `existing_damages` TEXT NULL,
    ADD COLUMN `furniture_inventory` JSON NULL,
    ADD COLUMN `handover_meter_reading` DECIMAL(12, 2) NULL,
    ADD COLUMN `inspection_date` DATETIME(3) NULL,
    ADD COLUMN `keys_handed_over` INTEGER NULL,
    ADD COLUMN `landlord_acknowledged_at` DATETIME(3) NULL,
    ADD COLUMN `lease_id` CHAR(36) NULL,
    ADD COLUMN `plumbing_condition` ENUM('GOOD', 'FAIR', 'POOR', 'NOT_APPLICABLE', 'NOT_INSPECTED') NOT NULL DEFAULT 'NOT_INSPECTED',
    ADD COLUMN `property_condition` ENUM('GOOD', 'FAIR', 'POOR', 'NOT_APPLICABLE', 'NOT_INSPECTED') NOT NULL DEFAULT 'NOT_INSPECTED',
    ADD COLUMN `room_id` CHAR(36) NULL,
    ADD COLUMN `tenant_acknowledged_at` DATETIME(3) NULL,
    ADD COLUMN `type` ENUM('MOVE_IN', 'MOVE_OUT', 'ROUTINE', 'VERIFICATION') NOT NULL DEFAULT 'ROUTINE',
    ADD COLUMN `unit_id` CHAR(36) NULL,
    ADD COLUMN `updated_at` DATETIME(3) NOT NULL,
    ADD COLUMN `wall_condition` ENUM('GOOD', 'FAIR', 'POOR', 'NOT_APPLICABLE', 'NOT_INSPECTED') NOT NULL DEFAULT 'NOT_INSPECTED';

-- AlterTable
ALTER TABLE `rental_applications` ADD COLUMN `bed_id` CHAR(36) NULL,
    ADD COLUMN `unit_id` CHAR(36) NULL;

-- CreateTable
CREATE TABLE `user_roles` (
    `user_id` CHAR(36) NOT NULL,
    `role` ENUM('SUPER_ADMIN', 'ADMIN', 'FINANCE_ADMIN', 'PROPERTY_MANAGER', 'SUPPORT', 'MODERATOR', 'VIEWER', 'LANDLORD', 'TENANT', 'PROPERTY_AGENT', 'SERVICE_PROVIDER') NOT NULL,
    `granted_by_id` CHAR(36) NULL,
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    INDEX `user_roles_role_idx`(`role`),
    PRIMARY KEY (`user_id`, `role`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `property_types` (
    `key` VARCHAR(40) NOT NULL,
    `category` ENUM('RESIDENTIAL', 'COMMERCIAL', 'LAND') NOT NULL,
    `label` VARCHAR(80) NOT NULL,
    `structure` VARCHAR(20) NOT NULL,
    `active` BOOLEAN NOT NULL DEFAULT true,
    `sort_order` INTEGER NOT NULL DEFAULT 0,
    `schema` JSON NOT NULL,
    `updated_at` DATETIME(3) NOT NULL,

    PRIMARY KEY (`key`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `amenities` (
    `key` VARCHAR(40) NOT NULL,
    `label` VARCHAR(80) NOT NULL,
    `categories` JSON NOT NULL,
    `active` BOOLEAN NOT NULL DEFAULT true,
    `sort_order` INTEGER NOT NULL DEFAULT 0,

    PRIMARY KEY (`key`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `id_counters` (
    `name` VARCHAR(20) NOT NULL,
    `value` BIGINT NOT NULL,

    PRIMARY KEY (`name`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `property_units` (
    `id` CHAR(36) NOT NULL,
    `code` VARCHAR(20) NOT NULL,
    `property_id` CHAR(36) NOT NULL,
    `kind` ENUM('FLAT', 'VILLA', 'HOUSE', 'DUPLEX', 'FARMHOUSE', 'COMMERCIAL_SPACE', 'PLOT') NOT NULL,
    `name` VARCHAR(120) NULL,
    `unit_number` VARCHAR(30) NULL,
    `floor_number` INTEGER NULL,
    `bhk_type` VARCHAR(20) NULL,
    `bedrooms` INTEGER NULL,
    `bathrooms` INTEGER NULL,
    `balconies` INTEGER NULL,
    `kitchen_count` INTEGER NULL,
    `living_room_count` INTEGER NULL,
    `built_up_area` DECIMAL(12, 2) NULL,
    `carpet_area` DECIMAL(12, 2) NULL,
    `plot_area` DECIMAL(12, 2) NULL,
    `furnishing` ENUM('UNFURNISHED', 'SEMI_FURNISHED', 'FULLY_FURNISHED', 'NOT_DISCLOSED') NOT NULL DEFAULT 'NOT_DISCLOSED',
    `configuration` VARCHAR(20) NULL,
    `total_floors` INTEGER NULL,
    `parking_capacity` INTEGER NULL,
    `parking_details` VARCHAR(255) NULL,
    `attributes` JSON NULL,
    `available_from` DATE NULL,
    `availability_status` ENUM('AVAILABLE', 'OCCUPIED', 'RESERVED', 'UNDER_MAINTENANCE', 'NOT_AVAILABLE') NOT NULL DEFAULT 'NOT_AVAILABLE',
    `active_status` ENUM('ACTIVE', 'INACTIVE', 'SUSPENDED', 'ARCHIVED') NOT NULL DEFAULT 'ACTIVE',
    `version` INTEGER NOT NULL DEFAULT 1,
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updated_at` DATETIME(3) NOT NULL,

    UNIQUE INDEX `property_units_code_key`(`code`),
    INDEX `property_units_property_id_availability_status_idx`(`property_id`, `availability_status`),
    UNIQUE INDEX `property_units_property_id_unit_number_key`(`property_id`, `unit_number`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `duplex_floors` (
    `id` CHAR(36) NOT NULL,
    `unit_id` CHAR(36) NOT NULL,
    `floor_number` INTEGER NOT NULL,
    `label` VARCHAR(40) NULL,
    `bedrooms` INTEGER NOT NULL DEFAULT 0,
    `bathrooms` INTEGER NOT NULL DEFAULT 0,
    `kitchens` INTEGER NOT NULL DEFAULT 0,
    `living_rooms` INTEGER NOT NULL DEFAULT 0,
    `balconies` INTEGER NOT NULL DEFAULT 0,
    `additional_details` VARCHAR(500) NULL,

    UNIQUE INDEX `duplex_floors_unit_id_floor_number_key`(`unit_id`, `floor_number`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `property_rooms` (
    `id` CHAR(36) NOT NULL,
    `code` VARCHAR(20) NOT NULL,
    `property_id` CHAR(36) NOT NULL,
    `room_number` VARCHAR(30) NOT NULL,
    `floor_number` INTEGER NULL,
    `sharing_type` ENUM('SINGLE', 'DOUBLE', 'TRIPLE', 'FOUR_SHARING', 'CUSTOM') NOT NULL,
    `custom_sharing` INTEGER NULL,
    `attached_bathroom` ENUM('YES', 'NO', 'NOT_APPLICABLE', 'NOT_DISCLOSED') NOT NULL DEFAULT 'NOT_DISCLOSED',
    `ac_available` ENUM('YES', 'NO', 'NOT_APPLICABLE', 'NOT_DISCLOSED') NOT NULL DEFAULT 'NOT_DISCLOSED',
    `rent_per_bed` DECIMAL(12, 2) NULL,
    `security_deposit` DECIMAL(12, 2) NULL,
    `availability_status` ENUM('AVAILABLE', 'OCCUPIED', 'RESERVED', 'UNDER_MAINTENANCE', 'NOT_AVAILABLE') NOT NULL DEFAULT 'NOT_AVAILABLE',
    `active_status` ENUM('ACTIVE', 'INACTIVE', 'SUSPENDED', 'ARCHIVED') NOT NULL DEFAULT 'ACTIVE',
    `version` INTEGER NOT NULL DEFAULT 1,
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updated_at` DATETIME(3) NOT NULL,

    UNIQUE INDEX `property_rooms_code_key`(`code`),
    UNIQUE INDEX `property_rooms_property_id_room_number_key`(`property_id`, `room_number`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `property_beds` (
    `id` CHAR(36) NOT NULL,
    `code` VARCHAR(20) NOT NULL,
    `room_id` CHAR(36) NOT NULL,
    `property_id` CHAR(36) NOT NULL,
    `bed_number` VARCHAR(20) NOT NULL,
    `rent` DECIMAL(12, 2) NULL,
    `tenant_id` CHAR(36) NULL,
    `lease_id` CHAR(36) NULL,
    `occupied_since` DATETIME(3) NULL,
    `availability_status` ENUM('AVAILABLE', 'OCCUPIED', 'RESERVED', 'UNDER_MAINTENANCE', 'NOT_AVAILABLE') NOT NULL DEFAULT 'NOT_AVAILABLE',
    `active_status` ENUM('ACTIVE', 'INACTIVE', 'SUSPENDED', 'ARCHIVED') NOT NULL DEFAULT 'ACTIVE',
    `version` INTEGER NOT NULL DEFAULT 1,
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updated_at` DATETIME(3) NOT NULL,

    UNIQUE INDEX `property_beds_code_key`(`code`),
    UNIQUE INDEX `property_beds_lease_id_key`(`lease_id`),
    INDEX `property_beds_property_id_availability_status_idx`(`property_id`, `availability_status`),
    INDEX `property_beds_tenant_id_idx`(`tenant_id`),
    UNIQUE INDEX `property_beds_room_id_bed_number_key`(`room_id`, `bed_number`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `bed_assignments` (
    `id` CHAR(36) NOT NULL,
    `bed_id` CHAR(36) NOT NULL,
    `tenant_id` CHAR(36) NOT NULL,
    `lease_id` CHAR(36) NULL,
    `started_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `ended_at` DATETIME(3) NULL,
    `created_by_id` CHAR(36) NOT NULL,

    INDEX `bed_assignments_bed_id_ended_at_idx`(`bed_id`, `ended_at`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `property_utilities` (
    `id` CHAR(36) NOT NULL,
    `property_id` CHAR(36) NOT NULL,
    `unit_id` CHAR(36) NULL,
    `scope_key` VARCHAR(36) NOT NULL,
    `separate_electricity_meter` ENUM('YES', 'NO', 'NOT_APPLICABLE', 'NOT_DISCLOSED') NOT NULL DEFAULT 'NOT_DISCLOSED',
    `meter_number` VARCHAR(40) NULL,
    `electricity_billing_type` ENUM('ACTUAL_BILL', 'FIXED', 'INCLUDED_IN_RENT', 'NOT_APPLICABLE', 'NOT_DISCLOSED') NOT NULL DEFAULT 'NOT_DISCLOSED',
    `electricity_rate_per_unit` DECIMAL(8, 2) NULL,
    `meter_payment_type` ENUM('PREPAID', 'POSTPAID', 'NOT_APPLICABLE', 'NOT_DISCLOSED') NOT NULL DEFAULT 'NOT_DISCLOSED',
    `electricity_included_in_rent` ENUM('YES', 'NO', 'NOT_APPLICABLE', 'NOT_DISCLOSED') NOT NULL DEFAULT 'NOT_DISCLOSED',
    `meter_reading_at_handover` DECIMAL(12, 2) NULL,
    `meter_reading_image_id` CHAR(36) NULL,
    `separate_water_meter` ENUM('YES', 'NO', 'NOT_APPLICABLE', 'NOT_DISCLOSED') NOT NULL DEFAULT 'NOT_DISCLOSED',
    `water_supply_type` ENUM('MUNICIPAL', 'BOREWELL', 'TANKER', 'MIXED', 'NOT_APPLICABLE', 'NOT_DISCLOSED') NOT NULL DEFAULT 'NOT_DISCLOSED',
    `water_charges_type` ENUM('INCLUDED_IN_RENT', 'FIXED_MONTHLY', 'USAGE_BASED', 'ONE_TIME', 'NOT_APPLICABLE', 'NOT_DISCLOSED') NOT NULL DEFAULT 'NOT_DISCLOSED',
    `water_charges_amount` DECIMAL(12, 2) NULL,
    `water_included_in_rent` ENUM('YES', 'NO', 'NOT_APPLICABLE', 'NOT_DISCLOSED') NOT NULL DEFAULT 'NOT_DISCLOSED',
    `water_availability` VARCHAR(120) NULL,
    `gas_connection_type` ENUM('PIPED', 'CYLINDER', 'NONE', 'NOT_DISCLOSED') NOT NULL DEFAULT 'NOT_DISCLOSED',
    `internet_available` ENUM('YES', 'NO', 'NOT_APPLICABLE', 'NOT_DISCLOSED') NOT NULL DEFAULT 'NOT_DISCLOSED',
    `internet_charges` DECIMAL(12, 2) NULL,
    `power_backup` ENUM('YES', 'NO', 'NOT_APPLICABLE', 'NOT_DISCLOSED') NOT NULL DEFAULT 'NOT_DISCLOSED',
    `generator_available` ENUM('YES', 'NO', 'NOT_APPLICABLE', 'NOT_DISCLOSED') NOT NULL DEFAULT 'NOT_DISCLOSED',
    `sewage_facilities` ENUM('YES', 'NO', 'NOT_APPLICABLE', 'NOT_DISCLOSED') NOT NULL DEFAULT 'NOT_DISCLOSED',
    `waste_collection` ENUM('YES', 'NO', 'NOT_APPLICABLE', 'NOT_DISCLOSED') NOT NULL DEFAULT 'NOT_DISCLOSED',
    `notes` VARCHAR(1000) NULL,
    `updated_at` DATETIME(3) NOT NULL,

    UNIQUE INDEX `property_utilities_property_id_scope_key_key`(`property_id`, `scope_key`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `property_policies` (
    `property_id` CHAR(36) NOT NULL,
    `guests_allowed` ENUM('YES', 'NO', 'NOT_APPLICABLE', 'NOT_DISCLOSED') NOT NULL DEFAULT 'NOT_DISCLOSED',
    `overnight_guests_allowed` ENUM('YES', 'NO', 'NOT_APPLICABLE', 'NOT_DISCLOSED') NOT NULL DEFAULT 'NOT_DISCLOSED',
    `maximum_guest_stay_days` INTEGER NULL,
    `guest_registration_required` ENUM('YES', 'NO', 'NOT_APPLICABLE', 'NOT_DISCLOSED') NOT NULL DEFAULT 'NOT_DISCLOSED',
    `visitor_timing_restrictions` VARCHAR(255) NULL,
    `landlord_approval_required` ENUM('YES', 'NO', 'NOT_APPLICABLE', 'NOT_DISCLOSED') NOT NULL DEFAULT 'NOT_DISCLOSED',
    `guest_parking_available` ENUM('YES', 'NO', 'NOT_APPLICABLE', 'NOT_DISCLOSED') NOT NULL DEFAULT 'NOT_DISCLOSED',
    `guest_charges_applicable` ENUM('YES', 'NO', 'NOT_APPLICABLE', 'NOT_DISCLOSED') NOT NULL DEFAULT 'NOT_DISCLOSED',
    `guest_charge_amount` DECIMAL(12, 2) NULL,
    `pets_allowed` ENUM('YES', 'NO', 'NOT_APPLICABLE', 'NOT_DISCLOSED') NOT NULL DEFAULT 'NOT_DISCLOSED',
    `smoking_allowed` ENUM('YES', 'NO', 'NOT_APPLICABLE', 'NOT_DISCLOSED') NOT NULL DEFAULT 'NOT_DISCLOSED',
    `parties_allowed` ENUM('YES', 'NO', 'NOT_APPLICABLE', 'NOT_DISCLOSED') NOT NULL DEFAULT 'NOT_DISCLOSED',
    `loud_music_policy` VARCHAR(255) NULL,
    `cooking_allowed` ENUM('YES', 'NO', 'NOT_APPLICABLE', 'NOT_DISCLOSED') NOT NULL DEFAULT 'NOT_DISCLOSED',
    `subletting_allowed` ENUM('YES', 'NO', 'NOT_APPLICABLE', 'NOT_DISCLOSED') NOT NULL DEFAULT 'NOT_DISCLOSED',
    `work_from_home_allowed` ENUM('YES', 'NO', 'NOT_APPLICABLE', 'NOT_DISCLOSED') NOT NULL DEFAULT 'NOT_DISCLOSED',
    `additional_rules` JSON NULL,
    `updated_at` DATETIME(3) NOT NULL,

    PRIMARY KEY (`property_id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `property_amenities` (
    `id` CHAR(36) NOT NULL,
    `property_id` CHAR(36) NOT NULL,
    `scope_key` VARCHAR(36) NOT NULL,
    `unit_id` CHAR(36) NULL,
    `key` VARCHAR(80) NOT NULL,
    `label` VARCHAR(80) NOT NULL,
    `status` ENUM('YES', 'NO', 'NOT_APPLICABLE', 'NOT_DISCLOSED') NOT NULL DEFAULT 'YES',
    `notes` VARCHAR(255) NULL,

    UNIQUE INDEX `property_amenities_property_id_scope_key_key_key`(`property_id`, `scope_key`, `key`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `property_pricing` (
    `id` CHAR(36) NOT NULL,
    `property_id` CHAR(36) NOT NULL,
    `unit_id` CHAR(36) NULL,
    `scope_key` VARCHAR(36) NOT NULL,
    `currency` CHAR(3) NOT NULL DEFAULT 'INR',
    `monthly_rent` DECIMAL(12, 2) NULL,
    `sale_price` DECIMAL(14, 2) NULL,
    `security_deposit` DECIMAL(12, 2) NULL,
    `advance_rent_months` INTEGER NULL,
    `rent_due_day` INTEGER NULL,
    `late_fee_policy` VARCHAR(500) NULL,
    `lock_in_period_months` INTEGER NULL,
    `notice_period_days` INTEGER NULL,
    `rent_increase_policy` VARCHAR(500) NULL,
    `agreement_charges` DECIMAL(12, 2) NULL,
    `agreement_charges_paid_by` ENUM('LANDLORD', 'TENANT', 'SHARED', 'NOT_APPLICABLE', 'NOT_DISCLOSED') NOT NULL DEFAULT 'NOT_DISCLOSED',
    `refund_policy` TEXT NULL,
    `other_terms` TEXT NULL,
    `rent_negotiable` ENUM('YES', 'NO', 'NOT_APPLICABLE', 'NOT_DISCLOSED') NOT NULL DEFAULT 'NOT_DISCLOSED',
    `updated_at` DATETIME(3) NOT NULL,

    UNIQUE INDEX `property_pricing_property_id_scope_key_key`(`property_id`, `scope_key`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `pricing_charges` (
    `id` CHAR(36) NOT NULL,
    `pricing_id` CHAR(36) NOT NULL,
    `kind` ENUM('MAINTENANCE', 'ELECTRICITY', 'WATER', 'GAS', 'PARKING', 'INTERNET', 'OTHER') NOT NULL,
    `label` VARCHAR(80) NOT NULL,
    `billing` ENUM('INCLUDED_IN_RENT', 'FIXED_MONTHLY', 'USAGE_BASED', 'ONE_TIME', 'NOT_APPLICABLE', 'NOT_DISCLOSED') NOT NULL,
    `amount` DECIMAL(12, 2) NULL,
    `frequency` ENUM('MONTHLY', 'QUARTERLY', 'HALF_YEARLY', 'YEARLY', 'ONE_TIME') NULL,
    `notes` VARCHAR(255) NULL,

    UNIQUE INDEX `pricing_charges_pricing_id_kind_label_key`(`pricing_id`, `kind`, `label`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `property_status_history` (
    `id` BIGINT NOT NULL AUTO_INCREMENT,
    `property_id` CHAR(36) NOT NULL,
    `entity_type` VARCHAR(20) NOT NULL,
    `entity_id` CHAR(36) NOT NULL,
    `field` VARCHAR(30) NOT NULL,
    `from_value` VARCHAR(30) NULL,
    `to_value` VARCHAR(30) NOT NULL,
    `reason` VARCHAR(500) NULL,
    `actor_id` CHAR(36) NULL,
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    INDEX `property_status_history_property_id_created_at_idx`(`property_id`, `created_at`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `property_audit_logs` (
    `id` BIGINT NOT NULL AUTO_INCREMENT,
    `event_id` CHAR(36) NOT NULL,
    `property_id` CHAR(36) NULL,
    `entity_type` VARCHAR(20) NOT NULL,
    `entity_id` VARCHAR(36) NOT NULL,
    `action` VARCHAR(60) NOT NULL,
    `old_value` JSON NULL,
    `new_value` JSON NULL,
    `performed_by_id` CHAR(36) NULL,
    `actor_role` VARCHAR(32) NULL,
    `source_platform` ENUM('ANDROID', 'IOS', 'ADMIN_PANEL', 'BACKEND') NOT NULL,
    `request_id` VARCHAR(64) NULL,
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    UNIQUE INDEX `property_audit_logs_event_id_key`(`event_id`),
    INDEX `property_audit_logs_property_id_created_at_idx`(`property_id`, `created_at`),
    INDEX `property_audit_logs_entity_type_entity_id_idx`(`entity_type`, `entity_id`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateIndex
CREATE UNIQUE INDEX `leases_code_key` ON `leases`(`code`);

-- CreateIndex
CREATE UNIQUE INDEX `properties_code_key` ON `properties`(`code`);

-- CreateIndex
CREATE INDEX `properties_owner_id_publication_status_idx` ON `properties`(`owner_id`, `publication_status`);

-- CreateIndex
CREATE INDEX `properties_publication_status_active_status_city_idx` ON `properties`(`publication_status`, `active_status`, `city`);

-- CreateIndex
CREATE INDEX `properties_property_type_idx` ON `properties`(`property_type`);

-- CreateIndex
CREATE INDEX `properties_rent_from_idx` ON `properties`(`rent_from`);

-- CreateIndex
CREATE UNIQUE INDEX `property_documents_code_key` ON `property_documents`(`code`);

-- CreateIndex
CREATE INDEX `property_images_property_id_display_order_idx` ON `property_images`(`property_id`, `display_order`);

-- CreateIndex
CREATE INDEX `property_inspections_property_id_type_idx` ON `property_inspections`(`property_id`, `type`);

-- CreateIndex
CREATE UNIQUE INDEX `property_inspections_lease_id_type_key` ON `property_inspections`(`lease_id`, `type`);

-- AddForeignKey
ALTER TABLE `user_roles` ADD CONSTRAINT `user_roles_user_id_fkey` FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `properties` ADD CONSTRAINT `properties_property_type_fkey` FOREIGN KEY (`property_type`) REFERENCES `property_types`(`key`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `property_units` ADD CONSTRAINT `property_units_property_id_fkey` FOREIGN KEY (`property_id`) REFERENCES `properties`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `duplex_floors` ADD CONSTRAINT `duplex_floors_unit_id_fkey` FOREIGN KEY (`unit_id`) REFERENCES `property_units`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `property_rooms` ADD CONSTRAINT `property_rooms_property_id_fkey` FOREIGN KEY (`property_id`) REFERENCES `properties`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `property_beds` ADD CONSTRAINT `property_beds_room_id_fkey` FOREIGN KEY (`room_id`) REFERENCES `property_rooms`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `bed_assignments` ADD CONSTRAINT `bed_assignments_bed_id_fkey` FOREIGN KEY (`bed_id`) REFERENCES `property_beds`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `property_utilities` ADD CONSTRAINT `property_utilities_property_id_fkey` FOREIGN KEY (`property_id`) REFERENCES `properties`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `property_policies` ADD CONSTRAINT `property_policies_property_id_fkey` FOREIGN KEY (`property_id`) REFERENCES `properties`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `property_amenities` ADD CONSTRAINT `property_amenities_property_id_fkey` FOREIGN KEY (`property_id`) REFERENCES `properties`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `property_pricing` ADD CONSTRAINT `property_pricing_property_id_fkey` FOREIGN KEY (`property_id`) REFERENCES `properties`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `pricing_charges` ADD CONSTRAINT `pricing_charges_pricing_id_fkey` FOREIGN KEY (`pricing_id`) REFERENCES `property_pricing`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `property_images` ADD CONSTRAINT `property_images_unit_id_fkey` FOREIGN KEY (`unit_id`) REFERENCES `property_units`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `property_images` ADD CONSTRAINT `property_images_room_id_fkey` FOREIGN KEY (`room_id`) REFERENCES `property_rooms`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `property_images` ADD CONSTRAINT `property_images_inspection_id_fkey` FOREIGN KEY (`inspection_id`) REFERENCES `property_inspections`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `property_status_history` ADD CONSTRAINT `property_status_history_property_id_fkey` FOREIGN KEY (`property_id`) REFERENCES `properties`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `rental_applications` ADD CONSTRAINT `rental_applications_unit_id_fkey` FOREIGN KEY (`unit_id`) REFERENCES `property_units`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `rental_applications` ADD CONSTRAINT `rental_applications_bed_id_fkey` FOREIGN KEY (`bed_id`) REFERENCES `property_beds`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `leases` ADD CONSTRAINT `leases_unit_id_fkey` FOREIGN KEY (`unit_id`) REFERENCES `property_units`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;
