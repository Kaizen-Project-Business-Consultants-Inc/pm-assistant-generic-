-- Add 'meeting' to project_risks source enum for items imported from meeting analyses
ALTER TABLE project_risks
  MODIFY COLUMN source ENUM('manual','ai_detected','agent','imported','standup','meeting') NOT NULL DEFAULT 'manual';
