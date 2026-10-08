-- T084: indexes the 2026-10-08 efficiency check found missing (speed only — no data changes).
-- Each was confirmed with EXPLAIN on staging (full table read) or in the slow-query log.

-- workflow run history, newest first (WorkflowRepository list): took 7 s on staging (69,000 runs)
CREATE INDEX IF NOT EXISTS idx_wfe_started ON workflow_executions (started_at);
CREATE INDEX IF NOT EXISTS idx_wfe_workflow_started ON workflow_executions (workflow_id, started_at);

-- audit history: the admin list and summary go by date; a project's trail filtered by type
CREATE INDEX IF NOT EXISTS idx_audit_created ON audit_ledger (created_at);
CREATE INDEX IF NOT EXISTS idx_audit_project_entity ON audit_ledger (project_id, entity_type, created_at);

-- dashboard: issues trend (tasks created per week), resolved trend, milestones
CREATE INDEX IF NOT EXISTS idx_tasks_created_at ON tasks (created_at);
CREATE INDEX IF NOT EXISTS idx_tasks_status_updated ON tasks (status, updated_at);
CREATE INDEX IF NOT EXISTS idx_tasks_milestone_end ON tasks (is_milestone, end_date);

-- project by name (Slack commands): now an exact match on the case-insensitive column
CREATE INDEX IF NOT EXISTS idx_projects_name ON projects (name);

-- timesheet compliance and coaching jobs read a set of days for everyone
CREATE INDEX IF NOT EXISTS idx_time_date ON time_entries (date);

-- morning briefing: RAID changes since yesterday
CREATE INDEX IF NOT EXISTS idx_raid_activity_created ON raid_activity_log (created_at);

-- nightly clean-up of history tables reads by date (the job itself is enabled separately)
CREATE INDEX IF NOT EXISTS idx_agent_log_created ON agent_activity_log (created_at);
CREATE INDEX IF NOT EXISTS idx_automation_exec_created ON automation_executions (created_at);
CREATE INDEX IF NOT EXISTS idx_sync_log_started ON integration_sync_log (started_at);
