-- Project identity: a unique code always, and no two LIVE projects sharing a name.
--
-- Two active projects called "DBJ-Loans Management System" are indistinguishable in the
-- project picker, in search, in Slack messages and in status reports. The app has no way
-- to help someone tell them apart.
--
-- Archived names stay reusable on purpose. The normal recovery from a bad import is to
-- archive it and start again under the same name; blocking that puts friction on the
-- path someone takes when something has already gone wrong. And a yearly project should
-- be able to inherit its predecessor's name once that one is filed away.

-- 1. project_code is the permanent handle. It is already populated everywhere, but
--    nothing stopped two projects sharing one.
ALTER TABLE projects
  ADD UNIQUE KEY IF NOT EXISTS idx_projects_code_unique (project_code);

-- 2. Name unique among live projects only.
--
--    MariaDB has no partial indexes, so this uses the standard NULL trick: a generated
--    column that holds the name while the project is live and NULL once it is archived.
--    A unique index treats NULLs as distinct, so any number of archived projects may
--    share a name while only one live project can hold it.
ALTER TABLE projects
  ADD COLUMN IF NOT EXISTS live_name VARCHAR(255)
    GENERATED ALWAYS AS (CASE WHEN archived_at IS NULL THEN name ELSE NULL END) STORED;

ALTER TABLE projects
  ADD UNIQUE KEY IF NOT EXISTS idx_projects_live_name (live_name);
