-- T068 (2026-10-01): columns added to the SHARED database by 101 and 108 but never to the
-- company databases, where these tables actually live. Found when a Meeting Intelligence
-- analysis failed to save ("Unknown column 'issues'"): on prod no company had them, so every
-- analysis since 2026-08-20 failed. Guard: tenantColumnsGuard.test.ts.

-- 101_meeting_analysis_raid.sql
ALTER TABLE meeting_analyses ADD COLUMN IF NOT EXISTS issues MEDIUMTEXT NULL;
ALTER TABLE meeting_analyses ADD COLUMN IF NOT EXISTS dependencies MEDIUMTEXT NULL;

-- 108_context_engineering.sql (versioned AI memory; feature is switched off today)
ALTER TABLE agent_memory ADD COLUMN IF NOT EXISTS version INT NOT NULL DEFAULT 1;
ALTER TABLE agent_memory ADD COLUMN IF NOT EXISTS version_hash CHAR(64) NULL;
ALTER TABLE agent_memory ADD COLUMN IF NOT EXISTS created_by VARCHAR(36) NULL;
ALTER TABLE agent_memory ADD COLUMN IF NOT EXISTS source VARCHAR(50) NULL;
ALTER TABLE agent_memory ADD COLUMN IF NOT EXISTS permission_scope ENUM('org','project','user') NULL;
ALTER TABLE agent_memory ADD COLUMN IF NOT EXISTS is_approved TINYINT(1) NOT NULL DEFAULT 1;
