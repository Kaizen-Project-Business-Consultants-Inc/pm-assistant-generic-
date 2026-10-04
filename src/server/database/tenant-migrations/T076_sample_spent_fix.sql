-- Fix the sample project's spend, counted twice by T075 (2026-10-04). The sample's seed (T033)
-- sets budget_spent = its expenses (112,500); T072 then copied that figure into other_costs, and
-- T075 added the expenses again → 225,000. The sample has no typed-in costs: other costs are 0,
-- so spent = labour + expenses. Only demo projects had this; customers' projects are unaffected.
UPDATE projects p SET
  p.other_costs = 0,
  p.budget_spent = ROUND(p.labour_cost
                         + (SELECT COALESCE(SUM(e.amount), 0) FROM project_expenses e WHERE e.project_id = p.id), 2)
WHERE p.id = 'demo-sample-webapp' OR COALESCE(p.is_demo, 0) = 1;
