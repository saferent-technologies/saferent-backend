-- Account deletion by staff: status DELETED + who / when / why (personal details are cleared by the API).
ALTER TABLE `users`
    MODIFY `account_status` ENUM('ACTIVE', 'SUSPENDED', 'DEACTIVATED', 'DELETED') NOT NULL DEFAULT 'ACTIVE',
    ADD COLUMN `deleted_at` DATETIME(3) NULL,
    ADD COLUMN `deleted_by_id` CHAR(36) NULL,
    ADD COLUMN `deletion_reason` VARCHAR(300) NULL;
