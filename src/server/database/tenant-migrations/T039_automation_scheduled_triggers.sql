-- Automation Engine Phase 4: Scheduled Triggers
-- Adds schedule configuration, timezone, and next/last run tracking to automations

ALTER TABLE automations
  ADD COLUMN schedule_config JSON NULL AFTER definition,
  ADD COLUMN timezone VARCHAR(50) NULL DEFAULT 'UTC' AFTER schedule_config,
  ADD COLUMN next_run_at DATETIME NULL AFTER timezone,
  ADD COLUMN last_run_at DATETIME NULL AFTER next_run_at;

CREATE INDEX idx_auto_scheduled_due ON automations (status, next_run_at);
