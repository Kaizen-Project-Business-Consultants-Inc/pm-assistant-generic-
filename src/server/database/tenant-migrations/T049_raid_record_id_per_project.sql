-- RAID reference numbers (R-001, I-001, A-001, D-001 …) must be unique PER
-- PROJECT, not per tenant.
--
-- The original index was UNIQUE(record_id) across the whole tenant database, so
-- once the seeded demo project used R-001..R-003 no other project in that account
-- could create a risk — every attempt failed with a duplicate-key error. This
-- affected every customer, because every new tenant is seeded with that demo data.
--
-- Widening a unique constraint is safe: record_id was globally unique, so every
-- (project_id, record_id) pair is necessarily unique already.
ALTER TABLE project_risks DROP INDEX IF EXISTS idx_project_risks_record_id;
ALTER TABLE project_risks ADD UNIQUE KEY IF NOT EXISTS idx_project_risks_project_record (project_id, record_id);

-- Note: raid_sequence_counter is left in place but is no longer read. Numbering
-- is now derived per project from project_risks itself (RiskRepository
-- .nextSequenceId), so it cannot drift out of step with the real data again.
