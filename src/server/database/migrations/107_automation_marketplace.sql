-- 107: Automation marketplace (control plane, shared across tenants)
CREATE TABLE IF NOT EXISTS automation_marketplace (
  id VARCHAR(36) PRIMARY KEY,
  name VARCHAR(200) NOT NULL,
  description TEXT NULL,
  category VARCHAR(50) NULL,
  tags JSON NULL,
  trigger_event_type VARCHAR(100) NOT NULL,
  scope VARCHAR(20) NOT NULL DEFAULT 'project',
  definition TEXT NOT NULL,
  max_runs_per_day INT NOT NULL DEFAULT 50,
  cooldown_seconds INT NOT NULL DEFAULT 0,
  published_by_org_id VARCHAR(36) NOT NULL,
  published_by_org_name VARCHAR(200) NOT NULL,
  published_by_user_id VARCHAR(36) NOT NULL,
  download_count INT NOT NULL DEFAULT 0,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  INDEX idx_am_category (category),
  INDEX idx_am_downloads (download_count DESC)
);
