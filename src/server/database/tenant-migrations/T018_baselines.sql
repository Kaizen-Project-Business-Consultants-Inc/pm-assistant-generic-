-- T018: Persist baseline snapshots to database (previously in-memory only)

CREATE TABLE IF NOT EXISTS schedule_baselines (
  id VARCHAR(36) PRIMARY KEY,
  schedule_id VARCHAR(36) NOT NULL,
  name VARCHAR(255) NOT NULL,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  created_by VARCHAR(36) NOT NULL,
  FOREIGN KEY (schedule_id) REFERENCES schedules(id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS baseline_tasks (
  id VARCHAR(36) PRIMARY KEY,
  baseline_id VARCHAR(36) NOT NULL,
  task_id VARCHAR(36) NOT NULL,
  name VARCHAR(500) NOT NULL,
  start_date DATE DEFAULT NULL,
  end_date DATE DEFAULT NULL,
  estimated_days DECIMAL(10,2) DEFAULT NULL,
  progress_percentage DECIMAL(5,2) DEFAULT 0,
  status VARCHAR(50) DEFAULT 'pending',
  FOREIGN KEY (baseline_id) REFERENCES schedule_baselines(id) ON DELETE CASCADE
);
