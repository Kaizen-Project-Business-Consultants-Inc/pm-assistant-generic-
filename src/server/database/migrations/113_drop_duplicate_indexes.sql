-- 113: Drop duplicate indexes found during slow query audit (Sep 15, 2026)
-- Each pair covers the same column(s); keep the shorter/clearer name.

-- Control plane (pmassist)
DROP INDEX IF EXISTS idx_api_key_usage_created ON api_key_usage_log;
DROP INDEX IF EXISTS idx_embeddings_document ON embeddings;
DROP INDEX IF EXISTS idx_invite_token ON invite_tokens;
DROP INDEX IF EXISTS idx_lessons_project_id ON lessons_learned;
DROP INDEX IF EXISTS idx_meetings_project_id ON meeting_analyses;
DROP INDEX IF EXISTS idx_org_slug ON organizations;
DROP INDEX IF EXISTS idx_pl_token ON portal_links;
DROP INDEX IF EXISTS idx_sprint_project ON sprints;
DROP INDEX IF EXISTS idx_task_deps_dependency_id ON task_dependencies;
-- users: keep the UNIQUE constraints (email, username), drop the non-unique duplicates
DROP INDEX IF EXISTS idx_users_email ON users;
DROP INDEX IF EXISTS idx_users_username ON users;
DROP INDEX IF EXISTS idx_deliveries_created ON webhook_deliveries;
