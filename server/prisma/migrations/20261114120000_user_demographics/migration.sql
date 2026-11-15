-- Demographics asked on the profile screen after sign-in (all optional columns; existing users stay valid).
ALTER TABLE `users`
    ADD COLUMN `gender` ENUM('MALE', 'FEMALE', 'OTHER', 'PREFER_NOT_TO_SAY') NULL,
    ADD COLUMN `date_of_birth` DATE NULL,
    ADD COLUMN `city` VARCHAR(80) NULL,
    ADD COLUMN `state` VARCHAR(80) NULL;
