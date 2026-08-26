-- Feedback enhancements: admin reply (visible to user), screenshot attachment
ALTER TABLE feedback
  ADD COLUMN admin_reply TEXT DEFAULT NULL AFTER admin_notes,
  ADD COLUMN admin_reply_at DATETIME DEFAULT NULL AFTER admin_reply,
  ADD COLUMN admin_reply_by INT DEFAULT NULL AFTER admin_reply_at,
  ADD COLUMN screenshot_data MEDIUMTEXT DEFAULT NULL AFTER comment;
