-- Owner verification with ID documents (Aadhaar Offline eKYC, PAN, passport) instead of DigiLocker.
ALTER TABLE `identity_verifications` MODIFY `provider` ENUM('SETU', 'MOCK', 'DOCUMENT') NOT NULL;
ALTER TABLE `identity_verifications`
  ADD COLUMN `document_type` VARCHAR(20) NULL,
  ADD COLUMN `document_number_enc` TEXT NULL,
  ADD COLUMN `document_last4` VARCHAR(4) NULL,
  ADD COLUMN `front_path` VARCHAR(255) NULL,
  ADD COLUMN `back_path` VARCHAR(255) NULL,
  ADD COLUMN `file_meta` JSON NULL;
