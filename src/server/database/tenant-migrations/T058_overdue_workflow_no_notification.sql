-- The built-in "On task overdue — reschedule agent" workflow sent the PM a notification with no
-- task, no project and no link ("Agent detected overdue task and generated a reschedule
-- proposal.") every time it ran — even when no proposal was made. Late tasks are shown in the
-- Morning Briefing, and any proposal the agent makes is listed there under its project, so the
-- notify step is removed. Only the untouched system seed is changed.
DELETE FROM workflow_edges WHERE id = 'wf-seed-4-edge2' AND workflow_id = 'wf-seed-4';
DELETE FROM workflow_nodes WHERE id = 'wf-seed-4-notify' AND workflow_id = 'wf-seed-4';
