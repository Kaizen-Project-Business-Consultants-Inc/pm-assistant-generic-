-- Migration 084: Add composite index for report content retention purge
-- Supports ROW_NUMBER() window function partitioned by user_id
-- and the existing getReportHistory query pattern

ALTER TABLE ai_conversations
  ADD INDEX idx_ai_conv_user_context_active_created (user_id, context_type, is_active, created_at DESC);
