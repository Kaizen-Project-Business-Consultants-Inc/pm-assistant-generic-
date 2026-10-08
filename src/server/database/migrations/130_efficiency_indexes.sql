-- 130: shared-database indexes the 2026-10-08 efficiency check found missing (speed only).
-- Kovarti admin screens: audit summary by date; agent run statistics by memory type and date.
CREATE INDEX IF NOT EXISTS idx_audit_created ON audit_ledger (created_at);
CREATE INDEX IF NOT EXISTS idx_memory_type_created ON agent_memory (memory_type, created_at);
