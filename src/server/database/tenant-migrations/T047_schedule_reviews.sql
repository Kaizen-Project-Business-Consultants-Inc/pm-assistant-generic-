-- T047: Schedule Review runs — one row per review with score, counts and findings
CREATE TABLE IF NOT EXISTS schedule_reviews (
  id VARCHAR(36) PRIMARY KEY,
  schedule_id VARCHAR(36) NOT NULL,
  project_id VARCHAR(36) NOT NULL,
  score TINYINT UNSIGNED NOT NULL,
  band VARCHAR(20) NOT NULL,
  critical_count SMALLINT UNSIGNED NOT NULL DEFAULT 0,
  high_count SMALLINT UNSIGNED NOT NULL DEFAULT 0,
  medium_count SMALLINT UNSIGNED NOT NULL DEFAULT 0,
  low_count SMALLINT UNSIGNED NOT NULL DEFAULT 0,
  info_count SMALLINT UNSIGNED NOT NULL DEFAULT 0,
  leaf_task_count SMALLINT UNSIGNED NOT NULL DEFAULT 0,
  findings JSON NOT NULL,
  skipped_rules JSON NULL,
  trigger_source VARCHAR(20) NOT NULL,
  proposal_id VARCHAR(36) NULL,
  rules_version VARCHAR(10) NOT NULL,
  created_by VARCHAR(36) NULL,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  KEY idx_sr_schedule_created (schedule_id, created_at),
  KEY idx_sr_project (project_id),
  FOREIGN KEY (schedule_id) REFERENCES schedules(id) ON DELETE CASCADE
);
