-- T019: Timesheet approval workflow
-- Adds status tracking to time entries and a submissions table for week+project approval lifecycle

ALTER TABLE time_entries
  ADD COLUMN status ENUM('draft','submitted','approved','rejected') NOT NULL DEFAULT 'draft',
  ADD COLUMN approved_by VARCHAR(36) DEFAULT NULL,
  ADD COLUMN approved_at DATETIME DEFAULT NULL,
  ADD INDEX idx_time_status (status),
  ADD INDEX idx_time_user_project_date (user_id, project_id, date);

CREATE TABLE IF NOT EXISTS timesheet_submissions (
  id VARCHAR(36) PRIMARY KEY,
  user_id VARCHAR(36) NOT NULL,
  project_id VARCHAR(36) NOT NULL,
  week_start DATE NOT NULL,
  status ENUM('submitted','approved','rejected') NOT NULL DEFAULT 'submitted',
  total_hours DECIMAL(7,2) NOT NULL DEFAULT 0,
  submitted_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  reviewed_by VARCHAR(36) DEFAULT NULL,
  reviewed_at DATETIME DEFAULT NULL,
  rejection_reason TEXT DEFAULT NULL,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  UNIQUE KEY uk_user_project_week (user_id, project_id, week_start),
  INDEX idx_ts_project_status (project_id, status),
  INDEX idx_ts_user (user_id)
);
