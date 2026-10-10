-- 134: every embedding says whose it is (2026-10-09 audit M5).
-- The shared `embeddings` table held every company's lesson, meeting and document vectors with no
-- owner, so search ranked all companies together (other companies' ids and scores came back, and a
-- company's own results were crowded out of the top K). org_id '' = shared by everyone (the Mjuzi
-- knowledge base, and every row on a single-company install); otherwise the company's id.
ALTER TABLE embeddings ADD COLUMN IF NOT EXISTS org_id VARCHAR(36) NOT NULL DEFAULT '' AFTER id;

-- Company rows written before today can't be told apart by company. They are derived data (the
-- lesson / meeting text itself is untouched in each company's database): remove them, and each is
-- embedded again, under its company, the next time it is saved or by scripts/backfillEmbeddings.
-- Only on a multi-company server (one with provisioned company databases): on a single-company
-- install every row already belongs to the one company, which is owner '' — they stay.
-- (Prod had 0 such rows on 2026-10-10, only 849 knowledge-base rows; staging had 4 meeting rows.)
DELETE FROM embeddings
 WHERE document_type <> 'knowledge_base'
   AND EXISTS (SELECT 1 FROM organizations WHERE is_provisioned = 1 AND db_name IS NOT NULL);

-- One row per owner + document (was per document, so the same id in two companies collided)
ALTER TABLE embeddings DROP INDEX IF EXISTS idx_emb_document;
ALTER TABLE embeddings ADD UNIQUE INDEX IF NOT EXISTS idx_emb_owner_document (org_id, document_type, document_id);
