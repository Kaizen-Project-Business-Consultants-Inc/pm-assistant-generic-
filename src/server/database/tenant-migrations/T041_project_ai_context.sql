-- T041: Project-level AI context configuration (tenant-scoped)

CREATE TABLE IF NOT EXISTS project_ai_context (
  id VARCHAR(36) PRIMARY KEY,
  project_id VARCHAR(36) NOT NULL,
  config_key VARCHAR(100) NOT NULL,
  config_value JSON NOT NULL,
  version INT NOT NULL DEFAULT 1,
  version_hash CHAR(64) NOT NULL,
  is_locked TINYINT(1) NOT NULL DEFAULT 0,
  locked_by VARCHAR(36) NULL,
  created_by VARCHAR(36) NOT NULL,
  updated_by VARCHAR(36) NOT NULL,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  UNIQUE INDEX idx_pac_project_key (project_id, config_key),
  INDEX idx_pac_project (project_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
