-- AI inbox (Phase 2 step 1, 2026-10-16): the agents' suggestions waiting for the PM. An agent only
-- suggests; nothing changes and nothing is sent until the PM accepts. Each suggestion holds the
-- exact change it would make (payload) and what it is based on (evidence), and after Accept the
-- way back (undo_ref). One suggestion per review finding: UNIQUE(project_id, review_id, item_key).
CREATE TABLE IF NOT EXISTS ai_suggestions (
  id VARCHAR(36) NOT NULL PRIMARY KEY,
  project_id VARCHAR(36) NOT NULL,
  schedule_id VARCHAR(36) DEFAULT NULL,
  agent VARCHAR(40) NOT NULL,
  kind VARCHAR(40) NOT NULL,
  review_id VARCHAR(36) DEFAULT NULL,
  item_key VARCHAR(160) NOT NULL,
  title VARCHAR(300) NOT NULL,
  detail TEXT DEFAULT NULL,
  payload JSON NOT NULL,
  evidence JSON DEFAULT NULL,
  measure DOUBLE NOT NULL DEFAULT 0,
  status VARCHAR(16) NOT NULL DEFAULT 'waiting',
  reason VARCHAR(40) DEFAULT NULL,
  result_summary VARCHAR(500) DEFAULT NULL,
  undo_ref JSON DEFAULT NULL,
  decided_by VARCHAR(36) DEFAULT NULL,
  decided_at DATETIME DEFAULT NULL,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE KEY uk_ai_suggestion_item (project_id, review_id, item_key),
  INDEX idx_ai_suggestions_status (status, created_at),
  INDEX idx_ai_suggestions_project (project_id, status)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- Agent settings: the company default (project_id '') and a project's own override
CREATE TABLE IF NOT EXISTS agent_settings (
  project_id VARCHAR(36) NOT NULL DEFAULT '',
  agent VARCHAR(40) NOT NULL,
  enabled TINYINT(1) NOT NULL DEFAULT 1,
  settings JSON DEFAULT NULL,
  updated_by VARCHAR(36) DEFAULT NULL,
  updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (project_id, agent)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
