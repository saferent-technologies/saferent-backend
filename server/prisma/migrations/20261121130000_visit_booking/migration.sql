-- Direct property visit booking: availability settings, tenant bookings, approval, cancellation reason, feedback.
ALTER TABLE `property_visits`
    MODIFY `status` ENUM('REQUESTED', 'SCHEDULED', 'REJECTED', 'COMPLETED', 'CANCELLED', 'NO_SHOW') NOT NULL DEFAULT 'SCHEDULED',
    ADD COLUMN `unit_id` CHAR(36) NULL,
    ADD COLUMN `bed_id` CHAR(36) NULL,
    ADD COLUMN `ends_at` DATETIME(3) NULL,
    ADD COLUMN `source` VARCHAR(10) NOT NULL DEFAULT 'AGENT',
    ADD COLUMN `visitors` INTEGER NOT NULL DEFAULT 1,
    ADD COLUMN `visitor_note` VARCHAR(300) NULL,
    ADD COLUMN `confirmed_at` DATETIME(3) NULL,
    ADD COLUMN `confirmed_by_id` CHAR(36) NULL,
    ADD COLUMN `reject_reason` VARCHAR(300) NULL,
    ADD COLUMN `cancelled_at` DATETIME(3) NULL,
    ADD COLUMN `cancelled_by_id` CHAR(36) NULL,
    ADD COLUMN `cancel_reason` VARCHAR(300) NULL,
    ADD COLUMN `completed_at` DATETIME(3) NULL,
    ADD COLUMN `reminder_sent_at` DATETIME(3) NULL,
    ADD COLUMN `feedback_rating` INTEGER NULL,
    ADD COLUMN `feedback_interested` BOOLEAN NULL,
    ADD COLUMN `feedback_comment` VARCHAR(500) NULL,
    ADD COLUMN `feedback_at` DATETIME(3) NULL;

CREATE INDEX `property_visits_property_id_scheduled_at_idx` ON `property_visits`(`property_id`, `scheduled_at`);
CREATE INDEX `property_visits_tenant_id_scheduled_at_idx` ON `property_visits`(`tenant_id`, `scheduled_at`);

CREATE TABLE `property_visit_settings` (
    `property_id` CHAR(36) NOT NULL,
    `enabled` BOOLEAN NOT NULL DEFAULT false,
    `approval_mode` VARCHAR(10) NOT NULL DEFAULT 'MANUAL',
    `slot_minutes` INTEGER NOT NULL DEFAULT 30,
    `capacity_per_slot` INTEGER NOT NULL DEFAULT 1,
    `min_notice_hours` INTEGER NOT NULL DEFAULT 4,
    `max_days_ahead` INTEGER NOT NULL DEFAULT 14,
    `weekly` JSON NOT NULL,
    `blocked_dates` JSON NOT NULL,
    `host_id` CHAR(36) NULL,
    `instructions` VARCHAR(300) NULL,
    `updated_by_id` CHAR(36) NOT NULL,
    `updated_at` DATETIME(3) NOT NULL,

    PRIMARY KEY (`property_id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;
