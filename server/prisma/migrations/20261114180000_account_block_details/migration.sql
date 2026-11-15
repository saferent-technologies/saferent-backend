-- Sign-in for blocked accounts: recognise a deleted account's phone number, and keep why / when an account
-- was suspended or deactivated (both are shown to the user by the app).
ALTER TABLE `users`
    ADD COLUMN `deleted_phone_hash` CHAR(64) NULL,
    ADD COLUMN `status_reason` VARCHAR(300) NULL,
    ADD COLUMN `status_changed_at` DATETIME(3) NULL;

CREATE INDEX `users_deleted_phone_hash_idx` ON `users`(`deleted_phone_hash`);
