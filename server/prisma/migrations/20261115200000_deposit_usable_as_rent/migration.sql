-- Landlord's choice: may the tenant pay rent from the security deposit? NULL on a flat = use the building's setting.
ALTER TABLE `property_pricing` ADD COLUMN `deposit_usable_as_rent` BOOLEAN NULL;

-- Copied to the lease when it's created (default: not allowed).
ALTER TABLE `leases` ADD COLUMN `deposit_usable_as_rent` BOOLEAN NOT NULL DEFAULT false;
