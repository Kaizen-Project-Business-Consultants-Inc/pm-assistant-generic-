-- Give every task its own position (sort_order) within its schedule.
--
-- Row numbers on the schedule are "fixed" (MS Project ID style): a task's position in the
-- plan. That only holds if sort_order is distinct. Bulk-created tasks (MCP / bulk API) and
-- recurring-task occurrences were all inserted with sort_order 0, so their order fell back
-- to start date — and a task's row number changed whenever a link pushed its dates
-- (found 2026-09-24: linking rows 2 and 3 on NSWMA, the linked task moved to row 5).
-- Those insert paths now assign the next free position; this fixes existing rows.
--
-- Only schedules that actually have two siblings sharing a position are touched, and the
-- new values follow the order the schedule shows today (sort_order, then start date — no
-- date first — then created_at, then id), so nothing visibly reorders. A single sequence
-- per schedule keeps every sibling group's relative order, so the tree is unchanged.
UPDATE tasks t
JOIN (
  SELECT id,
         ROW_NUMBER() OVER (PARTITION BY schedule_id ORDER BY sort_order, start_date, created_at, id) - 1 AS pos
  FROM tasks
  WHERE schedule_id IN (
    SELECT schedule_id FROM (
      SELECT schedule_id
      FROM tasks
      GROUP BY schedule_id, parent_task_id, sort_order
      HAVING COUNT(*) > 1
    ) dup
  )
) r ON r.id = t.id
SET t.sort_order = r.pos;
