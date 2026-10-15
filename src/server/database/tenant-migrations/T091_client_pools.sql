-- Client resource pools (user 2026-10-14, U8): each client has its own people, rate card and
-- holiday calendar; a consultant's own people sit in "My resources" (client_id NULL).
-- Nothing changes on the day this runs: every person starts in My resources, every existing
-- client gets a copy of today's rate card, and every client uses today's company holidays
-- (now the "home" calendar), so no task date or cost moves.

-- 1. People belong to a pool: a client, or My resources (NULL)
ALTER TABLE resources ADD COLUMN IF NOT EXISTS client_id VARCHAR(36) NULL DEFAULT NULL;
CREATE INDEX IF NOT EXISTS idx_resources_client ON resources (client_id);

-- 2. Rate cards per pool: '' = My resources (a key column can't be NULL in a unique key)
ALTER TABLE rate_card ADD COLUMN IF NOT EXISTS pool_id VARCHAR(36) NOT NULL DEFAULT '';
ALTER TABLE rate_card DROP INDEX IF EXISTS uk_rate_card_role_from;
CREATE UNIQUE INDEX IF NOT EXISTS uk_rate_card_pool_role_from ON rate_card (pool_id, role, effective_from);
INSERT IGNORE INTO rate_card (id, pool_id, role, hourly_rate, overtime_rate, effective_from, created_by)
  SELECT UUID(), g.id, r.role, r.hourly_rate, r.overtime_rate, r.effective_from, r.created_by
    FROM rate_card r CROSS JOIN project_groups g
   WHERE r.pool_id = '';

-- 3. Named holiday calendars; today's company holidays become the "home" calendar
CREATE TABLE IF NOT EXISTS holiday_calendars (
  id VARCHAR(36) NOT NULL PRIMARY KEY,
  name VARCHAR(120) NOT NULL,
  created_by VARCHAR(36) DEFAULT NULL,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE KEY uk_holiday_calendar_name (name)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
INSERT IGNORE INTO holiday_calendars (id, name) VALUES ('home', 'Company holidays');

ALTER TABLE company_holidays ADD COLUMN IF NOT EXISTS calendar_id VARCHAR(36) NOT NULL DEFAULT 'home';
ALTER TABLE company_holidays DROP INDEX IF EXISTS uk_company_holiday_date;
CREATE UNIQUE INDEX IF NOT EXISTS uk_company_holiday_cal_date ON company_holidays (calendar_id, holiday_date);

-- 4. Each client picks its calendar (NULL = the home calendar)
ALTER TABLE project_groups ADD COLUMN IF NOT EXISTS holiday_calendar_id VARCHAR(36) NULL DEFAULT NULL;

-- 5. A project's team: the people (from its client's pool or My resources) picked for it.
--    Someone on the team who can sign in is also a project member, so they see this project;
--    granted_view = the team gave them that membership (so leaving the team takes it away again,
--    but never a membership the PM gave them separately).
CREATE TABLE IF NOT EXISTS project_team (
  project_id VARCHAR(36) NOT NULL,
  resource_id VARCHAR(36) NOT NULL,
  role_on_project VARCHAR(100) DEFAULT NULL,
  added_by VARCHAR(36) DEFAULT NULL,
  granted_view TINYINT(1) NOT NULL DEFAULT 0,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (project_id, resource_id),
  INDEX idx_project_team_resource (resource_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
