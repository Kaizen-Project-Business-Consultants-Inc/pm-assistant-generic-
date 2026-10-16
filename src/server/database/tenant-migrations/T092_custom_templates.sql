-- Custom project templates (2026-10-16): a template a company saves (Save as template, create,
-- marketplace import) was kept only in the server's memory, so every restart or deploy lost it.
-- Each company's own database now keeps its templates: the whole template as JSON (tasks, links,
-- starter RAID), plus how often it has been used. Built-in templates stay in the code.
CREATE TABLE IF NOT EXISTS custom_templates (
  id VARCHAR(40) NOT NULL PRIMARY KEY,
  name VARCHAR(255) NOT NULL,
  body JSON NOT NULL,
  usage_count INT NOT NULL DEFAULT 0,
  created_by VARCHAR(36) DEFAULT NULL,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  INDEX idx_custom_templates_created (created_at)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
