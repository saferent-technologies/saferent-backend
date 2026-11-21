-- Verified legal name can't be changed by the user (owner verification approved).
ALTER TABLE `users`
  ADD COLUMN `name_locked` BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN `name_locked_at` DATETIME(3) NULL;

-- Owners already verified: lock now.
UPDATE `users` u JOIN `landlord_profiles` lp ON lp.`user_id` = u.`id`
SET u.`name_locked` = true, u.`name_locked_at` = COALESCE(lp.`kyc_reviewed_at`, NOW(3))
WHERE lp.`kyc_status` = 'APPROVED';
