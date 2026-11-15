-- Automatic "rent due today" / "rent overdue" notifications (sent once per due).
ALTER TABLE `rent_payments`
  ADD COLUMN `due_notified_at` DATETIME(3) NULL,
  ADD COLUMN `overdue_notified_at` DATETIME(3) NULL;

-- Existing dues don't get a burst of old notifications; dues re-dated by the new schedule are reset in code.
UPDATE `rent_payments` SET `due_notified_at` = NOW(3), `overdue_notified_at` = NOW(3);

CREATE INDEX `rent_payments_status_due_date_idx` ON `rent_payments`(`status`, `due_date`);
