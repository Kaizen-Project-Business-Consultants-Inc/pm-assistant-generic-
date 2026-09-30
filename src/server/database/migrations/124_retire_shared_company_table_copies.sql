-- Migration 124 (2026-09-30): retire the old copies of company tables in the SHARED database.
--
-- Since Jul 2026 each company has its own database; these shared copies are leftovers from
-- before that. Nothing reads them (checked: code scan, dynamically-named tables, the Claude
-- connector, scripts, and a live tripwire on staging), but code running with no company
-- selected used to land in them silently. Accounts without a company are now refused
-- company features, so these copies can go.
--
-- RENAMED, not dropped: the data stays (staging's copies hold old July test data). To undo,
-- rename back. A later migration drops them after a quiet period. Only the SHARED database
-- is touched — every company's own tables are unaffected.

RENAME TABLE IF EXISTS `agent_activity_log` TO `_retired_agent_activity_log`;
RENAME TABLE IF EXISTS `agent_autonomy_config` TO `_retired_agent_autonomy_config`;
RENAME TABLE IF EXISTS `agent_confidence_log` TO `_retired_agent_confidence_log`;
RENAME TABLE IF EXISTS `agent_cost_ledger` TO `_retired_agent_cost_ledger`;
RENAME TABLE IF EXISTS `agent_feedback` TO `_retired_agent_feedback`;
RENAME TABLE IF EXISTS `agent_proposal_actions` TO `_retired_agent_proposal_actions`;
RENAME TABLE IF EXISTS `agent_proposal_reviews` TO `_retired_agent_proposal_reviews`;
RENAME TABLE IF EXISTS `agent_proposals` TO `_retired_agent_proposals`;
RENAME TABLE IF EXISTS `ai_accuracy_tracking` TO `_retired_ai_accuracy_tracking`;
RENAME TABLE IF EXISTS `ai_feedback` TO `_retired_ai_feedback`;
RENAME TABLE IF EXISTS `approval_actions` TO `_retired_approval_actions`;
RENAME TABLE IF EXISTS `approval_workflows` TO `_retired_approval_workflows`;
RENAME TABLE IF EXISTS `baselines` TO `_retired_baselines`;
RENAME TABLE IF EXISTS `change_requests` TO `_retired_change_requests`;
RENAME TABLE IF EXISTS `custom_field_values` TO `_retired_custom_field_values`;
RENAME TABLE IF EXISTS `custom_fields` TO `_retired_custom_fields`;
RENAME TABLE IF EXISTS `file_attachments` TO `_retired_file_attachments`;
RENAME TABLE IF EXISTS `goals` TO `_retired_goals`;
RENAME TABLE IF EXISTS `intake_forms` TO `_retired_intake_forms`;
RENAME TABLE IF EXISTS `intake_submissions` TO `_retired_intake_submissions`;
RENAME TABLE IF EXISTS `integration_sync_log` TO `_retired_integration_sync_log`;
RENAME TABLE IF EXISTS `integrations` TO `_retired_integrations`;
RENAME TABLE IF EXISTS `lessons_learned` TO `_retired_lessons_learned`;
RENAME TABLE IF EXISTS `meeting_analyses` TO `_retired_meeting_analyses`;
RENAME TABLE IF EXISTS `policies` TO `_retired_policies`;
RENAME TABLE IF EXISTS `policy_evaluations` TO `_retired_policy_evaluations`;
RENAME TABLE IF EXISTS `portal_comments` TO `_retired_portal_comments`;
RENAME TABLE IF EXISTS `portal_links` TO `_retired_portal_links`;
RENAME TABLE IF EXISTS `project_expenses` TO `_retired_project_expenses`;
RENAME TABLE IF EXISTS `project_health_history` TO `_retired_project_health_history`;
RENAME TABLE IF EXISTS `project_members` TO `_retired_project_members`;
RENAME TABLE IF EXISTS `project_risks` TO `_retired_project_risks`;
RENAME TABLE IF EXISTS `raid_activity_log` TO `_retired_raid_activity_log`;
RENAME TABLE IF EXISTS `raid_sequence_counter` TO `_retired_raid_sequence_counter`;
RENAME TABLE IF EXISTS `raid_updates` TO `_retired_raid_updates`;
RENAME TABLE IF EXISTS `report_schedules` TO `_retired_report_schedules`;
RENAME TABLE IF EXISTS `report_templates` TO `_retired_report_templates`;
RENAME TABLE IF EXISTS `reschedule_proposals` TO `_retired_reschedule_proposals`;
RENAME TABLE IF EXISTS `resource_assignments` TO `_retired_resource_assignments`;
RENAME TABLE IF EXISTS `resource_availability` TO `_retired_resource_availability`;
RENAME TABLE IF EXISTS `resources` TO `_retired_resources`;
RENAME TABLE IF EXISTS `schedules` TO `_retired_schedules`;
RENAME TABLE IF EXISTS `sprint_tasks` TO `_retired_sprint_tasks`;
RENAME TABLE IF EXISTS `sprints` TO `_retired_sprints`;
RENAME TABLE IF EXISTS `standup_summaries` TO `_retired_standup_summaries`;
RENAME TABLE IF EXISTS `task_activities` TO `_retired_task_activities`;
RENAME TABLE IF EXISTS `task_comments` TO `_retired_task_comments`;
RENAME TABLE IF EXISTS `task_dependencies` TO `_retired_task_dependencies`;
RENAME TABLE IF EXISTS `templates` TO `_retired_templates`;
RENAME TABLE IF EXISTS `time_entries` TO `_retired_time_entries`;
RENAME TABLE IF EXISTS `user_favourite_projects` TO `_retired_user_favourite_projects`;
RENAME TABLE IF EXISTS `webhooks` TO `_retired_webhooks`;
RENAME TABLE IF EXISTS `workflow_definitions` TO `_retired_workflow_definitions`;
RENAME TABLE IF EXISTS `workflow_edges` TO `_retired_workflow_edges`;
RENAME TABLE IF EXISTS `workflow_executions` TO `_retired_workflow_executions`;
RENAME TABLE IF EXISTS `workflow_node_executions` TO `_retired_workflow_node_executions`;
RENAME TABLE IF EXISTS `workflow_nodes` TO `_retired_workflow_nodes`;
RENAME TABLE IF EXISTS `workflow_rules` TO `_retired_workflow_rules`;
