-- Add work_hours and effort_driven columns to tasks (missing from tenant baseline)
ALTER TABLE tasks ADD COLUMN IF NOT EXISTS work_hours DECIMAL(10,2) DEFAULT NULL;
ALTER TABLE tasks ADD COLUMN IF NOT EXISTS effort_driven TINYINT(1) NOT NULL DEFAULT 0;
