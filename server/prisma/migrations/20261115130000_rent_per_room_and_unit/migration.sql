-- Rent belongs to each unit / room, never the building:
--  · villa communities (villaListing = COMMUNITY): villas without their own price get the building's;
--  · PG / hostel: rooms without a rent per bed / deposit get the building's;
-- then the building keeps only common charges and terms. (Apartments were done in the previous migration;
-- the new types "Independent building" and "Commercial complex" have no data yet.)

INSERT INTO `property_pricing` (`id`, `property_id`, `unit_id`, `scope_key`, `currency`, `monthly_rent`, `sale_price`, `security_deposit`, `agreement_charges_paid_by`, `rent_negotiable`, `updated_at`)
SELECT UUID(), u.`property_id`, u.`id`, u.`id`, 'INR', b.`monthly_rent`, b.`sale_price`, b.`security_deposit`, 'NOT_DISCLOSED', 'NOT_DISCLOSED', CURRENT_TIMESTAMP(3)
FROM `property_units` u
JOIN `properties` p ON p.`id` = u.`property_id` AND p.`property_type` = 'VILLA'
  AND JSON_UNQUOTE(JSON_EXTRACT(p.`attributes`, '$.villaListing')) = 'COMMUNITY'
JOIN `property_pricing` b ON b.`property_id` = p.`id` AND b.`scope_key` = 'PROPERTY'
LEFT JOIN `property_pricing` own ON own.`property_id` = u.`property_id` AND own.`scope_key` = u.`id`
WHERE own.`id` IS NULL
  AND (b.`monthly_rent` IS NOT NULL OR b.`security_deposit` IS NOT NULL OR b.`sale_price` IS NOT NULL);

UPDATE `property_pricing` b
JOIN `properties` p ON p.`id` = b.`property_id` AND p.`property_type` = 'VILLA'
  AND JSON_UNQUOTE(JSON_EXTRACT(p.`attributes`, '$.villaListing')) = 'COMMUNITY'
SET b.`monthly_rent` = NULL, b.`security_deposit` = NULL, b.`sale_price` = NULL
WHERE b.`scope_key` = 'PROPERTY';

UPDATE `property_rooms` r
JOIN `properties` p ON p.`id` = r.`property_id` AND p.`property_type` IN ('PG', 'HOSTEL')
JOIN `property_pricing` b ON b.`property_id` = p.`id` AND b.`scope_key` = 'PROPERTY'
SET r.`rent_per_bed` = COALESCE(r.`rent_per_bed`, b.`monthly_rent`),
    r.`security_deposit` = COALESCE(r.`security_deposit`, b.`security_deposit`);

UPDATE `property_pricing` b
JOIN `properties` p ON p.`id` = b.`property_id` AND p.`property_type` IN ('PG', 'HOSTEL')
SET b.`monthly_rent` = NULL, b.`security_deposit` = NULL, b.`sale_price` = NULL
WHERE b.`scope_key` = 'PROPERTY';
