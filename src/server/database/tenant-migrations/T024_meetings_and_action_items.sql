-- T024: Meetings table and action items tracker
-- Creates meetings management + meeting action items

-- 1. Meetings table (parent for meeting_analyses)
CREATE TABLE IF NOT EXISTS meetings (
  id VARCHAR(36) NOT NULL PRIMARY KEY,
  project_id VARCHAR(36) NOT NULL,
  title VARCHAR(255) NOT NULL,
  meeting_type ENUM('standup','sprint_review','sprint_retro','planning','steering','kickoff','ad_hoc') NOT NULL DEFAULT 'ad_hoc',
  scheduled_date DATETIME NOT NULL,
  duration_minutes INT DEFAULT 60,
  location VARCHAR(255) DEFAULT NULL,
  attendees JSON DEFAULT NULL,
  agenda_items JSON DEFAULT NULL,
  notes TEXT DEFAULT NULL,
  status ENUM('scheduled','in_progress','completed','cancelled') NOT NULL DEFAULT 'scheduled',
  created_by VARCHAR(36) NOT NULL,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  INDEX idx_mtg_project (project_id),
  INDEX idx_mtg_date (scheduled_date),
  INDEX idx_mtg_status (status)
);

-- 2. Link meeting_analyses to meetings (optional FK — existing analyses stay orphaned)
ALTER TABLE meeting_analyses ADD COLUMN meeting_id VARCHAR(36) DEFAULT NULL;
ALTER TABLE meeting_analyses ADD INDEX idx_ma_meeting (meeting_id);

-- 3. Meeting action items (first-class, tracked independently)
CREATE TABLE IF NOT EXISTS meeting_action_items (
  id VARCHAR(36) NOT NULL PRIMARY KEY,
  meeting_id VARCHAR(36) NOT NULL,
  project_id VARCHAR(36) NOT NULL,
  description TEXT NOT NULL,
  assignee_name VARCHAR(255) DEFAULT NULL,
  assignee_user_id VARCHAR(36) DEFAULT NULL,
  due_date DATE DEFAULT NULL,
  priority ENUM('low','medium','high','critical') NOT NULL DEFAULT 'medium',
  status ENUM('open','in_progress','completed','cancelled') NOT NULL DEFAULT 'open',
  completed_at TIMESTAMP NULL DEFAULT NULL,
  source ENUM('manual','ai_extracted') NOT NULL DEFAULT 'manual',
  source_analysis_id VARCHAR(64) DEFAULT NULL,
  notes TEXT DEFAULT NULL,
  created_by VARCHAR(36) NOT NULL,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  INDEX idx_mai_meeting (meeting_id),
  INDEX idx_mai_project (project_id),
  INDEX idx_mai_assignee (assignee_user_id),
  INDEX idx_mai_status (status),
  INDEX idx_mai_due (due_date)
);
