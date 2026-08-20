-- 099: Template marketplace — shared templates across organizations
-- This table lives in the CONTROL PLANE database (pmassist).

CREATE TABLE IF NOT EXISTS template_marketplace (
  id VARCHAR(36) NOT NULL PRIMARY KEY,
  name VARCHAR(255) NOT NULL,
  description TEXT,
  category VARCHAR(100),
  tags JSON DEFAULT NULL,
  task_count INT NOT NULL DEFAULT 0,
  estimated_days INT NOT NULL DEFAULT 0,
  template_data JSON NOT NULL,
  published_by_org_id VARCHAR(36) NOT NULL,
  published_by_org_name VARCHAR(255) NOT NULL,
  published_by_user_id VARCHAR(36) NOT NULL,
  download_count INT NOT NULL DEFAULT 0,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  INDEX idx_tmp_mkt_category (category),
  INDEX idx_tmp_mkt_downloads (download_count DESC)
);
