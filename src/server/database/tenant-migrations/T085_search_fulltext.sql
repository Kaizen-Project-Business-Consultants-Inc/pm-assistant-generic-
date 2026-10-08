-- T085: word indexes (FULLTEXT) for the global search — speed only, no data changes.
-- Search used LIKE '%word%', which reads every row of every searched table. Each index below
-- covers exactly the columns routes/core/search.ts matches, in the same order (MATCH needs an
-- index on that exact column list). Server settings checked on staging 2026-10-08 (MariaDB 11.8):
-- innodb_ft_min_token_size = 3, innodb_ft_enable_stopword = ON (built-in list). The first word
-- index on a table rebuilds it once (adds the hidden FTS_DOC_ID column) — all are small tables.

ALTER TABLE projects ADD FULLTEXT INDEX IF NOT EXISTS ft_projects_search (name, description);
ALTER TABLE tasks ADD FULLTEXT INDEX IF NOT EXISTS ft_tasks_search (name, description);
ALTER TABLE goals ADD FULLTEXT INDEX IF NOT EXISTS ft_goals_search (name, description);
ALTER TABLE lessons_learned ADD FULLTEXT INDEX IF NOT EXISTS ft_lessons_learned_search (title, description);
ALTER TABLE resources ADD FULLTEXT INDEX IF NOT EXISTS ft_resources_search (name, role, email);
ALTER TABLE change_requests ADD FULLTEXT INDEX IF NOT EXISTS ft_change_requests_search (title, description);
ALTER TABLE project_risks ADD FULLTEXT INDEX IF NOT EXISTS ft_project_risks_search (title, description);
ALTER TABLE sprints ADD FULLTEXT INDEX IF NOT EXISTS ft_sprints_search (name, goal);
ALTER TABLE task_comments ADD FULLTEXT INDEX IF NOT EXISTS ft_task_comments_search (`text`);
