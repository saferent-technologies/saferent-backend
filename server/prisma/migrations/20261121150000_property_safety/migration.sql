-- Safety & emergency information + safety certificates as document types.
ALTER TABLE `property_documents` MODIFY `doc_type` ENUM('OWNERSHIP_PROOF', 'SALE_DEED', 'PROPERTY_TAX_RECEIPT', 'ELECTRICITY_BILL', 'BUILDING_PERMISSION', 'RENTAL_AGREEMENT', 'LANDLORD_IDENTITY', 'POWER_OF_ATTORNEY', 'STRUCTURAL_SAFETY_CERTIFICATE', 'FIRE_NOC', 'OCCUPANCY_CERTIFICATE', 'OTHER') NOT NULL;

CREATE TABLE `property_safety` (
    `property_id` CHAR(36) NOT NULL,
    `fire_extinguisher` BOOLEAN NULL,
    `fire_extinguisher_count` INTEGER NULL,
    `fire_extinguisher_expiry` DATE NULL,
    `expiry_notice_stage` INTEGER NOT NULL DEFAULT 0,
    `smoke_detectors` BOOLEAN NULL,
    `smoke_detector_locations` VARCHAR(200) NULL,
    `emergency_exits` INTEGER NULL,
    `emergency_staircase` BOOLEAN NULL,
    `first_aid_kit` BOOLEAN NULL,
    `first_aid_location` VARCHAR(120) NULL,
    `security_name` VARCHAR(120) NULL,
    `security_phone` VARCHAR(20) NULL,
    `security_24x7` BOOLEAN NULL,
    `emergency_contacts` JSON NULL,
    `nearest_hospital` JSON NULL,
    `nearest_police_station` JSON NULL,
    `instructions` TEXT NULL,
    `updated_by_id` CHAR(36) NOT NULL,
    `updated_at` DATETIME(3) NOT NULL,

    PRIMARY KEY (`property_id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;
