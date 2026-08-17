-- Separate RAID updates (user narratives) from audit activity log
-- Updates are team communication; activity log remains a pure audit trail

CREATE TABLE IF NOT EXISTS raid_updates (
  id CHAR(36) PRIMARY KEY,
  raid_item_id CHAR(36) NOT NULL,
  project_id CHAR(36) NOT NULL,
  user_id CHAR(36) NOT NULL,
  text TEXT NOT NULL,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  INDEX idx_raid_updates_item (raid_item_id, created_at)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- Add new action types for update audit trail entries
ALTER TABLE raid_activity_log
  MODIFY COLUMN action_type ENUM('comment','status_change','field_update','created','cancelled','reversed','linked','update_added','update_deleted') NOT NULL;
