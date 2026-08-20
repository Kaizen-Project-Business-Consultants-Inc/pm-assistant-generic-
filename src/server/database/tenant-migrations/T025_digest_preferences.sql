-- T025: Enhanced digest preferences — preferred send hour and section toggles
-- These columns are on the control plane `users` table, not tenant DB.
-- Run this against the CONTROL PLANE database (pmassist).

ALTER TABLE users ADD COLUMN IF NOT EXISTS digest_preferred_hour TINYINT NOT NULL DEFAULT 7;
ALTER TABLE users ADD COLUMN IF NOT EXISTS digest_sections JSON DEFAULT NULL;
-- digest_sections stores an array like: ["overdue","deadlines","action_items","meetings","sprint","changes","notifications"]
-- NULL means all sections enabled (default behavior).
