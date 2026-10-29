-- T096: temporary cover for a project's Owner (2026-10-29). While the Owner is away (leave, sick),
-- one named person may change THIS project, between two dates. The rights are worked out from
-- these rows at request time (middleware/requireProjectAccess.ts): a row whose end_date has passed,
-- or that was ended early (ended_at), grants nothing, whether or not any job has run.
-- end_notified_at / start_notified_at only stop the daily job and the start email repeating.
CREATE TABLE IF NOT EXISTS project_cover (
  id CHAR(36) NOT NULL PRIMARY KEY,
  project_id CHAR(36) NOT NULL,
  owner_user_id CHAR(36) NOT NULL,
  cover_user_id CHAR(36) NOT NULL,
  cover_user_name VARCHAR(255) NOT NULL DEFAULT '',
  cover_user_email VARCHAR(255) NOT NULL DEFAULT '',
  start_date DATE NOT NULL,
  end_date DATE NOT NULL,
  started_by CHAR(36) NOT NULL,
  started_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  ended_at TIMESTAMP NULL DEFAULT NULL,
  ended_by CHAR(36) NULL DEFAULT NULL,
  start_notified_at TIMESTAMP NULL DEFAULT NULL,
  end_notified_at TIMESTAMP NULL DEFAULT NULL,
  INDEX idx_cover_project (project_id, end_date),
  INDEX idx_cover_user (cover_user_id, end_date),
  INDEX idx_cover_open (ended_at, end_date),
  CONSTRAINT fk_cover_project FOREIGN KEY (project_id) REFERENCES projects(id) ON DELETE CASCADE
);

-- Who gets a project's Manager alerts and reviews today: its Owners and Managers, plus whoever covers
-- for the Owner today (by the database's date: a notice may reach a cover up to a few hours early or
-- late at a day's edge; what they may CHANGE is decided in code, by the company's time zone).
CREATE OR REPLACE SQL SECURITY INVOKER VIEW project_managers_now AS
  SELECT project_id, user_id FROM project_members WHERE role IN ('owner', 'manager')
  UNION
  SELECT project_id, cover_user_id AS user_id FROM project_cover
   WHERE ended_at IS NULL AND start_date <= CURDATE() AND end_date >= CURDATE();
