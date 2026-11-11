-- Referral & rewards
ALTER TABLE `subscriptions` ADD COLUMN `source` VARCHAR(30) NOT NULL DEFAULT 'PAID';
ALTER TABLE `landlord_profiles`
    ADD COLUMN `kyc_note` VARCHAR(500) NULL,
    ADD COLUMN `kyc_reviewed_by_id` CHAR(36) NULL,
    ADD COLUMN `kyc_reviewed_at` DATETIME(3) NULL;

CREATE TABLE `referral_codes` (
    `id` CHAR(36) NOT NULL,
    `code` VARCHAR(20) NOT NULL,
    `user_id` CHAR(36) NOT NULL,
    `kind` ENUM('TENANT', 'LANDLORD') NOT NULL,
    `status` ENUM('ACTIVE', 'REVOKED') NOT NULL DEFAULT 'ACTIVE',
    `expires_at` DATETIME(3) NULL,
    `opens` INTEGER NOT NULL DEFAULT 0,
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `revoked_at` DATETIME(3) NULL,
    UNIQUE INDEX `referral_codes_code_key`(`code`),
    INDEX `referral_codes_user_id_kind_status_idx`(`user_id`, `kind`, `status`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

CREATE TABLE `referrals` (
    `id` CHAR(36) NOT NULL,
    `code` VARCHAR(20) NOT NULL,
    `type` ENUM('TENANT_TO_TENANT', 'LANDLORD_TO_TENANT', 'LANDLORD_TO_LANDLORD') NOT NULL,
    `referrer_id` CHAR(36) NOT NULL,
    `referred_user_id` CHAR(36) NOT NULL,
    `referral_code_id` CHAR(36) NULL,
    `invitation_id` CHAR(36) NULL,
    `lease_id` CHAR(36) NULL,
    `status` ENUM('REGISTERED', 'PHONE_VERIFIED', 'ONBOARDING_PENDING', 'VERIFICATION_PENDING', 'ELIGIBLE', 'SUCCESSFUL', 'EXPIRED', 'REJECTED', 'REVERSED') NOT NULL DEFAULT 'REGISTERED',
    `reward_status` ENUM('NOT_DUE', 'REWARD_PENDING', 'REWARD_CREDITED', 'REVERSED') NOT NULL DEFAULT 'NOT_DUE',
    `on_hold` BOOLEAN NOT NULL DEFAULT false,
    `hold_reason` VARCHAR(500) NULL,
    `rejection_reason` VARCHAR(500) NULL,
    `eligible_at` DATETIME(3) NULL,
    `successful_at` DATETIME(3) NULL,
    `rewarded_at` DATETIME(3) NULL,
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updated_at` DATETIME(3) NOT NULL,
    UNIQUE INDEX `referrals_code_key`(`code`),
    UNIQUE INDEX `referrals_invitation_id_key`(`invitation_id`),
    UNIQUE INDEX `referrals_type_referred_user_id_key`(`type`, `referred_user_id`),
    INDEX `referrals_referrer_id_type_status_idx`(`referrer_id`, `type`, `status`),
    INDEX `referrals_status_reward_status_idx`(`status`, `reward_status`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

CREATE TABLE `referral_events` (
    `id` CHAR(36) NOT NULL,
    `referral_id` CHAR(36) NULL,
    `code_id` CHAR(36) NULL,
    `event` VARCHAR(40) NOT NULL,
    `data` JSON NULL,
    `actor_id` CHAR(36) NULL,
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    INDEX `referral_events_referral_id_created_at_idx`(`referral_id`, `created_at`),
    INDEX `referral_events_event_created_at_idx`(`event`, `created_at`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

CREATE TABLE `referral_campaigns` (
    `type` ENUM('TENANT_TO_TENANT', 'LANDLORD_TO_TENANT', 'LANDLORD_TO_LANDLORD') NOT NULL,
    `enabled` BOOLEAN NOT NULL DEFAULT true,
    `reward_amount` DECIMAL(10, 2) NULL,
    `duration_months` INTEGER NULL,
    `max_rewards_per_user` INTEGER NULL,
    `starts_at` DATETIME(3) NULL,
    `ends_at` DATETIME(3) NULL,
    `code_expiry_days` INTEGER NULL,
    `reward_expiry_days` INTEGER NULL,
    `tenant_eligibility` VARCHAR(30) NULL,
    `terms` TEXT NULL,
    `updated_by_id` CHAR(36) NULL,
    `updated_at` DATETIME(3) NOT NULL,
    PRIMARY KEY (`type`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

CREATE TABLE `promo_wallets` (
    `user_id` CHAR(36) NOT NULL,
    `balance` DECIMAL(12, 2) NOT NULL DEFAULT 0,
    `lifetime_earned` DECIMAL(12, 2) NOT NULL DEFAULT 0,
    `updated_at` DATETIME(3) NOT NULL,
    PRIMARY KEY (`user_id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

CREATE TABLE `promo_wallet_transactions` (
    `id` CHAR(36) NOT NULL,
    `user_id` CHAR(36) NOT NULL,
    `type` ENUM('REFERRAL_REWARD', 'REDEMPTION', 'REVERSAL', 'EXPIRY') NOT NULL,
    `amount` DECIMAL(12, 2) NOT NULL,
    `balance_after` DECIMAL(12, 2) NOT NULL,
    `currency` CHAR(3) NOT NULL DEFAULT 'INR',
    `status` VARCHAR(20) NOT NULL DEFAULT 'CREDITED',
    `reward_type` VARCHAR(30) NULL,
    `referral_id` CHAR(36) NULL,
    `remaining` DECIMAL(12, 2) NULL,
    `expires_at` DATETIME(3) NULL,
    `idempotency_key` VARCHAR(80) NOT NULL,
    `note` VARCHAR(255) NULL,
    `created_by_id` CHAR(36) NULL,
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    UNIQUE INDEX `promo_wallet_transactions_idempotency_key_key`(`idempotency_key`),
    INDEX `promo_wallet_transactions_user_id_created_at_idx`(`user_id`, `created_at`),
    INDEX `promo_wallet_transactions_user_id_type_expires_at_idx`(`user_id`, `type`, `expires_at`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

CREATE TABLE `subscription_entitlements` (
    `id` CHAR(36) NOT NULL,
    `user_id` CHAR(36) NOT NULL,
    `plan_id` CHAR(36) NOT NULL,
    `plan_name` VARCHAR(60) NOT NULL,
    `months` INTEGER NOT NULL,
    `referral_id` CHAR(36) NOT NULL,
    `subscription_id` CHAR(36) NULL,
    `status` ENUM('ACTIVE', 'SCHEDULED', 'NEXT_BILLING', 'CANCELLED') NOT NULL,
    `starts_at` DATETIME(3) NULL,
    `ends_at` DATETIME(3) NULL,
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updated_at` DATETIME(3) NOT NULL,
    UNIQUE INDEX `subscription_entitlements_referral_id_key`(`referral_id`),
    UNIQUE INDEX `subscription_entitlements_subscription_id_key`(`subscription_id`),
    INDEX `subscription_entitlements_user_id_status_idx`(`user_id`, `status`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

ALTER TABLE `referrals` ADD CONSTRAINT `referrals_referral_code_id_fkey` FOREIGN KEY (`referral_code_id`) REFERENCES `referral_codes`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE `referral_events` ADD CONSTRAINT `referral_events_referral_id_fkey` FOREIGN KEY (`referral_id`) REFERENCES `referrals`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE `subscription_entitlements` ADD CONSTRAINT `subscription_entitlements_referral_id_fkey` FOREIGN KEY (`referral_id`) REFERENCES `referrals`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;
