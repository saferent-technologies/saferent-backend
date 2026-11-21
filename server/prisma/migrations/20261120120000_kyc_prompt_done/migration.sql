-- "Verify as owner" prompt already handled in the app (never reset on logout).
ALTER TABLE `users`
  ADD COLUMN `kyc_prompt_done` BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN `kyc_prompt_done_at` DATETIME(3) NULL;
