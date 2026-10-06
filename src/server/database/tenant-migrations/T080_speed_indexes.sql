-- T080: indexes the 2026-10-04 audit found missing (speed only — no data changes)
-- time entries are summed per plan (TimeEntryRepository: WHERE schedule_id = ?) with no index
CREATE INDEX IF NOT EXISTS idx_time_schedule ON time_entries (schedule_id);
-- the notification list is "my newest first" (WHERE user_id = ? ORDER BY created_at DESC)
CREATE INDEX IF NOT EXISTS idx_notif_user_created ON notifications (user_id, created_at);
-- date-window reads (workload, look-ahead) filter on start_date; end_date already has one
CREATE INDEX IF NOT EXISTS idx_tasks_start_date ON tasks (start_date);
