-- CreateTable
CREATE TABLE `users` (
    `id` VARCHAR(191) NOT NULL,
    `firebase_uid` VARCHAR(191) NOT NULL,
    `phone_number` VARCHAR(191) NOT NULL,
    `full_name` VARCHAR(191) NULL,
    `email` VARCHAR(191) NULL,
    `profile_image` VARCHAR(191) NULL,
    `role` ENUM('LANDLORD', 'TENANT') NOT NULL,
    `is_profile_completed` BOOLEAN NOT NULL DEFAULT false,
    `is_active` BOOLEAN NOT NULL DEFAULT true,
    `is_verified` BOOLEAN NOT NULL DEFAULT true,
    `device_token` VARCHAR(191) NULL,
    `last_login_at` DATETIME(3) NULL,
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updated_at` DATETIME(3) NOT NULL,

    UNIQUE INDEX `users_firebase_uid_key`(`firebase_uid`),
    UNIQUE INDEX `users_phone_number_key`(`phone_number`),
    UNIQUE INDEX `users_email_key`(`email`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;
