-- Support queue: agent presence + round robin, and when a ticket was assigned.
ALTER TABLE `users`
  ADD COLUMN `support_seen_at` DATETIME(3) NULL,
  ADD COLUMN `support_assigned_at` DATETIME(3) NULL;

ALTER TABLE `support_tickets` ADD COLUMN `assigned_at` DATETIME(3) NULL;
UPDATE `support_tickets` SET `assigned_at` = `updated_at` WHERE `assigned_to_id` IS NOT NULL;
CREATE INDEX `support_tickets_assigned_to_id_status_created_at_idx` ON `support_tickets`(`assigned_to_id`, `status`, `created_at`);
