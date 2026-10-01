-- T065 (2026-10-01): Schedule History shows what each change did, before -> after
-- ("Build Sprint 1: start 12 Oct -> 19 Oct"). History is now a record; only the newest change
-- can be undone, and only until anything else changes. Older entries have no details (NULL).
ALTER TABLE change_batches ADD COLUMN IF NOT EXISTS details JSON NULL;
