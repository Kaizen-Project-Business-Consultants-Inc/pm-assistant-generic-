-- T064 (2026-09-30): key results showed 0% whatever their figures said ("3 / 10 proposals" at 0%),
-- and so did the objectives they roll up into. New and edited key results now get progress =
-- current / target (GoalService.measuredProgress); this brings existing goals in line, once.
-- Only key results with a target > 0 and a current value are touched; then each objective with
-- key results gets their average, exactly as recalculateObjectiveProgress does.
UPDATE goals
   SET progress = LEAST(100, GREATEST(0, ROUND(current_value / target_value * 100)))
 WHERE goal_type = 'key_result' AND target_value > 0 AND current_value IS NOT NULL;

UPDATE goals o
  JOIN (SELECT parent_id, ROUND(AVG(progress)) AS avg_progress
          FROM goals WHERE goal_type = 'key_result' AND parent_id IS NOT NULL
         GROUP BY parent_id) c ON c.parent_id = o.id
   SET o.progress = c.avg_progress
 WHERE o.goal_type = 'objective';
