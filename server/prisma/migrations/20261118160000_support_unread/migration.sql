-- Support: staff see ticket activity as a badge on Support (not as notification rows).
ALTER TABLE `support_tickets`
  ADD COLUMN `customer_message_at` DATETIME(3) NULL,
  ADD COLUMN `agent_seen_at` DATETIME(3) NULL;

UPDATE `support_tickets` t
SET t.`customer_message_at` = GREATEST(t.`created_at`, COALESCE((SELECT MAX(m.`created_at`) FROM `ticket_messages` m WHERE m.`ticket_id` = t.`id` AND m.`author_id` = t.`raised_by_id`), t.`created_at`)),
    t.`agent_seen_at` = CASE WHEN t.`assigned_to_id` IS NOT NULL THEN NOW(3) ELSE NULL END;

-- Remove the old support notifications staff received about other people's tickets
-- ("New support ticket", "Reply on: …", "Ticket assigned to you"). Ticket owners keep theirs.
DELETE n FROM `notifications` n
JOIN `support_tickets` t ON n.`link` = CONCAT('/support/', t.`id`)
WHERE n.`user_id` <> t.`raised_by_id`;
