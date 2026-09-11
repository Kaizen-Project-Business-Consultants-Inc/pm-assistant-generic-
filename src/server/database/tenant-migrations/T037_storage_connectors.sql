-- T037: Storage connectors for BYOS (Bring Your Own Storage)
-- Connects external cloud storage (OneDrive, SharePoint, Google Drive, Dropbox)
-- to projects for automatic document sync and AI processing.

CREATE TABLE IF NOT EXISTS storage_connectors (
  id VARCHAR(36) PRIMARY KEY,
  project_id VARCHAR(36) NOT NULL,
  provider ENUM('onedrive','sharepoint','google_drive','dropbox') NOT NULL,
  display_name VARCHAR(100) NOT NULL,
  access_token_enc TEXT,
  refresh_token_enc TEXT,
  token_expires_at TIMESTAMP NULL,
  config JSON,
  status ENUM('active','paused','error','disconnected') NOT NULL DEFAULT 'active',
  error_message TEXT,
  last_sync_at TIMESTAMP NULL,
  delta_token TEXT,
  sync_interval_minutes INT NOT NULL DEFAULT 60,
  created_by VARCHAR(36) NOT NULL,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  INDEX idx_sc_project (project_id),
  INDEX idx_sc_status (status)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

ALTER TABLE project_documents
  ADD COLUMN connector_id VARCHAR(36) NULL,
  ADD COLUMN external_id VARCHAR(500) NULL,
  ADD COLUMN external_path VARCHAR(1000) NULL,
  ADD COLUMN external_modified_at TIMESTAMP NULL,
  ADD COLUMN external_etag VARCHAR(255) NULL;

CREATE INDEX idx_pd_connector ON project_documents (connector_id);
CREATE INDEX idx_pd_external ON project_documents (connector_id, external_id);
