-- T081: the sample project has nothing on a Saturday or Sunday (user, 2026-10-05). The seed (T033)
-- has fixed dates, and some fell on weekends: task ends, sprints, meetings, a timesheet line,
-- expenses, risk dates. Each weekend date moves back to the Friday before (Saturday -1 day,
-- Sunday -2), which keeps every start on or before its end. Sample rows only ("demo-" ids);
-- customers' data is untouched. Also run by SampleProjectService.load() after the seed, so a
-- reloaded sample gets the same dates.
UPDATE tasks SET start_date = DATE_SUB(start_date, INTERVAL IF(DAYOFWEEK(start_date) = 7, 1, 2) DAY)
 WHERE id LIKE 'demo-%' AND DAYOFWEEK(start_date) IN (1, 7);
UPDATE tasks SET end_date = DATE_SUB(end_date, INTERVAL IF(DAYOFWEEK(end_date) = 7, 1, 2) DAY)
 WHERE id LIKE 'demo-%' AND DAYOFWEEK(end_date) IN (1, 7);
UPDATE baseline_tasks SET start_date = DATE_SUB(start_date, INTERVAL IF(DAYOFWEEK(start_date) = 7, 1, 2) DAY)
 WHERE id LIKE 'demo-%' AND DAYOFWEEK(start_date) IN (1, 7);
UPDATE baseline_tasks SET end_date = DATE_SUB(end_date, INTERVAL IF(DAYOFWEEK(end_date) = 7, 1, 2) DAY)
 WHERE id LIKE 'demo-%' AND DAYOFWEEK(end_date) IN (1, 7);
UPDATE sprints SET end_date = DATE_SUB(end_date, INTERVAL IF(DAYOFWEEK(end_date) = 7, 1, 2) DAY)
 WHERE id LIKE 'demo-%' AND DAYOFWEEK(end_date) IN (1, 7);
UPDATE meetings SET scheduled_date = DATE_SUB(scheduled_date, INTERVAL IF(DAYOFWEEK(scheduled_date) = 7, 1, 2) DAY)
 WHERE id LIKE 'demo-%' AND DAYOFWEEK(scheduled_date) IN (1, 7);
UPDATE meeting_action_items SET due_date = DATE_SUB(due_date, INTERVAL IF(DAYOFWEEK(due_date) = 7, 1, 2) DAY)
 WHERE id LIKE 'demo-%' AND DAYOFWEEK(due_date) IN (1, 7);
UPDATE project_risks SET due_date = DATE_SUB(due_date, INTERVAL IF(DAYOFWEEK(due_date) = 7, 1, 2) DAY)
 WHERE id LIKE 'demo-%' AND DAYOFWEEK(due_date) IN (1, 7);
UPDATE project_risks SET decision_date = DATE_SUB(decision_date, INTERVAL IF(DAYOFWEEK(decision_date) = 7, 1, 2) DAY)
 WHERE id LIKE 'demo-%' AND DAYOFWEEK(decision_date) IN (1, 7);
UPDATE project_expenses SET `date` = DATE_SUB(`date`, INTERVAL IF(DAYOFWEEK(`date`) = 7, 1, 2) DAY)
 WHERE id LIKE 'demo-%' AND DAYOFWEEK(`date`) IN (1, 7);
UPDATE time_entries SET `date` = DATE_SUB(`date`, INTERVAL IF(DAYOFWEEK(`date`) = 7, 1, 2) DAY)
 WHERE id LIKE 'demo-%' AND DAYOFWEEK(`date`) IN (1, 7);
UPDATE resource_availability SET date_from = DATE_SUB(date_from, INTERVAL IF(DAYOFWEEK(date_from) = 7, 1, 2) DAY)
 WHERE id LIKE 'demo-%' AND DAYOFWEEK(date_from) IN (1, 7);
UPDATE resource_availability SET date_to = DATE_SUB(date_to, INTERVAL IF(DAYOFWEEK(date_to) = 7, 1, 2) DAY)
 WHERE id LIKE 'demo-%' AND DAYOFWEEK(date_to) IN (1, 7);
