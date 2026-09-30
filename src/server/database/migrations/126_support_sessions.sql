-- Migration 126 (2026-09-30): Support view — the platform admin's read-only visits into ONE
-- company, for troubleshooting. Every visit is recorded here (who, which company, why, when)
-- and in that company's own audit trail. Visits last 30 minutes. The admin never changes
-- customer data: the server refuses every change during a visit.
CREATE TABLE IF NOT EXISTS support_sessions (
  id VARCHAR(36) NOT NULL PRIMARY KEY,
  admin_user_id VARCHAR(36) NOT NULL,
  organization_id VARCHAR(36) NOT NULL,
  reason VARCHAR(500) NOT NULL,
  ip_address VARCHAR(64) DEFAULT NULL,
  started_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  expires_at TIMESTAMP NOT NULL,
  ended_at TIMESTAMP NULL DEFAULT NULL,
  KEY idx_support_admin (admin_user_id, started_at),
  KEY idx_support_org (organization_id, started_at)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
