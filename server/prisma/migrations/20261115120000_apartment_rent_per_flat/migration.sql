-- Apartments: rent, deposit and sale price belong to each flat. Flats without their own price get the
-- building-level values they used to inherit; then the building keeps only common charges and terms.
INSERT INTO `property_pricing` (`id`, `property_id`, `unit_id`, `scope_key`, `currency`, `monthly_rent`, `sale_price`, `security_deposit`, `agreement_charges_paid_by`, `rent_negotiable`, `updated_at`)
SELECT UUID(), u.`property_id`, u.`id`, u.`id`, 'INR', b.`monthly_rent`, b.`sale_price`, b.`security_deposit`, 'NOT_DISCLOSED', 'NOT_DISCLOSED', CURRENT_TIMESTAMP(3)
FROM `property_units` u
JOIN `properties` p ON p.`id` = u.`property_id` AND p.`property_type` = 'APARTMENT'
JOIN `property_pricing` b ON b.`property_id` = p.`id` AND b.`scope_key` = 'PROPERTY'
LEFT JOIN `property_pricing` own ON own.`property_id` = u.`property_id` AND own.`scope_key` = u.`id`
WHERE own.`id` IS NULL
  AND (b.`monthly_rent` IS NOT NULL OR b.`security_deposit` IS NOT NULL OR b.`sale_price` IS NOT NULL);

UPDATE `property_pricing` own
JOIN `property_units` u ON u.`id` = own.`unit_id`
JOIN `properties` p ON p.`id` = u.`property_id` AND p.`property_type` = 'APARTMENT'
JOIN `property_pricing` b ON b.`property_id` = p.`id` AND b.`scope_key` = 'PROPERTY'
SET own.`monthly_rent` = COALESCE(own.`monthly_rent`, b.`monthly_rent`),
    own.`security_deposit` = COALESCE(own.`security_deposit`, b.`security_deposit`),
    own.`sale_price` = COALESCE(own.`sale_price`, b.`sale_price`);

UPDATE `property_pricing` b
JOIN `properties` p ON p.`id` = b.`property_id` AND p.`property_type` = 'APARTMENT'
SET b.`monthly_rent` = NULL, b.`security_deposit` = NULL, b.`sale_price` = NULL
WHERE b.`scope_key` = 'PROPERTY';
