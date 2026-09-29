-- Migration 080 (overtime rates) only ever ran on the control-plane database; company databases
-- created since never got these columns. The per-project Workload Heatmap reads
-- time_entries.rate_type for anyone linked to a user, so it failed ("Unknown column 'rate_type'")
-- as soon as the heatmap started counting real assignments (Sep 2026). Idempotent.
ALTER TABLE time_entries ADD COLUMN IF NOT EXISTS rate_type ENUM('standard','overtime') DEFAULT 'standard';
ALTER TABLE resources ADD COLUMN IF NOT EXISTS overtime_rate_hourly DECIMAL(10,2) DEFAULT NULL;
