-- T022: Project Groups (Folders/Spaces)
-- Flat grouping — no nesting. Projects can belong to zero or one group.

CREATE TABLE IF NOT EXISTS project_groups (
  id VARCHAR(36) NOT NULL PRIMARY KEY,
  name VARCHAR(255) NOT NULL,
  color VARCHAR(7) DEFAULT '#6366f1',
  icon VARCHAR(50) DEFAULT NULL,
  sort_order INT NOT NULL DEFAULT 0,
  created_by VARCHAR(36) NOT NULL,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  INDEX idx_pg_sort (sort_order)
);

-- Add group_id to projects table
SET @col_exists = (SELECT COUNT(*) FROM information_schema.COLUMNS
  WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'projects' AND COLUMN_NAME = 'group_id');
SET @sql = IF(@col_exists = 0,
  'ALTER TABLE projects ADD COLUMN group_id VARCHAR(36) DEFAULT NULL, ADD INDEX idx_projects_group (group_id)',
  'SELECT 1');
PREPARE stmt FROM @sql;
EXECUTE stmt;
DEALLOCATE PREPARE stmt;
