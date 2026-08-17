-- Add 'imported' to project_risks source enum
ALTER TABLE project_risks
  MODIFY COLUMN source ENUM('manual','ai_detected','agent','imported') NOT NULL DEFAULT 'manual';
