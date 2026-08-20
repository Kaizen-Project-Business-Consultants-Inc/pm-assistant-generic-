-- T021: Scrum ceremonies — standup logging, retrospective board, DoR/DoD checklists
-- Applied per tenant DB

-- 1. Per-person daily standup entries
CREATE TABLE IF NOT EXISTS standup_entries (
  id VARCHAR(36) NOT NULL PRIMARY KEY,
  sprint_id VARCHAR(36) NOT NULL,
  project_id VARCHAR(36) NOT NULL,
  user_id VARCHAR(36) NOT NULL,
  entry_date DATE NOT NULL,
  yesterday TEXT DEFAULT NULL,
  today TEXT DEFAULT NULL,
  blockers JSON DEFAULT NULL,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  UNIQUE KEY uk_standup_sprint_user_date (sprint_id, user_id, entry_date),
  INDEX idx_standup_sprint_date (sprint_id, entry_date)
);

-- 2. Structured retrospective items
CREATE TABLE IF NOT EXISTS retrospective_items (
  id VARCHAR(36) NOT NULL PRIMARY KEY,
  sprint_id VARCHAR(36) NOT NULL,
  project_id VARCHAR(36) NOT NULL,
  category ENUM('went_well','to_improve','action_item') NOT NULL,
  content TEXT NOT NULL,
  created_by VARCHAR(36) NOT NULL,
  vote_count INT NOT NULL DEFAULT 0,
  converted_task_id VARCHAR(36) DEFAULT NULL,
  ai_generated TINYINT(1) NOT NULL DEFAULT 0,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  INDEX idx_retro_sprint (sprint_id)
);

-- 3. Retrospective votes (one per user per item)
CREATE TABLE IF NOT EXISTS retrospective_votes (
  id VARCHAR(36) NOT NULL PRIMARY KEY,
  item_id VARCHAR(36) NOT NULL,
  user_id VARCHAR(36) NOT NULL,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE KEY uk_retro_vote (item_id, user_id),
  INDEX idx_retro_vote_item (item_id)
);

-- 4. Project-level DoR/DoD templates
CREATE TABLE IF NOT EXISTS scrum_definitions (
  id VARCHAR(36) NOT NULL PRIMARY KEY,
  project_id VARCHAR(36) NOT NULL,
  type ENUM('dor','dod') NOT NULL,
  criteria JSON NOT NULL,
  created_by VARCHAR(36) NOT NULL,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  UNIQUE KEY uk_scrum_def_project_type (project_id, type)
);

-- 5. Per-task DoR/DoD checklist instances
CREATE TABLE IF NOT EXISTS task_checklists (
  id VARCHAR(36) NOT NULL PRIMARY KEY,
  task_id VARCHAR(36) NOT NULL,
  project_id VARCHAR(36) NOT NULL,
  type ENUM('dor','dod') NOT NULL,
  items JSON NOT NULL,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  UNIQUE KEY uk_task_checklist (task_id, type),
  INDEX idx_checklist_project_type (project_id, type)
);

-- 6. Expand RAID source enum to include 'standup'
ALTER TABLE project_risks
  MODIFY COLUMN source ENUM('manual','ai_detected','agent','imported','standup') NOT NULL DEFAULT 'manual';
