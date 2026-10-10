-- T089: lessons record WHO properly (2026-10-10). A person's id is text (a UUID), but
-- lessons_learned.created_by (T026) and lesson_feedback.user_id (T031) were numbers, and the code
-- turned the id into its leading digits: "3c75…" saved as 3, "a1b2…" as nothing (the feedback
-- save failed). So everyone whose id starts with the same digits shared one "helpful/outdated"
-- vote per lesson, and "created by" never named anyone.
-- The old values name no one: created_by is cleared; old feedback rows are kept (the counts
-- stay) under their old value, which matches no person, so the next vote is that person's own.
ALTER TABLE lessons_learned MODIFY COLUMN created_by VARCHAR(36) DEFAULT NULL;
-- only the old numbers (safe to run again: real ids written since are text, not digits only)
UPDATE lessons_learned SET created_by = NULL WHERE created_by REGEXP '^[0-9]+$';
ALTER TABLE lesson_feedback MODIFY COLUMN user_id VARCHAR(36) NOT NULL;
