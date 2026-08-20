-- Add issues and dependencies JSON columns to meeting_analyses
-- These complement existing risks/actionItems/decisions for full RAID coverage

ALTER TABLE meeting_analyses
  ADD COLUMN issues MEDIUMTEXT NULL AFTER risks,
  ADD COLUMN dependencies MEDIUMTEXT NULL AFTER issues;
