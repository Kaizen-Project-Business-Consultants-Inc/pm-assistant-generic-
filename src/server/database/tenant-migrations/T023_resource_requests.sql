-- T023: Resource Request/Approval Workflow
-- Allows PMs to request resources for projects with an approval workflow.

CREATE TABLE IF NOT EXISTS resource_requests (
  id VARCHAR(36) NOT NULL PRIMARY KEY,
  project_id VARCHAR(36) NOT NULL,
  requested_by VARCHAR(36) NOT NULL,
  resource_role VARCHAR(100) NOT NULL,
  resource_group VARCHAR(100) DEFAULT NULL,
  hours_needed DECIMAL(10,2) NOT NULL,
  start_date DATE NOT NULL,
  end_date DATE NOT NULL,
  justification TEXT DEFAULT NULL,
  skills_required JSON DEFAULT NULL,
  priority ENUM('low','medium','high','urgent') NOT NULL DEFAULT 'medium',
  status ENUM('draft','pending','approved','rejected','fulfilled','cancelled') NOT NULL DEFAULT 'draft',
  approved_by VARCHAR(36) DEFAULT NULL,
  approved_at TIMESTAMP NULL DEFAULT NULL,
  fulfilled_resource_id VARCHAR(36) DEFAULT NULL,
  reviewer_comment TEXT DEFAULT NULL,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  INDEX idx_rr_project (project_id),
  INDEX idx_rr_status (status),
  INDEX idx_rr_requested_by (requested_by)
);
