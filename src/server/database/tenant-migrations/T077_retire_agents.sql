-- (company database copy of control-plane migration 128)
-- The agents list after the 2026-10-04 agent review: twelve agents were removed from the app —
-- they duplicated Schedule Review, the Team Planner, EVM, status reports or Lessons, their AI
-- replies failed, or they reached across projects. Drop their rows so admin lists match what runs.
DELETE FROM agents WHERE id IN (
  'schedule-recovery-v1', 'scope-creep-detection-v1', 'budget-intelligence-v1', 'resource-optimization-v1',
  'cross-project-intelligence-v1', 'risk-escalation-v1', 'stakeholder-communication-v1', 'project-hygiene-v1',
  'dependency-risk-v1', 'lessons-learned-v1', 'predictive-alerting-v1', 'meeting-followup-v1'
);
