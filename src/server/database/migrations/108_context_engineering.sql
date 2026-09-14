-- 108: Context engineering — hierarchical config, versioned memory, dreaming, skill registry

-- Hierarchical AI context configuration (org -> project -> user layering)
CREATE TABLE IF NOT EXISTS ai_context_configs (
  id VARCHAR(36) PRIMARY KEY,
  scope ENUM('org','project','user') NOT NULL,
  scope_id VARCHAR(36) NOT NULL,
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
  UNIQUE INDEX idx_acc_scope_key (scope, scope_id, config_key),
  INDEX idx_acc_scope_id (scope_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- Version history for context configs
CREATE TABLE IF NOT EXISTS ai_context_config_history (
  id VARCHAR(36) PRIMARY KEY,
  config_id VARCHAR(36) NOT NULL,
  version INT NOT NULL,
  config_value JSON NOT NULL,
  version_hash CHAR(64) NOT NULL,
  changed_by VARCHAR(36) NOT NULL,
  change_type ENUM('create','update','lock','unlock') NOT NULL,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  INDEX idx_acch_config (config_id, version DESC),
  FOREIGN KEY (config_id) REFERENCES ai_context_configs(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- Audit trail for memory mutations
CREATE TABLE IF NOT EXISTS memory_change_log (
  id VARCHAR(36) PRIMARY KEY,
  memory_id VARCHAR(36) NOT NULL,
  action ENUM('create','update','delete','rollback') NOT NULL,
  old_value JSON NULL,
  new_value JSON NULL,
  old_version_hash CHAR(64) NULL,
  new_version_hash CHAR(64) NULL,
  changed_by VARCHAR(36) NOT NULL,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  INDEX idx_mcl_memory (memory_id, created_at DESC),
  INDEX idx_mcl_user (changed_by)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- Dreaming batch run tracking
CREATE TABLE IF NOT EXISTS dreaming_runs (
  id VARCHAR(36) PRIMARY KEY,
  status ENUM('pending','running','completed','failed') NOT NULL DEFAULT 'pending',
  started_at DATETIME NULL,
  completed_at DATETIME NULL,
  conversations_analyzed INT NOT NULL DEFAULT 0,
  proposals_created INT NOT NULL DEFAULT 0,
  auto_applied INT NOT NULL DEFAULT 0,
  error_message TEXT NULL,
  triggered_by VARCHAR(36) NULL,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  INDEX idx_dr_status (status, created_at DESC)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- Dreaming proposed memory changes
CREATE TABLE IF NOT EXISTS dreaming_proposals (
  id VARCHAR(36) PRIMARY KEY,
  run_id VARCHAR(36) NOT NULL,
  proposal_type ENUM('create_memory','update_memory','create_correction','create_preference') NOT NULL,
  target_agent_id VARCHAR(100) NOT NULL DEFAULT 'mjuzi-chat',
  target_memory_type VARCHAR(20) NOT NULL DEFAULT 'role',
  target_entity_id VARCHAR(36) NULL,
  proposed_key VARCHAR(255) NOT NULL,
  proposed_value JSON NOT NULL,
  evidence JSON NOT NULL,
  confidence DECIMAL(3,2) NOT NULL,
  status ENUM('pending','approved','rejected','auto_applied') NOT NULL DEFAULT 'pending',
  reviewed_by VARCHAR(36) NULL,
  reviewed_at DATETIME NULL,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  INDEX idx_dp_run (run_id),
  INDEX idx_dp_status (status, created_at DESC),
  FOREIGN KEY (run_id) REFERENCES dreaming_runs(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- Skill catalog with front-matter summaries + detailed procedures
CREATE TABLE IF NOT EXISTS agent_skills (
  id VARCHAR(36) PRIMARY KEY,
  skill_name VARCHAR(100) NOT NULL UNIQUE,
  category VARCHAR(50) NOT NULL DEFAULT 'general',
  summary TEXT NOT NULL,
  detailed_procedure TEXT NULL,
  applicable_roles JSON NULL,
  is_active TINYINT(1) NOT NULL DEFAULT 1,
  created_by VARCHAR(36) NOT NULL,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  INDEX idx_as_category (category, is_active),
  INDEX idx_as_active (is_active)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- Add versioning + permission columns to agent_memory
ALTER TABLE agent_memory
  ADD COLUMN version INT NOT NULL DEFAULT 1 AFTER value,
  ADD COLUMN version_hash CHAR(64) NULL AFTER version,
  ADD COLUMN created_by VARCHAR(36) NULL AFTER version_hash,
  ADD COLUMN source VARCHAR(50) NULL AFTER created_by,
  ADD COLUMN permission_scope ENUM('org','project','user') NULL AFTER source,
  ADD COLUMN is_approved TINYINT(1) NOT NULL DEFAULT 1 AFTER permission_scope;
