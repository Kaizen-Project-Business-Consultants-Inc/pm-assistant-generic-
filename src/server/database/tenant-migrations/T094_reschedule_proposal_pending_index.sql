-- U59 (2026-10-20): the reschedule agent now looks for the newest pending proposal of its own
-- source before saving a new one. Schedules hit by the old one-proposal-per-late-task workflow
-- can hold many pending rows; this index finds the newest without reading them all.
CREATE INDEX IF NOT EXISTS idx_proposal_schedule_pending ON reschedule_proposals (schedule_id, status, source, created_at);
