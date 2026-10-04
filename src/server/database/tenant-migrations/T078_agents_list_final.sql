-- (company database copy of control-plane migration 129)
-- Finish the agents list clean-up (2026-10-04, user-approved): the budget-forecast wrapper is no
-- longer used (the nightly budget check reads EVM directly), and 'rag-query-v1' was listed but never
-- existed as an agent. Leaves auto-reschedule-v1 and monte-carlo-v1.
DELETE FROM agents WHERE id IN ('budget-forecast-v1', 'rag-query-v1');
