-- Pay a month's rent from the security deposit (tenant asks, landlord approves).
ALTER TABLE `rent_payment_requests`
  ADD COLUMN `type` ENUM('PROOF', 'DEPOSIT') NOT NULL DEFAULT 'PROOF',
  MODIFY `transaction_id` VARCHAR(60) NULL,
  MODIFY `proof_key` VARCHAR(255) NULL,
  MODIFY `proof_mime` VARCHAR(50) NULL;

-- Deposit used for rent so far, and the tenant's word on the refund after move-out.
ALTER TABLE `leases`
  ADD COLUMN `deposit_used_amount` DECIMAL(12, 2) NOT NULL DEFAULT 0,
  ADD COLUMN `deposit_refund_status` ENUM('YES', 'PARTIAL', 'NO') NULL,
  ADD COLUMN `deposit_refund_amount` DECIMAL(12, 2) NULL,
  ADD COLUMN `deposit_refund_reported_at` DATETIME(3) NULL;
