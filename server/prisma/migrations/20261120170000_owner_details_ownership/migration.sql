-- Owner contact details, property ownership (joint owners, representative) and Power of Attorney documents.
ALTER TABLE `landlord_profiles`
  ADD COLUMN `alternate_phone` VARCHAR(20) NULL,
  ADD COLUMN `preferred_language` VARCHAR(5) NULL,
  ADD COLUMN `preferred_contact_method` VARCHAR(15) NULL,
  ADD COLUMN `emergency_contact_name` VARCHAR(120) NULL,
  ADD COLUMN `emergency_contact_phone` VARCHAR(20) NULL,
  ADD COLUMN `emergency_contact_relation` VARCHAR(40) NULL;

ALTER TABLE `property_documents` MODIFY `doc_type` ENUM('OWNERSHIP_PROOF', 'SALE_DEED', 'PROPERTY_TAX_RECEIPT', 'ELECTRICITY_BILL', 'BUILDING_PERMISSION', 'RENTAL_AGREEMENT', 'LANDLORD_IDENTITY', 'POWER_OF_ATTORNEY', 'OTHER') NOT NULL;

CREATE TABLE `property_ownerships` (
  `property_id` CHAR(36) NOT NULL,
  `owner_type` VARCHAR(12) NOT NULL,
  `ownership_type` VARCHAR(8) NOT NULL,
  `company_name` VARCHAR(150) NULL,
  `owner_share_percent` DECIMAL(5, 2) NULL,
  `co_owners` JSON NULL,
  `representative` JSON NULL,
  `updated_by_id` CHAR(36) NULL,
  `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  `updated_at` DATETIME(3) NOT NULL,
  PRIMARY KEY (`property_id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

ALTER TABLE `property_ownerships` ADD CONSTRAINT `property_ownerships_property_id_fkey` FOREIGN KEY (`property_id`) REFERENCES `properties`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;
