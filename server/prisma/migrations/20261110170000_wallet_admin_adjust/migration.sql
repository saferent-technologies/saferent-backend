-- Admin wallet adjustments
ALTER TABLE `promo_wallet_transactions` MODIFY `type` ENUM('REFERRAL_REWARD', 'REDEMPTION', 'REVERSAL', 'EXPIRY', 'ADMIN_CREDIT', 'ADMIN_DEBIT') NOT NULL;
