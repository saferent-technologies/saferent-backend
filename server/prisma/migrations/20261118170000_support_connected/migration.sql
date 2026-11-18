-- Support: the staff member the ticket owner is connected to (greeting sent once; takeover updates it).
ALTER TABLE `support_tickets`
  ADD COLUMN `connected_to_id` CHAR(36) NULL,
  ADD COLUMN `connected_at` DATETIME(3) NULL;
CREATE INDEX `support_tickets_connected_to_id_fkey` ON `support_tickets`(`connected_to_id`);
ALTER TABLE `support_tickets` ADD CONSTRAINT `support_tickets_connected_to_id_fkey` FOREIGN KEY (`connected_to_id`) REFERENCES `users`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;
