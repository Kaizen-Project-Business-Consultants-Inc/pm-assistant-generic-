-- T045: Google Calendar sync mappings
CREATE TABLE IF NOT EXISTS calendar_sync_mappings (
  id VARCHAR(36) PRIMARY KEY,
  user_id VARCHAR(36) NOT NULL,
  integration_id VARCHAR(36) NOT NULL,
  task_id VARCHAR(36),
  calendar_event_id VARCHAR(255) NOT NULL,
  calendar_id VARCHAR(255) DEFAULT 'primary',
  sync_direction ENUM('push','pull','both') DEFAULT 'both',
  last_synced_at TIMESTAMP NULL,
  etag VARCHAR(255),
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  KEY idx_cal_sync_user (user_id),
  KEY idx_cal_sync_task (task_id),
  UNIQUE KEY uq_cal_event (integration_id, calendar_event_id)
);
