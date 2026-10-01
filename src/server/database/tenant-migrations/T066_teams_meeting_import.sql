-- Meeting Intelligence: bring in Teams transcripts (2026-09-30)
-- 1. Which Teams meeting an analysis came from, so the list can say "Already analyzed".
ALTER TABLE meeting_analyses ADD COLUMN IF NOT EXISTS source_ref VARCHAR(255) NULL;
CREATE INDEX IF NOT EXISTS idx_ma_source_ref ON meeting_analyses (project_id, source_ref);

-- 2. "Who's who": the PM's choice for a Teams speaker name, remembered for the next meeting.
--    user_id NULL = "Not a project member" (a guest or a meeting room).
CREATE TABLE IF NOT EXISTS meeting_speaker_links (
  speaker_key VARCHAR(255) NOT NULL PRIMARY KEY,
  speaker_name VARCHAR(255) NOT NULL,
  user_id VARCHAR(36) NULL,
  updated_by VARCHAR(36) NULL,
  updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
