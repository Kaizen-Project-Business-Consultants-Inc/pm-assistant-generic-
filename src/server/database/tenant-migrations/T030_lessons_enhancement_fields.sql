-- T030: Lessons Learned enhancement fields
-- Adds root_cause, severity, recurrence_score, is_elevated for elevation workflow and PMO reporting

ALTER TABLE lessons_learned
  ADD COLUMN root_cause TEXT DEFAULT NULL AFTER recommendation,
  ADD COLUMN severity ENUM('low','medium','high','critical') DEFAULT NULL AFTER root_cause,
  ADD COLUMN recurrence_score TINYINT UNSIGNED NOT NULL DEFAULT 0 AFTER severity,
  ADD COLUMN is_elevated BOOLEAN NOT NULL DEFAULT FALSE AFTER recurrence_score;

CREATE INDEX idx_ll_elevated ON lessons_learned (is_elevated, status, confidence);
