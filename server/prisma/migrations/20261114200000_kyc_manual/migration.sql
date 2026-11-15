-- Owner verification done manually by staff (without DigiLocker + selfie); the reason is in kyc_note.
ALTER TABLE `landlord_profiles` ADD COLUMN `kyc_manual` BOOLEAN NOT NULL DEFAULT false;
