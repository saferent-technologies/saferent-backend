-- India compliance: ownership declaration, property tax, assessment number, building approval, more document
-- types, document expiry reminders, rental agreement registration and police verification on leases.
ALTER TABLE `property_documents`
    MODIFY `doc_type` ENUM('OWNERSHIP_PROOF', 'SALE_DEED', 'PROPERTY_TAX_RECEIPT', 'ELECTRICITY_BILL', 'BUILDING_PERMISSION', 'RENTAL_AGREEMENT', 'LANDLORD_IDENTITY', 'POWER_OF_ATTORNEY', 'STRUCTURAL_SAFETY_CERTIFICATE', 'FIRE_NOC', 'OCCUPANCY_CERTIFICATE', 'TRADE_LICENSE', 'SOCIETY_NOC', 'POLICE_VERIFICATION', 'OTHER') NOT NULL,
    ADD COLUMN `expiry_notice_stage` INTEGER NOT NULL DEFAULT 0;

CREATE TABLE `property_compliance` (
    `property_id` CHAR(36) NOT NULL,
    `ownership_declared_at` DATETIME(3) NULL,
    `ownership_declared_by_id` CHAR(36) NULL,
    `ownership_declaration_version` VARCHAR(10) NULL,
    `assessment_number` VARCHAR(60) NULL,
    `property_tax_status` VARCHAR(15) NULL,
    `property_tax_paid_year` VARCHAR(9) NULL,
    `property_tax_amount` DECIMAL(12, 2) NULL,
    `building_approval_number` VARCHAR(80) NULL,
    `building_approval_authority` VARCHAR(120) NULL,
    `building_approval_date` DATE NULL,
    `updated_by_id` CHAR(36) NOT NULL,
    `updated_at` DATETIME(3) NOT NULL,

    PRIMARY KEY (`property_id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

ALTER TABLE `leases`
    ADD COLUMN `agreement_type` VARCHAR(15) NULL,
    ADD COLUMN `agreement_registration_number` VARCHAR(80) NULL,
    ADD COLUMN `agreement_office` VARCHAR(120) NULL,
    ADD COLUMN `agreement_date` DATE NULL,
    ADD COLUMN `stamp_duty_amount` DECIMAL(12, 2) NULL,
    ADD COLUMN `police_verification_status` VARCHAR(15) NULL,
    ADD COLUMN `police_verification_ref` VARCHAR(80) NULL,
    ADD COLUMN `police_verification_submitted_on` DATE NULL,
    ADD COLUMN `police_verification_verified_on` DATE NULL,
    ADD COLUMN `compliance_updated_by_id` CHAR(36) NULL;
