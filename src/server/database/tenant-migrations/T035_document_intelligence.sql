-- T035: Document Intelligence tables
-- project_documents: stores uploaded documents with AI-extracted metadata
-- document_entity_links: links documents to project entities (tasks, risks, etc.)

CREATE TABLE IF NOT EXISTS project_documents (
  id VARCHAR(36) PRIMARY KEY,
  project_id VARCHAR(36) NOT NULL,
  filename VARCHAR(255) NOT NULL,
  original_filename VARCHAR(255) NOT NULL,
  content_type VARCHAR(100) NOT NULL,
  file_size INT NOT NULL DEFAULT 0,
  extracted_text LONGTEXT,
  document_type ENUM('requirements','design','meeting_minutes','risk_log','issue_log','financial','governance','decision_log','contract','proposal','misc') NOT NULL DEFAULT 'misc',
  project_phase ENUM('initiation','planning','execution','monitoring','closure','unknown') NOT NULL DEFAULT 'unknown',
  tags JSON,
  ai_summary TEXT,
  ai_insights JSON,
  confidence DECIMAL(3,2) DEFAULT 0.00,
  processing_status ENUM('pending','processing','completed','failed') NOT NULL DEFAULT 'pending',
  error_message TEXT,
  uploaded_by VARCHAR(36) NOT NULL,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  INDEX idx_projdoc_project (project_id),
  INDEX idx_projdoc_type (document_type),
  INDEX idx_projdoc_status (processing_status)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS document_entity_links (
  id VARCHAR(36) PRIMARY KEY,
  document_id VARCHAR(36) NOT NULL,
  entity_type ENUM('task','risk','issue','milestone','decision') NOT NULL,
  entity_id VARCHAR(36) NOT NULL,
  link_reason TEXT,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  INDEX idx_doclink_document (document_id),
  INDEX idx_doclink_entity (entity_type, entity_id),
  CONSTRAINT fk_doclink_document FOREIGN KEY (document_id) REFERENCES project_documents(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
