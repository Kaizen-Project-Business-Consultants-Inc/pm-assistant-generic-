-- T020: Scrum enhancements — task types, epics, acceptance criteria, expanded statuses
-- Applied per tenant DB

-- Task types + epic grouping + acceptance criteria
ALTER TABLE tasks
  ADD COLUMN task_type ENUM('task','story','bug','epic') NOT NULL DEFAULT 'task' AFTER priority,
  ADD COLUMN epic_id VARCHAR(36) DEFAULT NULL AFTER parent_task_id,
  ADD COLUMN acceptance_criteria TEXT DEFAULT NULL AFTER description,
  ADD INDEX idx_tasks_task_type (task_type),
  ADD INDEX idx_tasks_epic_id (epic_id);

-- Expand status enum: add in_review, testing, blocked
ALTER TABLE tasks
  MODIFY COLUMN status ENUM('pending','in_progress','in_review','testing','completed','blocked','cancelled') NOT NULL DEFAULT 'pending';
