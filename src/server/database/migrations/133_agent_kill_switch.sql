-- 133: the AI agents' emergency stop is kept in the shared database (2026-10-10). It lived in the
-- web app's memory, so the nightly agent run (a separate process) never saw it, and it reset to
-- "on" whenever the app restarted. One row per switch: the global one, an agent, or a project.
CREATE TABLE IF NOT EXISTS agent_kill_switch (
  scope ENUM('global', 'agent', 'project') NOT NULL,
  target_id VARCHAR(100) NOT NULL,
  disabled TINYINT(1) NOT NULL DEFAULT 1,
  updated_by VARCHAR(36) DEFAULT NULL,
  updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (scope, target_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
