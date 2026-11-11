-- Two-way rental reviews
CREATE TABLE `rental_reviews` (
    `id` CHAR(36) NOT NULL,
    `code` VARCHAR(20) NOT NULL,
    `lease_id` CHAR(36) NOT NULL,
    `property_id` CHAR(36) NOT NULL,
    `unit_id` CHAR(36) NULL,
    `bed_id` CHAR(36) NULL,
    `landlord_id` CHAR(36) NOT NULL,
    `tenant_id` CHAR(36) NOT NULL,
    `reviewer_id` CHAR(36) NOT NULL,
    `reviewer_role` ENUM('TENANT', 'LANDLORD') NOT NULL,
    `reviewee_id` CHAR(36) NOT NULL,
    `reviewee_role` ENUM('TENANT', 'LANDLORD') NOT NULL,
    `overall_rating` INTEGER NOT NULL,
    `category_ratings` JSON NOT NULL,
    `review_text` TEXT NULL,
    `tags` JSON NULL,
    `evidence` JSON NULL,
    `status` ENUM('SUBMITTED', 'PUBLISHED', 'FLAGGED', 'UNDER_REVIEW', 'REMOVED', 'REJECTED') NOT NULL DEFAULT 'SUBMITTED',
    `submitted_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `published_at` DATETIME(3) NULL,
    `response_text` TEXT NULL,
    `responded_at` DATETIME(3) NULL,
    `response_edited_at` DATETIME(3) NULL,
    `response_hidden` BOOLEAN NOT NULL DEFAULT false,
    `moderation_note` VARCHAR(500) NULL,
    `updated_at` DATETIME(3) NOT NULL,

    UNIQUE INDEX `rental_reviews_code_key`(`code`),
    UNIQUE INDEX `rental_reviews_lease_id_reviewer_id_key`(`lease_id`, `reviewer_id`),
    INDEX `rental_reviews_reviewee_id_status_idx`(`reviewee_id`, `status`),
    INDEX `rental_reviews_property_id_status_idx`(`property_id`, `status`),
    INDEX `rental_reviews_unit_id_status_idx`(`unit_id`, `status`),
    INDEX `rental_reviews_status_submitted_at_idx`(`status`, `submitted_at`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

CREATE TABLE `review_reports` (
    `id` CHAR(36) NOT NULL,
    `review_id` CHAR(36) NOT NULL,
    `reported_by_id` CHAR(36) NOT NULL,
    `reason` ENUM('FALSE_INFORMATION', 'HARASSMENT', 'PERSONAL_INFORMATION', 'DISCRIMINATORY', 'SPAM', 'IRRELEVANT', 'OTHER') NOT NULL,
    `description` VARCHAR(1000) NULL,
    `status` ENUM('OPEN', 'UPHELD', 'DISMISSED') NOT NULL DEFAULT 'OPEN',
    `reviewed_by_id` CHAR(36) NULL,
    `resolution` VARCHAR(500) NULL,
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `resolved_at` DATETIME(3) NULL,

    UNIQUE INDEX `review_reports_review_id_reported_by_id_key`(`review_id`, `reported_by_id`),
    INDEX `review_reports_status_created_at_idx`(`status`, `created_at`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

CREATE TABLE `review_moderation_logs` (
    `id` CHAR(36) NOT NULL,
    `review_id` CHAR(36) NOT NULL,
    `action` VARCHAR(40) NOT NULL,
    `from_status` VARCHAR(20) NULL,
    `to_status` VARCHAR(20) NULL,
    `reason` VARCHAR(500) NOT NULL,
    `moderator_id` CHAR(36) NOT NULL,
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    INDEX `review_moderation_logs_review_id_created_at_idx`(`review_id`, `created_at`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

ALTER TABLE `rental_reviews` ADD CONSTRAINT `rental_reviews_lease_id_fkey` FOREIGN KEY (`lease_id`) REFERENCES `leases`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE `rental_reviews` ADD CONSTRAINT `rental_reviews_property_id_fkey` FOREIGN KEY (`property_id`) REFERENCES `properties`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE `review_reports` ADD CONSTRAINT `review_reports_review_id_fkey` FOREIGN KEY (`review_id`) REFERENCES `rental_reviews`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE `review_moderation_logs` ADD CONSTRAINT `review_moderation_logs_review_id_fkey` FOREIGN KEY (`review_id`) REFERENCES `rental_reviews`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;
