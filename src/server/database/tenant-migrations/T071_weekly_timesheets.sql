-- Weekly timesheets (2026-10-02): one timesheet per person per week, across all their projects,
-- approved by ONE person — their line manager (T070). Replaces timesheet_submissions (one per
-- person, project and week, approved by that project's PMs), which is kept for history only.
-- Hours still live in time_entries (status draft → submitted → approved / rejected).
CREATE TABLE IF NOT EXISTS timesheets (
  id VARCHAR(36) NOT NULL PRIMARY KEY,
  user_id VARCHAR(36) NOT NULL,
  week_start DATE NOT NULL,
  status ENUM('submitted', 'approved', 'rejected') NOT NULL DEFAULT 'submitted',
  approver_user_id VARCHAR(36) NULL,
  total_hours DECIMAL(7,2) NOT NULL DEFAULT 0,
  submitted_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  reviewed_by VARCHAR(36) NULL,
  reviewed_at DATETIME NULL,
  rejection_reason TEXT NULL,
  UNIQUE KEY uk_timesheet_user_week (user_id, week_start),
  INDEX idx_timesheet_approver (approver_user_id, status)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- A PM's note on one task line of a submitted timesheet, for the line manager to see
-- ("these 2 h belong to Data cleanup"). Only PMs of that task's project can add one.
CREATE TABLE IF NOT EXISTS timesheet_flags (
  id VARCHAR(36) NOT NULL PRIMARY KEY,
  timesheet_id VARCHAR(36) NOT NULL,
  project_id VARCHAR(36) NOT NULL,
  task_id VARCHAR(36) NOT NULL,
  flagged_by VARCHAR(36) NOT NULL,
  note VARCHAR(1000) NOT NULL,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  INDEX idx_timesheet_flags_sheet (timesheet_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
