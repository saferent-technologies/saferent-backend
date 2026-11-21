-- Maintenance: technician, estimated / actual cost, who paid (asked at resolution), work start, videos and invoices.
ALTER TABLE `maintenance_requests`
    ADD COLUMN `technician_name` VARCHAR(120) NULL,
    ADD COLUMN `technician_phone` VARCHAR(20) NULL,
    ADD COLUMN `estimated_cost` DECIMAL(12, 2) NULL,
    ADD COLUMN `actual_cost` DECIMAL(12, 2) NULL,
    ADD COLUMN `paid_by` VARCHAR(10) NULL,
    ADD COLUMN `work_started_at` DATETIME(3) NULL;

ALTER TABLE `maintenance_photos` ADD COLUMN `kind` VARCHAR(10) NOT NULL DEFAULT 'PHOTO';
