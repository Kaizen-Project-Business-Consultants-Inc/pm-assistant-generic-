-- Give an imported task a stable identity, and keep a record of what was imported.
--
-- Until now an import matched rows to existing tasks on name + start date. That is the
-- one pairing guaranteed to fail on a REVISED plan, because a revision is precisely a
-- change of dates: every moved task arrived as a brand new task. The file's own
-- identifier (a Project UID, a WBS code, or failing that the row number) was read during
-- the import to wire up predecessors and then thrown away.
--
-- Storing it means a second import can say, with certainty, which row is which — even
-- when both the name and the dates have changed.

ALTER TABLE tasks
  ADD COLUMN IF NOT EXISTS source_ref VARCHAR(120) NULL AFTER original_task_id,
  ADD COLUMN IF NOT EXISTS source_wbs VARCHAR(60) NULL AFTER source_ref;

-- Unique per schedule, not globally: two schedules may legitimately both contain a task
-- whose source identifier is "1". NULLs are distinct in MariaDB, so hand-created tasks
-- (which have no source) are unaffected.
ALTER TABLE tasks
  ADD UNIQUE KEY IF NOT EXISTS idx_tasks_schedule_source (schedule_id, source_ref);

-- What was imported, by whom, when, and what it did. There is currently no record at
-- all: a schedule can change under someone and nothing says which file caused it.
CREATE TABLE IF NOT EXISTS schedule_imports (
  id VARCHAR(36) NOT NULL PRIMARY KEY,
  schedule_id VARCHAR(36) NOT NULL,
  project_id VARCHAR(36) NULL,
  -- SHA-256 of the file contents, so re-importing the identical file is recognised
  -- exactly rather than guessed at from task names.
  file_hash CHAR(64) NOT NULL,
  file_name VARCHAR(255) NULL,
  mode ENUM('create', 'replace') NOT NULL DEFAULT 'create',
  tasks_added INT NOT NULL DEFAULT 0,
  tasks_updated INT NOT NULL DEFAULT 0,
  tasks_unchanged INT NOT NULL DEFAULT 0,
  tasks_missing INT NOT NULL DEFAULT 0,
  imported_by VARCHAR(36) NULL,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  INDEX idx_schedule_imports_schedule (schedule_id, created_at),
  INDEX idx_schedule_imports_hash (file_hash)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
