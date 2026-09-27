-- Schedule History: one row per GROUP change (link several tasks, bulk edit / status,
-- bulk create, Schedule Review fixes, AI Reschedule accepted), with what is needed to
-- undo it later — not just from the 4-second toast. Changes made by Claude through the
-- MCP server / API are recorded too (source = 'mcp'), so they can be seen and undone.
--
-- undo_payload holds the reverse operation (links added, previous field values, dates
-- before a re-flow, ids created, or the review-fix proposal id). task_ids lists the tasks
-- the change touched: Undo warns when any of them was edited after the change.
-- ref is an external id for kinds that already have their own undo (review-fix proposal),
-- so undoing from either place marks the other.
CREATE TABLE IF NOT EXISTS change_batches (
  id CHAR(36) NOT NULL PRIMARY KEY,
  project_id CHAR(36) NOT NULL,
  schedule_id CHAR(36) NOT NULL,
  kind VARCHAR(40) NOT NULL,
  summary VARCHAR(500) NOT NULL,
  actor_id CHAR(36) NULL,
  source VARCHAR(20) NOT NULL DEFAULT 'web',
  ref VARCHAR(64) NULL,
  task_ids JSON NULL,
  undo_payload JSON NULL,
  status VARCHAR(20) NOT NULL DEFAULT 'applied',
  undone_at TIMESTAMP NULL,
  undone_by CHAR(36) NULL,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  INDEX idx_change_batches_schedule (schedule_id, created_at),
  INDEX idx_change_batches_ref (kind, ref)
);
