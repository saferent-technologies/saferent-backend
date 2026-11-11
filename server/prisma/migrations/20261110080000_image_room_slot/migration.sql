-- Room number for per-room listing photos (Bedroom 1, Bedroom 2 ...)
ALTER TABLE `property_images` ADD COLUMN `slot` INTEGER NULL;
