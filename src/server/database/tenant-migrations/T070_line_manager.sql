-- Line manager (2026-10-02): every person on the Resources list has one — the user who approves
-- their weekly timesheet. Any user with a login can be a line manager, a PM included. Generic
-- roles have none. People who had none get the company owner, marked line_manager_default = 1
-- ("Set by default — check") until someone confirms or changes it; that backfill needs the
-- owner from the shared database, so it runs in code (tenantMigrationRunner, after migrations).
ALTER TABLE resources ADD COLUMN IF NOT EXISTS line_manager_user_id CHAR(36) NULL;
ALTER TABLE resources ADD COLUMN IF NOT EXISTS line_manager_default TINYINT(1) NOT NULL DEFAULT 0;
CREATE INDEX IF NOT EXISTS idx_resources_line_manager ON resources (line_manager_user_id);
