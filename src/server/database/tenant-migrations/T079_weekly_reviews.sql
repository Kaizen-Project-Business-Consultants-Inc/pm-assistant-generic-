-- Weekly PM review (2026-10-04): every Friday (or on demand) Kovarti checks a project's plan,
-- people, hours, money and risks and lists at most 5 decisions for its PM, plus what's fine.
-- Playbook: docs/playbooks/weekly-pm-cycle.md.

-- One row per run; the latest row is what the PM sees.
CREATE TABLE IF NOT EXISTS weekly_reviews (
  id VARCHAR(36) NOT NULL PRIMARY KEY,
  project_id VARCHAR(36) NOT NULL,
  week_start DATE NOT NULL,
  as_of DATE NOT NULL,
  rag VARCHAR(10) NOT NULL,
  rag_reason VARCHAR(255) NULL,
  items JSON NULL,
  fine JSON NULL,
  uncertainty JSON NULL,
  more_found INT NOT NULL DEFAULT 0,
  quietened INT NOT NULL DEFAULT 0,
  `trigger` VARCHAR(20) NOT NULL DEFAULT 'manual',
  created_by VARCHAR(36) NULL,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  INDEX idx_weekly_reviews_project (project_id, created_at)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- What the PM did with each item: dismissed (with a reason) or applied. A dismissal keeps the
-- same problem quiet in later weeks unless it gets worse (measure grows).
CREATE TABLE IF NOT EXISTS weekly_review_responses (
  id VARCHAR(36) NOT NULL PRIMARY KEY,
  project_id VARCHAR(36) NOT NULL,
  review_id VARCHAR(36) NOT NULL,
  item_key VARCHAR(100) NOT NULL,
  response VARCHAR(20) NOT NULL,
  reason VARCHAR(30) NULL,
  measure DECIMAL(12,2) NOT NULL DEFAULT 0,
  created_by VARCHAR(36) NULL,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE KEY uq_weekly_review_response (review_id, item_key),
  INDEX idx_weekly_review_responses_key (project_id, item_key, created_at)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
