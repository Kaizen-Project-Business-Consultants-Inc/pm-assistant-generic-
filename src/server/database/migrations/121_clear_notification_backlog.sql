-- One-off: mark the old unread backlog as read (nothing is deleted). Most of it was repeats
-- with no project or item named ("Record: R-001", 46 identical workflow lines). New
-- notifications name the project and item and don't repeat, so everyone starts clean.
UPDATE notifications SET is_read = TRUE WHERE is_read = FALSE AND created_at < '2026-09-29 00:00:00';
