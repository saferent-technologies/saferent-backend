-- SafeRent lists rentals only: no SALE listings.

-- 1) Tell the owners (in-app notification), before the rows change.
INSERT INTO `notifications` (`id`, `user_id`, `title`, `body`, `link`, `created_at`)
SELECT UUID(), `owner_id`, 'Add monthly rent to your listing',
       CONCAT('SafeRent lists rentals only. "', COALESCE(`title`, `code`), '" was moved to draft. Add the monthly rent and submit it again.'),
       CONCAT('/properties/', `id`), CURRENT_TIMESTAMP(3)
FROM `properties`
WHERE `listing_type` = 'SALE' AND `revision_of_id` IS NULL;

-- 2) Sale listings become rental drafts with a note (they need a rent and a new review).
UPDATE `properties`
SET `listing_type` = 'RENT',
    `publication_status` = 'DRAFT',
    `moderation_note` = 'Add monthly rent: SafeRent lists rentals only'
WHERE `listing_type` = 'SALE';

-- 3) No sale prices any more.
ALTER TABLE `property_pricing` DROP COLUMN `sale_price`;

-- 4) RENT / LEASE only.
ALTER TABLE `properties` MODIFY `listing_type` ENUM('RENT', 'LEASE') NOT NULL DEFAULT 'RENT';
