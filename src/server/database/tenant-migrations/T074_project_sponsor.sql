-- Project sponsor + PM-controlled RAID escalation (2026-10-03, agreed with the user).
-- A project names its sponsor: a person with a login (sponsor_user_id) or one without
-- (sponsor_resource_id, emailed). Nothing reaches the sponsor automatically: when a risk or
-- issue becomes Critical the PM is prompted, and only the PM escalates, with a note.
ALTER TABLE projects
  ADD COLUMN IF NOT EXISTS sponsor_user_id VARCHAR(36) NULL,
  ADD COLUMN IF NOT EXISTS sponsor_resource_id VARCHAR(36) NULL;

ALTER TABLE project_risks
  ADD COLUMN IF NOT EXISTS escalated_at DATETIME NULL,
  ADD COLUMN IF NOT EXISTS escalated_by VARCHAR(36) NULL,
  ADD COLUMN IF NOT EXISTS escalation_prompt_dismissed_at DATETIME NULL;
