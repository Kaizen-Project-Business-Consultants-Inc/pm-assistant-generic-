-- Migration 139: project documents can be indexed for search (RAG-2, 2026-10-19)
-- The code has embedded uploaded documents as document_type 'project_document' since document
-- intelligence was built, but the column's ENUM never had that value, so every insert failed and
-- document search could never find anything. Lessons, meetings and the knowledge base unchanged.

ALTER TABLE embeddings
  MODIFY document_type ENUM('lesson', 'meeting', 'knowledge_base', 'project_document') NOT NULL;
