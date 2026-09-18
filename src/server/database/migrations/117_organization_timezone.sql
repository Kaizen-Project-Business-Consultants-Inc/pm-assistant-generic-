-- The organisation's time zone: the one agreed answer to "what day is it".
--
-- Used only for shared judgments — whether a project is late, which period a figure
-- falls in — when a project has no explicit status date (see tenant migration T050).
-- Two people in different countries must not disagree about whether a project slipped,
-- so this deliberately is NOT the viewer's own zone.
--
-- A person's own zone (users.timezone) is still what decides when their emails arrive.
-- Calendar dates use neither: a date is the same day everywhere.
ALTER TABLE organizations
  ADD COLUMN IF NOT EXISTS timezone VARCHAR(50) NOT NULL DEFAULT 'UTC' AFTER name;
