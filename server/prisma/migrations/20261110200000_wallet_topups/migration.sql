-- Wallet top-ups through payment gateways
ALTER TABLE `promo_wallets` ADD COLUMN `cash_balance` DECIMAL(12, 2) NOT NULL DEFAULT 0;
ALTER TABLE `promo_wallet_transactions`
    MODIFY `type` ENUM('REFERRAL_REWARD', 'REDEMPTION', 'REVERSAL', 'EXPIRY', 'ADMIN_CREDIT', 'ADMIN_DEBIT', 'TOPUP') NOT NULL,
    ADD COLUMN `bucket` ENUM('PROMO', 'CASH') NOT NULL DEFAULT 'PROMO';

CREATE TABLE `payment_gateways` (
    `provider` ENUM('RAZORPAY', 'PAYTM', 'INSTAMOJO') NOT NULL,
    `enabled` BOOLEAN NOT NULL DEFAULT false,
    `min_amount` DECIMAL(10, 2) NOT NULL DEFAULT 10,
    `max_amount` DECIMAL(10, 2) NOT NULL DEFAULT 10000,
    `updated_by_id` CHAR(36) NULL,
    `updated_at` DATETIME(3) NOT NULL,
    PRIMARY KEY (`provider`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

CREATE TABLE `wallet_topups` (
    `id` CHAR(36) NOT NULL,
    `code` VARCHAR(20) NOT NULL,
    `user_id` CHAR(36) NOT NULL,
    `provider` ENUM('RAZORPAY', 'PAYTM', 'INSTAMOJO') NOT NULL,
    `amount` DECIMAL(12, 2) NOT NULL,
    `currency` CHAR(3) NOT NULL DEFAULT 'INR',
    `status` ENUM('CREATED', 'PENDING', 'PAID', 'FAILED') NOT NULL DEFAULT 'CREATED',
    `provider_order_id` VARCHAR(64) NULL,
    `provider_payment_id` VARCHAR(64) NULL,
    `method` VARCHAR(30) NULL,
    `failure_reason` VARCHAR(255) NULL,
    `test_mode` BOOLEAN NOT NULL DEFAULT false,
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updated_at` DATETIME(3) NOT NULL,
    `paid_at` DATETIME(3) NULL,
    UNIQUE INDEX `wallet_topups_code_key`(`code`),
    UNIQUE INDEX `wallet_topups_provider_order_id_key`(`provider_order_id`),
    UNIQUE INDEX `wallet_topups_provider_payment_id_key`(`provider_payment_id`),
    INDEX `wallet_topups_user_id_created_at_idx`(`user_id`, `created_at`),
    INDEX `wallet_topups_status_created_at_idx`(`status`, `created_at`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;
