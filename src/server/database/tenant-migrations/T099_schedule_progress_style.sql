-- T099: per-plan progress style. 'percent' = any % (as always); 'done' = each task is done (100) or not done (0),
-- headings still roll up from their tasks. Off by default: every existing plan stays on 'percent'.
ALTER TABLE schedules ADD COLUMN IF NOT EXISTS progress_style ENUM('percent','done') NOT NULL DEFAULT 'percent';
