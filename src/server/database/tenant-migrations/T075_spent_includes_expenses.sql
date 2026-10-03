-- A project's money spent includes its expenses (2026-10-03). Until now budget_spent was labour
-- + other costs only, and only the Financials tab added expenses on top — so EVM (CPI), the
-- dashboard, Budget Watch, analytics, the client portal and the portfolio all understated spend.
-- From here on budget_spent = labour + other costs + expenses, kept up to date whenever hours are
-- approved or an expense is added, changed or removed.
--
-- SET runs left to right: other costs are fixed first (budget_spent did not include expenses yet).
UPDATE projects p SET
  p.other_costs = COALESCE(p.other_costs, GREATEST(COALESCE(p.budget_spent, 0) - p.labour_cost, 0)),
  p.budget_spent = ROUND(COALESCE(p.other_costs, 0) + p.labour_cost
                         + (SELECT COALESCE(SUM(e.amount), 0) FROM project_expenses e WHERE e.project_id = p.id), 2);
