-- An electricity bill in the owner's name counts as ownership proof: it now goes to SafeRent verification
-- like a sale deed or property tax receipt (existing uploads get the Verify button).
UPDATE `property_documents` SET `needs_verification` = true WHERE `doc_type` = 'ELECTRICITY_BILL' AND `needs_verification` = false;
