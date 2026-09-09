-- T031: Lesson feedback, source artifact linkage, and elevation governance
-- Supports: dismiss/helpful signals, provenance tracking, pending_elevation workflow

-- 1. Source artifact linkage (JSON array of {type, id} objects)
ALTER TABLE lessons_learned
  ADD COLUMN source_artifacts JSON DEFAULT NULL AFTER is_elevated;

-- 2. Expand status ENUM to include pending_elevation
ALTER TABLE lessons_learned
  MODIFY COLUMN status ENUM('draft','reviewed','approved','archived','pending_elevation') NOT NULL DEFAULT 'approved';

-- 3. Lesson feedback table (tenant-scoped)
CREATE TABLE IF NOT EXISTS lesson_feedback (
  id VARCHAR(36) PRIMARY KEY,
  lesson_id VARCHAR(64) NOT NULL,
  user_id INT NOT NULL,
  action ENUM('helpful','dismissed','outdated') NOT NULL,
  comment TEXT DEFAULT NULL,
  context VARCHAR(100) DEFAULT NULL,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  INDEX idx_lf_lesson (lesson_id),
  INDEX idx_lf_user_lesson (user_id, lesson_id),
  CONSTRAINT fk_lf_lesson FOREIGN KEY (lesson_id) REFERENCES lessons_learned(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
