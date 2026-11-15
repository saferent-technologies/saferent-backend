-- Security deposit received by the landlord (recorded once per lease), with its own receipt.
ALTER TABLE `leases`
  ADD COLUMN `deposit_paid_at` DATETIME(3) NULL,
  ADD COLUMN `deposit_paid_amount` DECIMAL(12, 2) NULL,
  ADD COLUMN `deposit_method` VARCHAR(30) NULL,
  ADD COLUMN `deposit_receipt_number` VARCHAR(40) NULL,
  ADD COLUMN `deposit_recorded_by_id` CHAR(36) NULL;

CREATE UNIQUE INDEX `leases_deposit_receipt_number_key` ON `leases`(`deposit_receipt_number`);

ALTER TABLE `transactions`
  MODIFY `type` ENUM('RENT_PAYMENT', 'REFUND', 'COMMISSION', 'SERVICE_CHARGE', 'SUBSCRIPTION', 'ADJUSTMENT', 'DEPOSIT') NOT NULL;
