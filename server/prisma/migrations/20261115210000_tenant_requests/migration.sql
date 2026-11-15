-- Tenant requests (maintenance / service / complaint): type, landlord updates with remarks, tenant
-- resolve / reopen, reminders, and photos from the tenant and landlord too.
ALTER TABLE `maintenance_requests`
  MODIFY `status` ENUM('OPEN', 'ASSIGNED', 'ACCEPTED', 'IN_PROGRESS', 'COMPLETED', 'DECLINED', 'CANCELLED', 'CLOSED', 'RESOLVED') NOT NULL DEFAULT 'OPEN',
  ADD COLUMN `type` VARCHAR(20) NOT NULL DEFAULT 'MAINTENANCE',
  ADD COLUMN `unit_id` CHAR(36) NULL,
  ADD COLUMN `bed_id` CHAR(36) NULL,
  ADD COLUMN `last_remark` VARCHAR(1000) NULL,
  ADD COLUMN `landlord_updated_at` DATETIME(3) NULL,
  ADD COLUMN `last_reminder_at` DATETIME(3) NULL,
  ADD COLUMN `reminder_count` INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN `resolved_at` DATETIME(3) NULL,
  ADD COLUMN `resolved_by_id` CHAR(36) NULL;

ALTER TABLE `maintenance_photos` ADD COLUMN `update_id` CHAR(36) NULL;

CREATE TABLE `maintenance_updates` (
    `id` CHAR(36) NOT NULL,
    `request_id` CHAR(36) NOT NULL,
    `by_id` CHAR(36) NOT NULL,
    `by_role` VARCHAR(20) NOT NULL,
    `kind` VARCHAR(20) NOT NULL,
    `from_status` VARCHAR(20) NULL,
    `to_status` VARCHAR(20) NULL,
    `remark` VARCHAR(1000) NULL,
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    INDEX `maintenance_updates_request_id_created_at_idx`(`request_id`, `created_at`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

ALTER TABLE `maintenance_updates` ADD CONSTRAINT `maintenance_updates_request_id_fkey` FOREIGN KEY (`request_id`) REFERENCES `maintenance_requests`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;
