-- T082: a sprint's ACTUAL VELOCITY = story points of its tasks that were completed when the
-- sprint was closed. Saved on complete-sprint (SprintRepository.completeWithVelocity) so a task
-- reopened or finished after the close does not rewrite a past sprint's velocity.
ALTER TABLE sprints ADD COLUMN IF NOT EXISTS velocity_actual INT NULL;

-- Sprints closed before this column existed: save today's completed points (the best figure
-- available). Re-runnable: only closed sprints that have no saved figure yet.
UPDATE sprints s
SET s.velocity_actual = (
  SELECT COALESCE(SUM(st.story_points), 0)
  FROM sprint_tasks st
  JOIN tasks t ON t.id = st.task_id
  WHERE st.sprint_id = s.id AND t.status = 'completed'
)
WHERE s.status = 'completed' AND s.velocity_actual IS NULL;
