-- Migration 140: an admin's reply to feedback can be saved (found with U73, 2026-10-21)
-- 106 made feedback.admin_reply_by an INT, but user ids are UUID strings, so saving a reply failed
-- with "Data truncated for column 'admin_reply_by'". Same width as every other user id column.

ALTER TABLE feedback
  MODIFY admin_reply_by VARCHAR(36) DEFAULT NULL;
