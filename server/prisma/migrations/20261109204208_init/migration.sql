-- CreateTable
CREATE TABLE `users` (
    `id` CHAR(36) NOT NULL,
    `firebase_uid` VARCHAR(128) NOT NULL,
    `full_name` VARCHAR(120) NOT NULL,
    `email` VARCHAR(254) NULL,
    `pending_email` VARCHAR(254) NULL,
    `phone_number` VARCHAR(20) NULL,
    `profile_image` VARCHAR(255) NULL,
    `role` ENUM('SUPER_ADMIN', 'ADMIN', 'FINANCE_ADMIN', 'PROPERTY_MANAGER', 'SUPPORT', 'MODERATOR', 'VIEWER', 'LANDLORD', 'TENANT', 'PROPERTY_AGENT', 'SERVICE_PROVIDER') NOT NULL,
    `account_status` ENUM('ACTIVE', 'SUSPENDED', 'DEACTIVATED') NOT NULL DEFAULT 'ACTIVE',
    `is_founder` BOOLEAN NOT NULL DEFAULT false,
    `email_verified` BOOLEAN NOT NULL DEFAULT false,
    `phone_verified` BOOLEAN NOT NULL DEFAULT false,
    `must_change_password` BOOLEAN NOT NULL DEFAULT false,
    `password_changed_at` DATETIME(3) NULL,
    `last_login_at` DATETIME(3) NULL,
    `created_by_id` CHAR(36) NULL,
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updated_at` DATETIME(3) NOT NULL,

    UNIQUE INDEX `users_firebase_uid_key`(`firebase_uid`),
    UNIQUE INDEX `users_email_key`(`email`),
    UNIQUE INDEX `users_phone_number_key`(`phone_number`),
    INDEX `users_role_account_status_idx`(`role`, `account_status`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `roles` (
    `key` VARCHAR(32) NOT NULL,
    `name` VARCHAR(60) NOT NULL,
    `description` VARCHAR(255) NOT NULL,
    `rank` INTEGER NOT NULL,
    `is_staff` BOOLEAN NOT NULL,

    PRIMARY KEY (`key`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `permissions` (
    `key` VARCHAR(64) NOT NULL,
    `category` VARCHAR(40) NOT NULL,
    `description` VARCHAR(255) NOT NULL,
    `reserved` BOOLEAN NOT NULL DEFAULT false,

    PRIMARY KEY (`key`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `role_permissions` (
    `role` VARCHAR(32) NOT NULL,
    `permission_key` VARCHAR(64) NOT NULL,
    `scope` ENUM('OWN', 'ASSIGNED', 'ALL') NOT NULL,

    PRIMARY KEY (`role`, `permission_key`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `user_permissions` (
    `user_id` CHAR(36) NOT NULL,
    `permission_key` VARCHAR(64) NOT NULL,
    `granted` BOOLEAN NOT NULL,
    `scope` ENUM('OWN', 'ASSIGNED', 'ALL') NOT NULL DEFAULT 'OWN',
    `granted_by_id` CHAR(36) NOT NULL,
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    PRIMARY KEY (`user_id`, `permission_key`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `otp_challenges` (
    `user_id` CHAR(36) NOT NULL,
    `challenge_id` CHAR(36) NOT NULL,
    `otp_hash` CHAR(64) NOT NULL,
    `auth_time` INTEGER NOT NULL,
    `attempts` INTEGER NOT NULL DEFAULT 0,
    `max_attempts` INTEGER NOT NULL,
    `consumed` BOOLEAN NOT NULL DEFAULT false,
    `expires_at` DATETIME(3) NOT NULL,
    `resend_available_at` DATETIME(3) NOT NULL,
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `consumed_at` DATETIME(3) NULL,

    UNIQUE INDEX `otp_challenges_challenge_id_key`(`challenge_id`),
    PRIMARY KEY (`user_id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `auth_sessions` (
    `user_id` CHAR(36) NOT NULL,
    `auth_time` INTEGER NOT NULL,
    `method` ENUM('EMAIL_OTP', 'PHONE_OTP') NOT NULL,
    `verified_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `expires_at` DATETIME(3) NOT NULL,
    `revoked` BOOLEAN NOT NULL DEFAULT false,
    `revoked_at` DATETIME(3) NULL,
    `ip` VARCHAR(64) NULL,
    `user_agent` VARCHAR(300) NULL,

    PRIMARY KEY (`user_id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `rate_limits` (
    `rate_key` CHAR(64) NOT NULL,
    `count` INTEGER NOT NULL,
    `window_start` DATETIME(3) NOT NULL,
    `expires_at` DATETIME(3) NOT NULL,

    INDEX `rate_limits_expires_at_idx`(`expires_at`),
    PRIMARY KEY (`rate_key`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `security_audit_logs` (
    `id` BIGINT NOT NULL AUTO_INCREMENT,
    `user_id` CHAR(36) NULL,
    `firebase_uid` VARCHAR(128) NULL,
    `action` VARCHAR(64) NOT NULL,
    `outcome` ENUM('SUCCESS', 'FAILURE') NOT NULL,
    `reason` VARCHAR(64) NULL,
    `email` VARCHAR(254) NULL,
    `ip` VARCHAR(64) NULL,
    `user_agent` VARCHAR(300) NULL,
    `metadata` JSON NULL,
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    INDEX `security_audit_logs_user_id_created_at_idx`(`user_id`, `created_at`),
    INDEX `security_audit_logs_action_created_at_idx`(`action`, `created_at`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `admin_activity_logs` (
    `id` BIGINT NOT NULL AUTO_INCREMENT,
    `actor_id` CHAR(36) NOT NULL,
    `action` VARCHAR(64) NOT NULL,
    `target_type` VARCHAR(40) NOT NULL,
    `target_id` VARCHAR(64) NULL,
    `changes` JSON NULL,
    `ip` VARCHAR(64) NULL,
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    INDEX `admin_activity_logs_actor_id_created_at_idx`(`actor_id`, `created_at`),
    INDEX `admin_activity_logs_target_type_target_id_idx`(`target_type`, `target_id`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `system_locks` (
    `name` VARCHAR(64) NOT NULL,
    `status` VARCHAR(32) NOT NULL,
    `data` JSON NULL,
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updated_at` DATETIME(3) NOT NULL,

    PRIMARY KEY (`name`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `landlord_profiles` (
    `user_id` CHAR(36) NOT NULL,
    `business_name` VARCHAR(120) NULL,
    `address` VARCHAR(255) NULL,
    `city` VARCHAR(80) NULL,
    `state` VARCHAR(80) NULL,
    `pincode` VARCHAR(10) NULL,
    `kyc_status` ENUM('PENDING', 'APPROVED', 'REJECTED') NOT NULL DEFAULT 'PENDING',
    `updated_at` DATETIME(3) NOT NULL,

    PRIMARY KEY (`user_id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `tenant_profiles` (
    `user_id` CHAR(36) NOT NULL,
    `occupation` VARCHAR(80) NULL,
    `employer` VARCHAR(120) NULL,
    `current_city` VARCHAR(80) NULL,
    `family_size` INTEGER NULL,
    `preferred_move_in` DATE NULL,
    `emergency_contact_name` VARCHAR(120) NULL,
    `emergency_contact_phone` VARCHAR(20) NULL,
    `updated_at` DATETIME(3) NOT NULL,

    PRIMARY KEY (`user_id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `agent_profiles` (
    `user_id` CHAR(36) NOT NULL,
    `agency_name` VARCHAR(120) NULL,
    `license_number` VARCHAR(60) NULL,
    `service_areas` VARCHAR(255) NULL,
    `experience_years` INTEGER NULL,
    `updated_at` DATETIME(3) NOT NULL,

    PRIMARY KEY (`user_id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `service_provider_profiles` (
    `user_id` CHAR(36) NOT NULL,
    `business_name` VARCHAR(120) NULL,
    `categories` VARCHAR(255) NULL,
    `service_areas` VARCHAR(255) NULL,
    `available` BOOLEAN NOT NULL DEFAULT true,
    `updated_at` DATETIME(3) NOT NULL,

    PRIMARY KEY (`user_id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `properties` (
    `id` CHAR(36) NOT NULL,
    `owner_id` CHAR(36) NOT NULL,
    `title` VARCHAR(150) NOT NULL,
    `description` TEXT NOT NULL,
    `property_type` ENUM('APARTMENT', 'INDEPENDENT_HOUSE', 'VILLA', 'PG_HOSTEL', 'COMMERCIAL') NOT NULL,
    `address_line` VARCHAR(255) NOT NULL,
    `locality` VARCHAR(120) NULL,
    `city` VARCHAR(80) NOT NULL,
    `state` VARCHAR(80) NOT NULL,
    `pincode` VARCHAR(10) NOT NULL,
    `bedrooms` INTEGER NOT NULL DEFAULT 0,
    `bathrooms` INTEGER NOT NULL DEFAULT 0,
    `area_sqft` INTEGER NULL,
    `furnishing` ENUM('UNFURNISHED', 'SEMI_FURNISHED', 'FULLY_FURNISHED') NOT NULL DEFAULT 'UNFURNISHED',
    `monthly_rent` DECIMAL(12, 2) NOT NULL,
    `security_deposit` DECIMAL(12, 2) NOT NULL DEFAULT 0,
    `available_from` DATE NULL,
    `is_available` BOOLEAN NOT NULL DEFAULT true,
    `status` ENUM('DRAFT', 'PENDING_REVIEW', 'ACTIVE', 'REJECTED', 'RENTED', 'INACTIVE') NOT NULL DEFAULT 'DRAFT',
    `moderation_note` VARCHAR(500) NULL,
    `reviewed_by_id` CHAR(36) NULL,
    `reviewed_at` DATETIME(3) NULL,
    `verified` BOOLEAN NOT NULL DEFAULT false,
    `created_by_id` CHAR(36) NOT NULL,
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updated_at` DATETIME(3) NOT NULL,

    INDEX `properties_owner_id_idx`(`owner_id`),
    INDEX `properties_status_city_idx`(`status`, `city`),
    INDEX `properties_status_monthly_rent_idx`(`status`, `monthly_rent`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `property_images` (
    `id` CHAR(36) NOT NULL,
    `property_id` CHAR(36) NOT NULL,
    `file_path` VARCHAR(255) NOT NULL,
    `mime_type` VARCHAR(60) NOT NULL,
    `status` ENUM('PENDING', 'APPROVED', 'REJECTED') NOT NULL DEFAULT 'PENDING',
    `reviewed_by_id` CHAR(36) NULL,
    `uploaded_by_id` CHAR(36) NOT NULL,
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    INDEX `property_images_property_id_status_idx`(`property_id`, `status`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `property_documents` (
    `id` CHAR(36) NOT NULL,
    `property_id` CHAR(36) NOT NULL,
    `doc_type` ENUM('OWNERSHIP_DEED', 'TAX_RECEIPT', 'UTILITY_BILL', 'ID_PROOF', 'OTHER') NOT NULL,
    `file_path` VARCHAR(255) NOT NULL,
    `original_name` VARCHAR(200) NOT NULL,
    `mime_type` VARCHAR(60) NOT NULL,
    `status` ENUM('PENDING', 'APPROVED', 'REJECTED') NOT NULL DEFAULT 'PENDING',
    `note` VARCHAR(500) NULL,
    `reviewed_by_id` CHAR(36) NULL,
    `uploaded_by_id` CHAR(36) NOT NULL,
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    INDEX `property_documents_property_id_status_idx`(`property_id`, `status`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `property_assignments` (
    `id` CHAR(36) NOT NULL,
    `property_id` CHAR(36) NOT NULL,
    `user_id` CHAR(36) NOT NULL,
    `type` ENUM('MANAGER', 'AGENT') NOT NULL,
    `created_by_id` CHAR(36) NOT NULL,
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    INDEX `property_assignments_user_id_idx`(`user_id`),
    UNIQUE INDEX `property_assignments_property_id_user_id_type_key`(`property_id`, `user_id`, `type`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `property_inspections` (
    `id` CHAR(36) NOT NULL,
    `property_id` CHAR(36) NOT NULL,
    `inspector_id` CHAR(36) NOT NULL,
    `scheduled_at` DATETIME(3) NOT NULL,
    `status` ENUM('SCHEDULED', 'COMPLETED', 'CANCELLED') NOT NULL DEFAULT 'SCHEDULED',
    `notes` TEXT NULL,
    `result` VARCHAR(40) NULL,
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    INDEX `property_inspections_property_id_idx`(`property_id`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `rental_applications` (
    `id` CHAR(36) NOT NULL,
    `property_id` CHAR(36) NOT NULL,
    `tenant_id` CHAR(36) NOT NULL,
    `message` VARCHAR(1000) NULL,
    `proposed_move_in` DATE NOT NULL,
    `occupants` INTEGER NOT NULL DEFAULT 1,
    `status` ENUM('PENDING', 'APPROVED', 'REJECTED', 'WITHDRAWN') NOT NULL DEFAULT 'PENDING',
    `decision_note` VARCHAR(500) NULL,
    `decided_by_id` CHAR(36) NULL,
    `decided_at` DATETIME(3) NULL,
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    INDEX `rental_applications_property_id_status_idx`(`property_id`, `status`),
    INDEX `rental_applications_tenant_id_status_idx`(`tenant_id`, `status`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `leases` (
    `id` CHAR(36) NOT NULL,
    `property_id` CHAR(36) NOT NULL,
    `landlord_id` CHAR(36) NOT NULL,
    `tenant_id` CHAR(36) NOT NULL,
    `application_id` CHAR(36) NULL,
    `start_date` DATE NOT NULL,
    `end_date` DATE NOT NULL,
    `monthly_rent` DECIMAL(12, 2) NOT NULL,
    `security_deposit` DECIMAL(12, 2) NOT NULL,
    `rent_due_day` INTEGER NOT NULL DEFAULT 5,
    `terms` TEXT NULL,
    `status` ENUM('ACTIVE', 'ENDED', 'TERMINATED') NOT NULL DEFAULT 'ACTIVE',
    `ended_at` DATETIME(3) NULL,
    `created_by_id` CHAR(36) NOT NULL,
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    UNIQUE INDEX `leases_application_id_key`(`application_id`),
    INDEX `leases_tenant_id_status_idx`(`tenant_id`, `status`),
    INDEX `leases_landlord_id_status_idx`(`landlord_id`, `status`),
    INDEX `leases_property_id_status_idx`(`property_id`, `status`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `rent_payments` (
    `id` CHAR(36) NOT NULL,
    `lease_id` CHAR(36) NOT NULL,
    `property_id` CHAR(36) NOT NULL,
    `tenant_id` CHAR(36) NOT NULL,
    `landlord_id` CHAR(36) NOT NULL,
    `period` CHAR(7) NOT NULL,
    `amount` DECIMAL(12, 2) NOT NULL,
    `due_date` DATE NOT NULL,
    `status` ENUM('DUE', 'PAID', 'OVERDUE', 'WAIVED') NOT NULL DEFAULT 'DUE',
    `paid_at` DATETIME(3) NULL,
    `method` VARCHAR(30) NULL,
    `receipt_number` VARCHAR(40) NULL,
    `recorded_by_id` CHAR(36) NULL,
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    UNIQUE INDEX `rent_payments_receipt_number_key`(`receipt_number`),
    INDEX `rent_payments_tenant_id_status_idx`(`tenant_id`, `status`),
    INDEX `rent_payments_landlord_id_status_idx`(`landlord_id`, `status`),
    UNIQUE INDEX `rent_payments_lease_id_period_key`(`lease_id`, `period`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `transactions` (
    `id` CHAR(36) NOT NULL,
    `type` ENUM('RENT_PAYMENT', 'REFUND', 'COMMISSION', 'SERVICE_CHARGE', 'SUBSCRIPTION', 'ADJUSTMENT') NOT NULL,
    `status` ENUM('PENDING', 'SUCCESS', 'FAILED', 'REVERSED') NOT NULL DEFAULT 'PENDING',
    `amount` DECIMAL(12, 2) NOT NULL,
    `payer_id` CHAR(36) NULL,
    `payee_id` CHAR(36) NULL,
    `property_id` CHAR(36) NULL,
    `rent_payment_id` CHAR(36) NULL,
    `invoice_id` CHAR(36) NULL,
    `method` VARCHAR(30) NOT NULL,
    `reference` VARCHAR(60) NOT NULL,
    `notes` VARCHAR(500) NULL,
    `is_test` BOOLEAN NOT NULL DEFAULT false,
    `reconciled` BOOLEAN NOT NULL DEFAULT false,
    `reconciled_by_id` CHAR(36) NULL,
    `reconciled_at` DATETIME(3) NULL,
    `created_by_id` CHAR(36) NULL,
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    UNIQUE INDEX `transactions_reference_key`(`reference`),
    INDEX `transactions_type_status_created_at_idx`(`type`, `status`, `created_at`),
    INDEX `transactions_payer_id_idx`(`payer_id`),
    INDEX `transactions_payee_id_idx`(`payee_id`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `invoices` (
    `id` CHAR(36) NOT NULL,
    `number` VARCHAR(30) NOT NULL,
    `issued_to_id` CHAR(36) NOT NULL,
    `property_id` CHAR(36) NULL,
    `description` VARCHAR(255) NOT NULL,
    `amount` DECIMAL(12, 2) NOT NULL,
    `tax` DECIMAL(12, 2) NOT NULL DEFAULT 0,
    `total` DECIMAL(12, 2) NOT NULL,
    `status` ENUM('DRAFT', 'ISSUED', 'PAID', 'VOID') NOT NULL DEFAULT 'DRAFT',
    `due_date` DATE NULL,
    `issued_at` DATETIME(3) NULL,
    `created_by_id` CHAR(36) NOT NULL,
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    UNIQUE INDEX `invoices_number_key`(`number`),
    INDEX `invoices_issued_to_id_idx`(`issued_to_id`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `refunds` (
    `id` CHAR(36) NOT NULL,
    `transaction_id` CHAR(36) NOT NULL,
    `amount` DECIMAL(12, 2) NOT NULL,
    `reason` VARCHAR(500) NOT NULL,
    `status` ENUM('REQUESTED', 'APPROVED', 'REJECTED', 'PROCESSED') NOT NULL DEFAULT 'REQUESTED',
    `requested_by_id` CHAR(36) NOT NULL,
    `decided_by_id` CHAR(36) NULL,
    `decided_at` DATETIME(3) NULL,
    `processed_at` DATETIME(3) NULL,
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    INDEX `refunds_status_idx`(`status`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `subscription_plans` (
    `id` CHAR(36) NOT NULL,
    `name` VARCHAR(60) NOT NULL,
    `audience` ENUM('SUPER_ADMIN', 'ADMIN', 'FINANCE_ADMIN', 'PROPERTY_MANAGER', 'SUPPORT', 'MODERATOR', 'VIEWER', 'LANDLORD', 'TENANT', 'PROPERTY_AGENT', 'SERVICE_PROVIDER') NOT NULL,
    `price_monthly` DECIMAL(12, 2) NOT NULL,
    `features` TEXT NULL,
    `active` BOOLEAN NOT NULL DEFAULT true,
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    UNIQUE INDEX `subscription_plans_name_key`(`name`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `subscriptions` (
    `id` CHAR(36) NOT NULL,
    `user_id` CHAR(36) NOT NULL,
    `plan_id` CHAR(36) NOT NULL,
    `status` ENUM('ACTIVE', 'CANCELLED', 'EXPIRED') NOT NULL DEFAULT 'ACTIVE',
    `starts_at` DATETIME(3) NOT NULL,
    `ends_at` DATETIME(3) NULL,
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    INDEX `subscriptions_user_id_idx`(`user_id`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `platform_settings` (
    `key` VARCHAR(64) NOT NULL,
    `value` VARCHAR(500) NOT NULL,
    `updated_by_id` CHAR(36) NULL,
    `updated_at` DATETIME(3) NOT NULL,

    PRIMARY KEY (`key`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `maintenance_requests` (
    `id` CHAR(36) NOT NULL,
    `property_id` CHAR(36) NOT NULL,
    `lease_id` CHAR(36) NULL,
    `raised_by_id` CHAR(36) NOT NULL,
    `landlord_id` CHAR(36) NOT NULL,
    `category` VARCHAR(40) NOT NULL,
    `title` VARCHAR(150) NOT NULL,
    `description` TEXT NOT NULL,
    `priority` ENUM('LOW', 'MEDIUM', 'HIGH', 'URGENT') NOT NULL DEFAULT 'MEDIUM',
    `status` ENUM('OPEN', 'ASSIGNED', 'ACCEPTED', 'IN_PROGRESS', 'COMPLETED', 'DECLINED', 'CANCELLED', 'CLOSED') NOT NULL DEFAULT 'OPEN',
    `assigned_provider_id` CHAR(36) NULL,
    `service_charge` DECIMAL(12, 2) NULL,
    `provider_note` VARCHAR(500) NULL,
    `completed_at` DATETIME(3) NULL,
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updated_at` DATETIME(3) NOT NULL,

    INDEX `maintenance_requests_landlord_id_status_idx`(`landlord_id`, `status`),
    INDEX `maintenance_requests_assigned_provider_id_status_idx`(`assigned_provider_id`, `status`),
    INDEX `maintenance_requests_raised_by_id_idx`(`raised_by_id`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `maintenance_photos` (
    `id` CHAR(36) NOT NULL,
    `request_id` CHAR(36) NOT NULL,
    `file_path` VARCHAR(255) NOT NULL,
    `mime_type` VARCHAR(60) NOT NULL,
    `uploaded_by_id` CHAR(36) NOT NULL,
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `support_tickets` (
    `id` CHAR(36) NOT NULL,
    `raised_by_id` CHAR(36) NOT NULL,
    `category` ENUM('TENANT_COMPLAINT', 'LANDLORD_COMPLAINT', 'PAYMENT', 'ACCOUNT', 'PROPERTY', 'OTHER') NOT NULL,
    `subject` VARCHAR(150) NOT NULL,
    `description` TEXT NOT NULL,
    `priority` ENUM('LOW', 'MEDIUM', 'HIGH', 'URGENT') NOT NULL DEFAULT 'MEDIUM',
    `status` ENUM('OPEN', 'IN_PROGRESS', 'RESOLVED', 'CLOSED') NOT NULL DEFAULT 'OPEN',
    `assigned_to_id` CHAR(36) NULL,
    `property_id` CHAR(36) NULL,
    `resolved_at` DATETIME(3) NULL,
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updated_at` DATETIME(3) NOT NULL,

    INDEX `support_tickets_raised_by_id_idx`(`raised_by_id`),
    INDEX `support_tickets_status_assigned_to_id_idx`(`status`, `assigned_to_id`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `ticket_messages` (
    `id` CHAR(36) NOT NULL,
    `ticket_id` CHAR(36) NOT NULL,
    `author_id` CHAR(36) NOT NULL,
    `body` TEXT NOT NULL,
    `internal` BOOLEAN NOT NULL DEFAULT false,
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    INDEX `ticket_messages_ticket_id_created_at_idx`(`ticket_id`, `created_at`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `enquiries` (
    `id` CHAR(36) NOT NULL,
    `property_id` CHAR(36) NOT NULL,
    `tenant_id` CHAR(36) NOT NULL,
    `message` VARCHAR(1000) NOT NULL,
    `status` ENUM('NEW', 'CONTACTED', 'VISIT_SCHEDULED', 'CLOSED') NOT NULL DEFAULT 'NEW',
    `follow_up_at` DATETIME(3) NULL,
    `notes` VARCHAR(1000) NULL,
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updated_at` DATETIME(3) NOT NULL,

    INDEX `enquiries_property_id_status_idx`(`property_id`, `status`),
    INDEX `enquiries_tenant_id_idx`(`tenant_id`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `property_visits` (
    `id` CHAR(36) NOT NULL,
    `property_id` CHAR(36) NOT NULL,
    `enquiry_id` CHAR(36) NULL,
    `agent_id` CHAR(36) NOT NULL,
    `tenant_id` CHAR(36) NULL,
    `scheduled_at` DATETIME(3) NOT NULL,
    `status` ENUM('SCHEDULED', 'COMPLETED', 'CANCELLED', 'NO_SHOW') NOT NULL DEFAULT 'SCHEDULED',
    `notes` VARCHAR(500) NULL,
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    INDEX `property_visits_agent_id_scheduled_at_idx`(`agent_id`, `scheduled_at`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `fraud_reports` (
    `id` CHAR(36) NOT NULL,
    `property_id` CHAR(36) NULL,
    `reported_by_id` CHAR(36) NOT NULL,
    `reason` VARCHAR(80) NOT NULL,
    `details` TEXT NOT NULL,
    `status` ENUM('OPEN', 'INVESTIGATING', 'RESOLVED', 'DISMISSED') NOT NULL DEFAULT 'OPEN',
    `handled_by_id` CHAR(36) NULL,
    `resolution` VARCHAR(500) NULL,
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updated_at` DATETIME(3) NOT NULL,

    INDEX `fraud_reports_status_idx`(`status`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `notifications` (
    `id` CHAR(36) NOT NULL,
    `user_id` CHAR(36) NOT NULL,
    `title` VARCHAR(150) NOT NULL,
    `body` VARCHAR(500) NOT NULL,
    `link` VARCHAR(255) NULL,
    `read_at` DATETIME(3) NULL,
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    INDEX `notifications_user_id_read_at_created_at_idx`(`user_id`, `read_at`, `created_at`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- AddForeignKey
ALTER TABLE `role_permissions` ADD CONSTRAINT `role_permissions_role_fkey` FOREIGN KEY (`role`) REFERENCES `roles`(`key`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `role_permissions` ADD CONSTRAINT `role_permissions_permission_key_fkey` FOREIGN KEY (`permission_key`) REFERENCES `permissions`(`key`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `user_permissions` ADD CONSTRAINT `user_permissions_user_id_fkey` FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `user_permissions` ADD CONSTRAINT `user_permissions_permission_key_fkey` FOREIGN KEY (`permission_key`) REFERENCES `permissions`(`key`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `otp_challenges` ADD CONSTRAINT `otp_challenges_user_id_fkey` FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `auth_sessions` ADD CONSTRAINT `auth_sessions_user_id_fkey` FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `security_audit_logs` ADD CONSTRAINT `security_audit_logs_user_id_fkey` FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `landlord_profiles` ADD CONSTRAINT `landlord_profiles_user_id_fkey` FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `tenant_profiles` ADD CONSTRAINT `tenant_profiles_user_id_fkey` FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `agent_profiles` ADD CONSTRAINT `agent_profiles_user_id_fkey` FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `service_provider_profiles` ADD CONSTRAINT `service_provider_profiles_user_id_fkey` FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `properties` ADD CONSTRAINT `properties_owner_id_fkey` FOREIGN KEY (`owner_id`) REFERENCES `users`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `property_images` ADD CONSTRAINT `property_images_property_id_fkey` FOREIGN KEY (`property_id`) REFERENCES `properties`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `property_documents` ADD CONSTRAINT `property_documents_property_id_fkey` FOREIGN KEY (`property_id`) REFERENCES `properties`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `property_assignments` ADD CONSTRAINT `property_assignments_property_id_fkey` FOREIGN KEY (`property_id`) REFERENCES `properties`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `property_assignments` ADD CONSTRAINT `property_assignments_user_id_fkey` FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `property_inspections` ADD CONSTRAINT `property_inspections_property_id_fkey` FOREIGN KEY (`property_id`) REFERENCES `properties`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `rental_applications` ADD CONSTRAINT `rental_applications_property_id_fkey` FOREIGN KEY (`property_id`) REFERENCES `properties`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `rental_applications` ADD CONSTRAINT `rental_applications_tenant_id_fkey` FOREIGN KEY (`tenant_id`) REFERENCES `users`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `leases` ADD CONSTRAINT `leases_property_id_fkey` FOREIGN KEY (`property_id`) REFERENCES `properties`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `leases` ADD CONSTRAINT `leases_landlord_id_fkey` FOREIGN KEY (`landlord_id`) REFERENCES `users`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `leases` ADD CONSTRAINT `leases_tenant_id_fkey` FOREIGN KEY (`tenant_id`) REFERENCES `users`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `leases` ADD CONSTRAINT `leases_application_id_fkey` FOREIGN KEY (`application_id`) REFERENCES `rental_applications`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `rent_payments` ADD CONSTRAINT `rent_payments_lease_id_fkey` FOREIGN KEY (`lease_id`) REFERENCES `leases`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `transactions` ADD CONSTRAINT `transactions_rent_payment_id_fkey` FOREIGN KEY (`rent_payment_id`) REFERENCES `rent_payments`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `transactions` ADD CONSTRAINT `transactions_invoice_id_fkey` FOREIGN KEY (`invoice_id`) REFERENCES `invoices`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `refunds` ADD CONSTRAINT `refunds_transaction_id_fkey` FOREIGN KEY (`transaction_id`) REFERENCES `transactions`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `subscriptions` ADD CONSTRAINT `subscriptions_plan_id_fkey` FOREIGN KEY (`plan_id`) REFERENCES `subscription_plans`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `maintenance_requests` ADD CONSTRAINT `maintenance_requests_property_id_fkey` FOREIGN KEY (`property_id`) REFERENCES `properties`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `maintenance_requests` ADD CONSTRAINT `maintenance_requests_raised_by_id_fkey` FOREIGN KEY (`raised_by_id`) REFERENCES `users`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `maintenance_requests` ADD CONSTRAINT `maintenance_requests_assigned_provider_id_fkey` FOREIGN KEY (`assigned_provider_id`) REFERENCES `users`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `maintenance_photos` ADD CONSTRAINT `maintenance_photos_request_id_fkey` FOREIGN KEY (`request_id`) REFERENCES `maintenance_requests`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `support_tickets` ADD CONSTRAINT `support_tickets_raised_by_id_fkey` FOREIGN KEY (`raised_by_id`) REFERENCES `users`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `support_tickets` ADD CONSTRAINT `support_tickets_assigned_to_id_fkey` FOREIGN KEY (`assigned_to_id`) REFERENCES `users`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `ticket_messages` ADD CONSTRAINT `ticket_messages_ticket_id_fkey` FOREIGN KEY (`ticket_id`) REFERENCES `support_tickets`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `enquiries` ADD CONSTRAINT `enquiries_property_id_fkey` FOREIGN KEY (`property_id`) REFERENCES `properties`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `property_visits` ADD CONSTRAINT `property_visits_property_id_fkey` FOREIGN KEY (`property_id`) REFERENCES `properties`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `notifications` ADD CONSTRAINT `notifications_user_id_fkey` FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;
