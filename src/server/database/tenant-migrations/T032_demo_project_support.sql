-- T032_demo_project_support.sql
-- Add is_demo flag to projects table for read-only sample/demo projects.

ALTER TABLE projects ADD COLUMN is_demo BOOLEAN NOT NULL DEFAULT FALSE AFTER group_id;
