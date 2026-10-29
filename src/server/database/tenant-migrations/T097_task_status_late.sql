-- T097: a task can be marked Late by hand (the app also shows Late by itself when an open task is past its planned finish).
-- Other values stay: In Review and Testing are no longer offered but existing tasks keep them.
ALTER TABLE tasks
  MODIFY COLUMN status ENUM('pending','in_progress','in_review','testing','late','completed','blocked','cancelled') NOT NULL DEFAULT 'pending';
