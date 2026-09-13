-- T040: Add project_code display identifier (e.g. PRJ-001)
ALTER TABLE projects
  ADD COLUMN project_code VARCHAR(20) NULL AFTER name;

-- Auto-populate existing projects with sequential codes
SET @row_num = 0;
UPDATE projects
SET project_code = CONCAT('PRJ-', LPAD((@row_num := @row_num + 1), 3, '0'))
WHERE project_code IS NULL
ORDER BY created_at ASC;

-- Make it unique and not null after population
ALTER TABLE projects
  MODIFY COLUMN project_code VARCHAR(20) NOT NULL,
  ADD UNIQUE INDEX idx_projects_code (project_code);
