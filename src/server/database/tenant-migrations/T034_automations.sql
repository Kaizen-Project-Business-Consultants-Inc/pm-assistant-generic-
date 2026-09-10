-- T034: Automation Engine tables
-- automations: the rules
CREATE TABLE IF NOT EXISTS automations (
  id VARCHAR(36) PRIMARY KEY,
  project_id VARCHAR(36) NOT NULL,
  name VARCHAR(200) NOT NULL,
  description TEXT NULL,
  owner_user_id VARCHAR(36) NOT NULL,
  status VARCHAR(20) NOT NULL DEFAULT 'draft',
  version INT NOT NULL DEFAULT 1,
  trigger_event_type VARCHAR(100) NOT NULL,
  trigger_entity_type VARCHAR(50) NULL,
  definition TEXT NOT NULL,
  trigger_count INT NOT NULL DEFAULT 0,
  last_triggered_at DATETIME NULL,
  last_error TEXT NULL,
  max_runs_per_day INT NOT NULL DEFAULT 50,
  cooldown_seconds INT NOT NULL DEFAULT 0,
  enabled_at DATETIME NULL,
  disabled_at DATETIME NULL,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  INDEX idx_auto_project_status (project_id, status),
  INDEX idx_auto_trigger (trigger_event_type, status)
);

-- automation_executions: execution log
CREATE TABLE IF NOT EXISTS automation_executions (
  id VARCHAR(36) PRIMARY KEY,
  automation_id VARCHAR(36) NOT NULL,
  event_type VARCHAR(100) NOT NULL,
  event_payload TEXT NULL,
  status VARCHAR(20) NOT NULL DEFAULT 'running',
  actions_executed INT NOT NULL DEFAULT 0,
  actions_failed INT NOT NULL DEFAULT 0,
  result TEXT NULL,
  error_message TEXT NULL,
  duration_ms INT NULL,
  triggered_by VARCHAR(36) NULL,
  is_dry_run TINYINT(1) NOT NULL DEFAULT 0,
  recursion_depth INT NOT NULL DEFAULT 0,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  INDEX idx_exec_automation (automation_id, created_at DESC),
  INDEX idx_exec_status (status, created_at DESC)
);

-- automation_cooldowns: per-entity cooldown tracking
CREATE TABLE IF NOT EXISTS automation_cooldowns (
  id VARCHAR(36) PRIMARY KEY,
  automation_id VARCHAR(36) NOT NULL,
  cooldown_key VARCHAR(255) NOT NULL,
  last_fired_at DATETIME NOT NULL,
  fire_count_today INT NOT NULL DEFAULT 1,
  fire_date DATE NOT NULL,
  UNIQUE INDEX idx_cooldown_unique (automation_id, cooldown_key),
  INDEX idx_cooldown_date (fire_date)
);
