-- isProfileCompleted: set by the app from the demographic screen.
ALTER TABLE `users` ADD COLUMN `profile_completed` BOOLEAN NOT NULL DEFAULT false;
