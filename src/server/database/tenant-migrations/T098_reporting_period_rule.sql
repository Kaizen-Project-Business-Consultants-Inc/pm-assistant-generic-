-- T098: "no task longer than one reporting period" (warn only, per project).
-- Existing projects keep the check OFF (DEFAULT 0); new projects switch it ON when they are created
-- (ProjectRepository.insertProject). The limit itself is never stored: it is worked out from the
-- project calendar each time (services/scheduleReview/reportingPeriod.ts).
ALTER TABLE projects
  ADD COLUMN IF NOT EXISTS reporting_period ENUM('week','two_weeks','month') NOT NULL DEFAULT 'week',
  ADD COLUMN IF NOT EXISTS period_rule_enabled TINYINT(1) NOT NULL DEFAULT 0;

-- "Cannot be split": the PM accepts that one task is longer than a period. One row per task; the
-- review no longer counts it. Who and when are kept, with the reason.
CREATE TABLE IF NOT EXISTS task_split_exceptions (
  task_id VARCHAR(36) NOT NULL PRIMARY KEY,
  reason VARCHAR(500) NOT NULL,
  created_by VARCHAR(36) NULL DEFAULT NULL,
  created_by_name VARCHAR(255) NOT NULL DEFAULT '',
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT fk_split_exc_task FOREIGN KEY (task_id) REFERENCES tasks(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
