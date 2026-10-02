-- Task cost = work effort × rate (2026-10-02, agreed with the user). A task's actual cost is
-- its approved hours × each person's rate; its budget is its planned hours × rate. Neither is
-- typed any more. Non-labour costs (licences, vendors, materials) belong in the project's
-- Expenses, so costs that were typed on tasks move there — labelled with the task — and no
-- money disappears. Summary tasks are left to their roll-up.
INSERT INTO project_expenses (id, project_id, date, amount, category, vendor, description, created_by)
SELECT UUID(), s.project_id,
       COALESCE(t.actual_end_date, t.actual_start_date, t.end_date, t.start_date, CURDATE()),
       ROUND(GREATEST(COALESCE(t.other_cost, COALESCE(t.actual_cost, 0) - t.labour_cost), 0), 2),
       'other', NULL,
       CONCAT('Moved from task "', t.name, '" — task costs are now worked out from hours × rate'),
       COALESCE(t.created_by, 'system')
  FROM tasks t JOIN schedules s ON s.id = t.schedule_id
 WHERE COALESCE(t.is_summary, 0) = 0
   AND GREATEST(COALESCE(t.other_cost, COALESCE(t.actual_cost, 0) - t.labour_cost), 0) > 0;

UPDATE tasks SET other_cost = 0,
       actual_cost = CASE WHEN labour_cost > 0 THEN labour_cost ELSE NULL END
 WHERE COALESCE(is_summary, 0) = 0;
