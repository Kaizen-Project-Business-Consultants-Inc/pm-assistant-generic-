-- Add view_preferences JSON column for cross-device UI preferences
ALTER TABLE users ADD COLUMN view_preferences JSON DEFAULT NULL;
