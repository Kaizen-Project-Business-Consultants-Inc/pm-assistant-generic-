-- T036: Document findability enhancements
-- Adds description, folder, and pinned support to project_documents

ALTER TABLE project_documents
  ADD COLUMN description VARCHAR(500) NULL AFTER original_filename,
  ADD COLUMN folder VARCHAR(100) NULL AFTER tags,
  ADD COLUMN is_pinned TINYINT(1) NOT NULL DEFAULT 0 AFTER folder;

CREATE INDEX idx_projdoc_folder ON project_documents (project_id, folder);
CREATE INDEX idx_projdoc_pinned ON project_documents (project_id, is_pinned);
