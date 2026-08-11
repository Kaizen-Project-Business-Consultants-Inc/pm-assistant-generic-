-- T015: Add progress_mode to schedules (duration vs work weighting for parent rollup)
ALTER TABLE schedules ADD COLUMN IF NOT EXISTS progress_mode ENUM('duration','work') NOT NULL DEFAULT 'duration';
