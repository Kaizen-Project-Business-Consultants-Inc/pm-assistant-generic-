-- T046: Guest collaborator project-level permissions
CREATE TABLE IF NOT EXISTS guest_project_permissions (
  id VARCHAR(36) PRIMARY KEY,
  user_id VARCHAR(36) NOT NULL,
  project_id VARCHAR(36) NOT NULL,
  can_comment TINYINT(1) DEFAULT 1,
  can_update_assigned TINYINT(1) DEFAULT 1,
  can_view_budget TINYINT(1) DEFAULT 0,
  can_view_risks TINYINT(1) DEFAULT 0,
  can_upload_files TINYINT(1) DEFAULT 0,
  invited_by VARCHAR(36) NOT NULL,
  expires_at TIMESTAMP NULL,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  UNIQUE KEY uq_guest_project (user_id, project_id),
  KEY idx_guest_user (user_id)
);
