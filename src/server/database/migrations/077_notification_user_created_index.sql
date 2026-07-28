-- Composite index to eliminate filesort on the most common notification query:
-- SELECT * FROM notifications WHERE user_id = ? ORDER BY created_at DESC LIMIT 50
-- Previously hitting 1.5s+ on 6K rows due to filesort after index scan on user_id alone.

CREATE INDEX IF NOT EXISTS idx_notif_user_created
  ON notifications (user_id, created_at DESC);
