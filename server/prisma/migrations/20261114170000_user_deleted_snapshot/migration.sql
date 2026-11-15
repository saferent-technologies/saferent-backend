-- Staff-only reminder of who a deleted account was (former name, role, masked phone / email).
ALTER TABLE `users` ADD COLUMN `deleted_snapshot` JSON NULL;
