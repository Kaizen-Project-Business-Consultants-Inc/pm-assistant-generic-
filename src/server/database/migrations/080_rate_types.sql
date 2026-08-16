-- Enhancement 4: Rate Types (overtime rate support)
ALTER TABLE resources ADD COLUMN overtime_rate_hourly DECIMAL(10,2) DEFAULT NULL;
ALTER TABLE time_entries ADD COLUMN rate_type ENUM('standard','overtime') DEFAULT 'standard';
