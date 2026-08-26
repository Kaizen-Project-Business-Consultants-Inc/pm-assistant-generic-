-- T026: Lessons Learned enhancements
-- Adds review workflow, contributor tracking, effectiveness tracking, tags, and persistent patterns

-- Lesson lifecycle status
ALTER TABLE lessons_learned
  ADD COLUMN status ENUM('draft','reviewed','approved','archived') NOT NULL DEFAULT 'approved' AFTER confidence;

-- Contributor tracking
ALTER TABLE lessons_learned
  ADD COLUMN created_by INT DEFAULT NULL AFTER status,
  ADD COLUMN source_type ENUM('manual','ai_extracted','agent','seeded') NOT NULL DEFAULT 'manual' AFTER created_by;

-- Tags for flexible taxonomy
ALTER TABLE lessons_learned
  ADD COLUMN tags JSON DEFAULT NULL AFTER source_type;

-- Effectiveness tracking
ALTER TABLE lessons_learned
  ADD COLUMN applied_count INT NOT NULL DEFAULT 0 AFTER tags,
  ADD COLUMN effectiveness_rating TINYINT UNSIGNED DEFAULT NULL AFTER applied_count;

-- Index for status filtering (most queries will filter by approved)
CREATE INDEX idx_ll_status ON lessons_learned (status);

-- Persistent patterns table
CREATE TABLE IF NOT EXISTS lesson_patterns (
  id VARCHAR(64) PRIMARY KEY,
  title VARCHAR(500) NOT NULL,
  description TEXT NOT NULL,
  frequency INT NOT NULL DEFAULT 1,
  project_types JSON DEFAULT NULL,
  category VARCHAR(100) NOT NULL,
  recommendation TEXT NOT NULL,
  confidence TINYINT UNSIGNED NOT NULL DEFAULT 50,
  detected_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
