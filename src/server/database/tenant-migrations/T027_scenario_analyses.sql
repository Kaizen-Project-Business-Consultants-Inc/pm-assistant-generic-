-- T027: Persist what-if scenario analyses for history and comparison
CREATE TABLE IF NOT EXISTS scenario_analyses (
  id VARCHAR(36) PRIMARY KEY,
  project_id VARCHAR(36) NOT NULL,
  user_id INT NOT NULL,
  scenario_text TEXT NOT NULL,
  parameters JSON DEFAULT NULL,
  result JSON NOT NULL,
  ai_powered TINYINT(1) NOT NULL DEFAULT 0,
  confidence DECIMAL(3,2) NOT NULL DEFAULT 0.30,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  INDEX idx_sa_project (project_id),
  INDEX idx_sa_user (user_id),
  INDEX idx_sa_created (created_at DESC)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
