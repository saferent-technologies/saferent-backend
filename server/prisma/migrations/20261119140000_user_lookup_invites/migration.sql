-- Public SafeRent IDs for users (backfilled in sign-up order) + direct invitations to an account.
ALTER TABLE `users` ADD COLUMN `safe_rent_id` VARCHAR(20) NULL;
CREATE UNIQUE INDEX `users_safe_rent_id_key` ON `users`(`safe_rent_id`);

SET @n := 0;
UPDATE `users` SET `safe_rent_id` = CONCAT('SR-USER-', LPAD(@n := @n + 1, 6, '0')) ORDER BY `created_at`, `id`;
INSERT INTO `id_counters` (`name`, `value`) SELECT 'SR-USER', COUNT(*) FROM `users`
  ON DUPLICATE KEY UPDATE `value` = GREATEST(`value`, VALUES(`value`));

ALTER TABLE `tenant_invitations`
  ADD COLUMN `recipient_user_id` CHAR(36) NULL,
  ADD COLUMN `token_enc` VARCHAR(255) NULL;
CREATE INDEX `tenant_invitations_recipient_user_id_status_idx` ON `tenant_invitations`(`recipient_user_id`, `status`);
