-- T010: Add task-level budget columns
-- Enables per-task budget allocation and actual cost tracking

ALTER TABLE tasks ADD COLUMN IF NOT EXISTS budget_allocated DECIMAL(12,2) DEFAULT NULL;
ALTER TABLE tasks ADD COLUMN IF NOT EXISTS actual_cost DECIMAL(12,2) DEFAULT NULL;
