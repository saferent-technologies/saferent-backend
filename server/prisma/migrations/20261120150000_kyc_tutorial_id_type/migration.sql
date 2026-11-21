-- Guides belong to an ID type and carry a description (the earlier "note" becomes the description).
ALTER TABLE `kyc_tutorials`
  ADD COLUMN `id_type` VARCHAR(30) NULL AFTER `id`,
  CHANGE COLUMN `note` `description` VARCHAR(200) NULL;
CREATE INDEX `kyc_tutorials_id_type_idx` ON `kyc_tutorials`(`id_type`);
