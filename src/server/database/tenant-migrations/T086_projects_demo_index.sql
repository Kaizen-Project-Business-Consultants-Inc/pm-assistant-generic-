-- T086: the "projects I can read" lookup is now three indexed lookups (created by me / I'm a
-- member / the sample project). created_by and project_members.user_id already have indexes; this
-- adds the sample flag's, so no part of it reads the whole projects table (2026-10-08).
CREATE INDEX IF NOT EXISTS idx_projects_demo ON projects (is_demo);
