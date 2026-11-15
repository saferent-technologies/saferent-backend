-- Landlord "remind tenant" for a rent due (max one per due per day).
ALTER TABLE `rent_payments`
  ADD COLUMN `last_reminder_at` DATETIME(3) NULL,
  ADD COLUMN `reminder_count` INTEGER NOT NULL DEFAULT 0;

CREATE INDEX `rent_payments_landlord_id_period_idx` ON `rent_payments`(`landlord_id`, `period`);
