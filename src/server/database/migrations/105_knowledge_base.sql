-- Migration 105: Knowledge Base for Mjuzi RAG
-- Adds 'knowledge_base' to embeddings document_type and creates chunk storage table

ALTER TABLE embeddings
  MODIFY COLUMN document_type ENUM('lesson','meeting','knowledge_base') NOT NULL;

CREATE TABLE IF NOT EXISTS knowledge_base_chunks (
  id VARCHAR(128) PRIMARY KEY,
  source_file VARCHAR(100) NOT NULL,
  section_path VARCHAR(500) NOT NULL,
  title VARCHAR(300) NOT NULL,
  content TEXT NOT NULL,
  content_hash VARCHAR(64) NOT NULL,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  INDEX idx_kb_source (source_file),
  INDEX idx_kb_hash (content_hash)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

INSERT INTO _migrations (name) VALUES ('105_knowledge_base');
