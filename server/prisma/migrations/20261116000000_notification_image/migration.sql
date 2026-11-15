-- In-app notifications can carry a picture (announcements); auth-protected API path.
ALTER TABLE `notifications` ADD COLUMN `image_url` VARCHAR(255) NULL;
