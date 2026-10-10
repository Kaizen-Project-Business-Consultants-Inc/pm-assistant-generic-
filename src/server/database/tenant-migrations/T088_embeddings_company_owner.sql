-- T088: the company copy of `embeddings` gets the same owner column as the shared one (134,
-- 2026-10-10 audit M5). Search uses the shared table today; the company copy (unused since T001)
-- keeps the same shape so a later move into each company's database needs no schema change.
-- Column only: the company copy holds no rows to clean up.
ALTER TABLE embeddings ADD COLUMN IF NOT EXISTS org_id VARCHAR(36) NOT NULL DEFAULT '' AFTER id;
