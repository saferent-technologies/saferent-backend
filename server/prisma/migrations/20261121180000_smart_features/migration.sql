-- Smart rent reminders: per-landlord schedule + sent log.
CREATE TABLE `rent_reminder_settings` (
    `landlord_id` CHAR(36) NOT NULL,
    `enabled` BOOLEAN NOT NULL DEFAULT true,
    `before_days` JSON NOT NULL,
    `overdue_days` JSON NOT NULL,
    `smart_early` BOOLEAN NOT NULL DEFAULT true,
    `updated_at` DATETIME(3) NOT NULL,

    PRIMARY KEY (`landlord_id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

CREATE TABLE `rent_reminder_logs` (
    `id` CHAR(36) NOT NULL,
    `rent_payment_id` CHAR(36) NOT NULL,
    `kind` VARCHAR(20) NOT NULL,
    `sent` BOOLEAN NOT NULL DEFAULT true,
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    UNIQUE INDEX `rent_reminder_logs_rent_payment_id_kind_key`(`rent_payment_id`, `kind`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;
