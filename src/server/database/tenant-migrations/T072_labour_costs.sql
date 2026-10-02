-- Labour from approved timesheets (2026-10-02, agreed with the user). When a line manager
-- approves a week, each task's labour (approved hours × the person's rate on the day) is worked
-- out, and spending = labour + other costs. Whatever was typed in by hand before becomes the
-- "other costs", so nothing typed is lost. tasks.actual_cost and projects.budget_spent stay the
-- TOTAL, so every report, EVM figure and summary-task roll-up keeps adding up as before.
ALTER TABLE tasks ADD COLUMN IF NOT EXISTS labour_hours DECIMAL(9,2) NOT NULL DEFAULT 0;
ALTER TABLE tasks ADD COLUMN IF NOT EXISTS labour_cost DECIMAL(12,2) NOT NULL DEFAULT 0;
ALTER TABLE tasks ADD COLUMN IF NOT EXISTS other_cost DECIMAL(12,2) NULL;
UPDATE tasks SET other_cost = actual_cost WHERE other_cost IS NULL AND actual_cost IS NOT NULL;

ALTER TABLE projects ADD COLUMN IF NOT EXISTS labour_cost DECIMAL(14,2) NOT NULL DEFAULT 0;
ALTER TABLE projects ADD COLUMN IF NOT EXISTS other_costs DECIMAL(14,2) NULL;
UPDATE projects SET other_costs = budget_spent WHERE other_costs IS NULL;
