-- Enhancement 6: Effort-Driven Scheduling
ALTER TABLE tasks ADD COLUMN work_hours DECIMAL(10,2) DEFAULT NULL;
ALTER TABLE tasks ADD COLUMN effort_driven TINYINT(1) DEFAULT 0;
