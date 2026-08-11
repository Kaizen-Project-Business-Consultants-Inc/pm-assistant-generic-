CREATE TABLE IF NOT EXISTS task_assignments (
  id VARCHAR(36) NOT NULL PRIMARY KEY,
  task_id VARCHAR(36) NOT NULL,
  resource_id VARCHAR(36) NOT NULL,
  allocation_pct TINYINT UNSIGNED NOT NULL DEFAULT 100,
  role_on_task VARCHAR(100) DEFAULT NULL,
  hours_planned DECIMAL(8,2) DEFAULT NULL,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE KEY uk_task_resource (task_id, resource_id),
  INDEX idx_ta_task (task_id),
  INDEX idx_ta_resource (resource_id),
  FOREIGN KEY (task_id) REFERENCES tasks(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
