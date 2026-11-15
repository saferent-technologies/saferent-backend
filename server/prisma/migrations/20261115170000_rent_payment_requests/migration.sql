-- Part payments: a due can be PARTIAL; paid_amount is what has been received so far.
ALTER TABLE `rent_payments`
  MODIFY `status` ENUM('DUE', 'PAID', 'OVERDUE', 'WAIVED', 'PARTIAL') NOT NULL DEFAULT 'DUE',
  ADD COLUMN `paid_amount` DECIMAL(12, 2) NOT NULL DEFAULT 0;

UPDATE `rent_payments` SET `paid_amount` = `amount` WHERE `status` = 'PAID';

-- Tenant "I paid" with transaction id + proof photo; the landlord approves (full or part) or rejects.
CREATE TABLE `rent_payment_requests` (
    `id` CHAR(36) NOT NULL,
    `rent_payment_id` CHAR(36) NOT NULL,
    `lease_id` CHAR(36) NOT NULL,
    `property_id` CHAR(36) NOT NULL,
    `tenant_id` CHAR(36) NOT NULL,
    `landlord_id` CHAR(36) NOT NULL,
    `amount` DECIMAL(12, 2) NOT NULL,
    `transaction_id` VARCHAR(60) NOT NULL,
    `mode` VARCHAR(30) NOT NULL DEFAULT 'UPI',
    `proof_key` VARCHAR(255) NOT NULL,
    `proof_mime` VARCHAR(50) NOT NULL,
    `status` ENUM('PENDING', 'APPROVED', 'REJECTED', 'CANCELLED') NOT NULL DEFAULT 'PENDING',
    `pending_key` CHAR(36) NULL,
    `approved_amount` DECIMAL(12, 2) NULL,
    `reject_reason` VARCHAR(500) NULL,
    `decided_by_id` CHAR(36) NULL,
    `decided_at` DATETIME(3) NULL,
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    UNIQUE INDEX `rent_payment_requests_pending_key_key`(`pending_key`),
    INDEX `rent_payment_requests_landlord_id_status_created_at_idx`(`landlord_id`, `status`, `created_at`),
    INDEX `rent_payment_requests_rent_payment_id_created_at_idx`(`rent_payment_id`, `created_at`),
    INDEX `rent_payment_requests_tenant_id_transaction_id_idx`(`tenant_id`, `transaction_id`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

ALTER TABLE `rent_payment_requests` ADD CONSTRAINT `rent_payment_requests_rent_payment_id_fkey` FOREIGN KEY (`rent_payment_id`) REFERENCES `rent_payments`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;
