-- A rent due = rent + monthly maintenance (snapshotted when the due is created). `amount` stays the total.
ALTER TABLE `rent_payments`
  ADD COLUMN `rent_amount` DECIMAL(12, 2) NULL,
  ADD COLUMN `maintenance_amount` DECIMAL(12, 2) NOT NULL DEFAULT 0;

UPDATE `rent_payments` SET `rent_amount` = `amount` WHERE `rent_amount` IS NULL;
