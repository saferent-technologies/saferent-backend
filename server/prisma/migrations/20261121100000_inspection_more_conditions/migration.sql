-- Inspection report: flooring, bathroom, kitchen, furniture and appliance condition + repair requirements.
ALTER TABLE `property_inspections`
    ADD COLUMN `flooring_condition` ENUM('GOOD', 'FAIR', 'POOR', 'NOT_APPLICABLE', 'NOT_INSPECTED') NOT NULL DEFAULT 'NOT_INSPECTED',
    ADD COLUMN `bathroom_condition` ENUM('GOOD', 'FAIR', 'POOR', 'NOT_APPLICABLE', 'NOT_INSPECTED') NOT NULL DEFAULT 'NOT_INSPECTED',
    ADD COLUMN `kitchen_condition` ENUM('GOOD', 'FAIR', 'POOR', 'NOT_APPLICABLE', 'NOT_INSPECTED') NOT NULL DEFAULT 'NOT_INSPECTED',
    ADD COLUMN `furniture_condition` ENUM('GOOD', 'FAIR', 'POOR', 'NOT_APPLICABLE', 'NOT_INSPECTED') NOT NULL DEFAULT 'NOT_INSPECTED',
    ADD COLUMN `appliance_condition` ENUM('GOOD', 'FAIR', 'POOR', 'NOT_APPLICABLE', 'NOT_INSPECTED') NOT NULL DEFAULT 'NOT_INSPECTED',
    ADD COLUMN `appliance_inventory` JSON NULL,
    ADD COLUMN `repair_requirements` JSON NULL;
