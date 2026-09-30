-- AI learning tables in every company database (2026-09-29).
--
-- ai_feedback (accept / modify / reject of AI suggestions) and ai_accuracy_tracking
-- (predicted vs actual) hold one company's project data, and every read and write goes
-- through the tenant-routed query(). They were only ever created in the control-plane
-- database, so the AI Learning pages (accuracy report, feedback stats, insights) crashed
-- with "table doesn't exist" for every company, and feedback was never saved.
CREATE TABLE IF NOT EXISTS ai_feedback (
  id VARCHAR(36) NOT NULL PRIMARY KEY,
  user_id VARCHAR(36) NULL,
  project_id VARCHAR(36) NULL,
  feature VARCHAR(100) NOT NULL,
  suggestion_data JSON NULL,
  user_action ENUM('accepted','modified','rejected') NOT NULL,
  modified_data JSON NULL,
  feedback_text TEXT NULL,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  INDEX idx_af_user_id (user_id),
  INDEX idx_af_feature (feature),
  INDEX idx_af_user_action (user_action),
  INDEX idx_af_created_at (created_at)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS ai_accuracy_tracking (
  id VARCHAR(36) NOT NULL PRIMARY KEY,
  project_id VARCHAR(36) NULL,
  task_id VARCHAR(36) NULL,
  metric_type VARCHAR(100) NOT NULL,
  predicted_value DECIMAL(15,4) NOT NULL,
  actual_value DECIMAL(15,4) NOT NULL,
  variance_pct DECIMAL(8,2) NOT NULL DEFAULT 0.00,
  project_type VARCHAR(50) NULL,
  recorded_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  INDEX idx_aat_project_id (project_id),
  INDEX idx_aat_metric_type (metric_type),
  INDEX idx_aat_recorded_at (recorded_at),
  INDEX idx_aat_project_type (project_type)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
