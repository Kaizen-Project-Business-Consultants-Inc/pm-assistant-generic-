-- T043: Drop duplicate indexes in tenant DBs (mirrors 113 for control plane)

DROP INDEX IF EXISTS idx_lessons_project_id ON lessons_learned;
DROP INDEX IF EXISTS idx_meetings_project_id ON meeting_analyses;
-- portal_links: keep UNIQUE `token`, drop non-unique `idx_pl_token`
DROP INDEX IF EXISTS idx_pl_token ON portal_links;
DROP INDEX IF EXISTS idx_sprint_project ON sprints;
DROP INDEX IF EXISTS idx_task_deps_dependency_id ON task_dependencies;
