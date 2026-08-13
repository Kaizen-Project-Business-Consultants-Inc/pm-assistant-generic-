-- T017: Resource Enhancements (#4 Groups, #9 User linkage, #8 Calendar Templates)

-- #4: Resource Groups
ALTER TABLE resources ADD COLUMN resource_group VARCHAR(100) DEFAULT NULL;
CREATE INDEX idx_resources_group ON resources(resource_group);

-- #9: User linkage for timesheet integration
ALTER TABLE resources ADD COLUMN user_id CHAR(36) DEFAULT NULL;
CREATE INDEX idx_resources_user_id ON resources(user_id);

-- #8: Calendar Templates
CREATE TABLE IF NOT EXISTS resource_calendar_templates (
  id CHAR(36) NOT NULL PRIMARY KEY,
  name VARCHAR(100) NOT NULL,
  working_days JSON NOT NULL,
  hours_per_day DECIMAL(4,1) NOT NULL DEFAULT 8.0,
  is_default TINYINT(1) NOT NULL DEFAULT 0,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

INSERT INTO resource_calendar_templates (id, name, working_days, hours_per_day, is_default)
VALUES (UUID(), 'Standard (5x8)', '["mon","tue","wed","thu","fri"]', 8.0, 1);

ALTER TABLE resources ADD COLUMN calendar_template_id CHAR(36) DEFAULT NULL;
