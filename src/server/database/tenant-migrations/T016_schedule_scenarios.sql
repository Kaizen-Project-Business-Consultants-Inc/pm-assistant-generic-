-- T016: What-if scenario support for schedules
ALTER TABLE schedules ADD COLUMN IF NOT EXISTS is_scenario TINYINT(1) NOT NULL DEFAULT 0;
ALTER TABLE schedules ADD COLUMN IF NOT EXISTS source_schedule_id VARCHAR(36) DEFAULT NULL;
ALTER TABLE schedules ADD COLUMN IF NOT EXISTS scenario_label VARCHAR(100) DEFAULT NULL;
ALTER TABLE tasks ADD COLUMN IF NOT EXISTS original_task_id VARCHAR(36) DEFAULT NULL;
ALTER TABLE schedules ADD INDEX IF NOT EXISTS idx_schedules_source (source_schedule_id);
ALTER TABLE tasks ADD INDEX IF NOT EXISTS idx_tasks_original (original_task_id);
