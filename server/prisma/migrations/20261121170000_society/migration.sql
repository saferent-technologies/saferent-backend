-- Society / association management: details, parking slots, society approval per lease, society rules document.
ALTER TABLE `property_documents` MODIFY `doc_type` ENUM('OWNERSHIP_PROOF', 'SALE_DEED', 'PROPERTY_TAX_RECEIPT', 'ELECTRICITY_BILL', 'BUILDING_PERMISSION', 'RENTAL_AGREEMENT', 'LANDLORD_IDENTITY', 'POWER_OF_ATTORNEY', 'STRUCTURAL_SAFETY_CERTIFICATE', 'FIRE_NOC', 'OCCUPANCY_CERTIFICATE', 'TRADE_LICENSE', 'SOCIETY_NOC', 'POLICE_VERIFICATION', 'SOCIETY_RULES', 'OTHER') NOT NULL;

CREATE TABLE `property_society` (
    `property_id` CHAR(36) NOT NULL,
    `is_society` BOOLEAN NOT NULL DEFAULT true,
    `association_name` VARCHAR(150) NULL,
    `registration_number` VARCHAR(60) NULL,
    `contact_name` VARCHAR(120) NULL,
    `contact_role` VARCHAR(20) NULL,
    `contact_phone` VARCHAR(20) NULL,
    `contact_email` VARCHAR(254) NULL,
    `office_hours` VARCHAR(120) NULL,
    `maintenance_amount` DECIMAL(12, 2) NULL,
    `maintenance_frequency` VARCHAR(12) NULL,
    `maintenance_paid_by` VARCHAR(20) NULL,
    `maintenance_pay_to` VARCHAR(10) NULL,
    `rules` JSON NULL,
    `visitor_policy` VARCHAR(1000) NULL,
    `gate_access_methods` JSON NULL,
    `gate_contact_name` VARCHAR(120) NULL,
    `gate_contact_phone` VARCHAR(20) NULL,
    `clubhouse_rules` VARCHAR(1000) NULL,
    `common_areas` JSON NULL,
    `move_requires_permission` BOOLEAN NULL,
    `move_notice_days` INTEGER NULL,
    `move_allowed_timings` VARCHAR(120) NULL,
    `move_charge_amount` DECIMAL(12, 2) NULL,
    `move_deposit_amount` DECIMAL(12, 2) NULL,
    `move_lift_booking` BOOLEAN NULL,
    `move_notes` VARCHAR(500) NULL,
    `updated_by_id` CHAR(36) NOT NULL,
    `updated_at` DATETIME(3) NOT NULL,

    PRIMARY KEY (`property_id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

CREATE TABLE `parking_slots` (
    `id` CHAR(36) NOT NULL,
    `property_id` CHAR(36) NOT NULL,
    `unit_id` CHAR(36) NULL,
    `slot_number` VARCHAR(20) NOT NULL,
    `vehicle_type` VARCHAR(5) NOT NULL DEFAULT 'CAR',
    `covered` BOOLEAN NOT NULL DEFAULT false,
    `notes` VARCHAR(200) NULL,
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updated_at` DATETIME(3) NOT NULL,

    UNIQUE INDEX `parking_slots_property_id_slot_number_key`(`property_id`, `slot_number`),
    INDEX `parking_slots_property_id_unit_id_idx`(`property_id`, `unit_id`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

ALTER TABLE `leases`
    ADD COLUMN `society_approval_status` VARCHAR(15) NULL,
    ADD COLUMN `society_approval_date` DATE NULL,
    ADD COLUMN `society_approval_note` VARCHAR(300) NULL;
