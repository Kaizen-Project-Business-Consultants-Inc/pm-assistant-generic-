/**
 * MCP Tool Permission Matrix
 *
 * Controls which user roles can access which MCP tools.
 * Uses a category-based approach for maintainability.
 */

export type Role =
  | 'admin' | 'executive' | 'project_manager' | 'team_member' | 'scrum_master' | 'finance_officer'
  | 'risk_manager' | 'pmo' | 'ba' | 'qa' | 'tester' | 'devops' | 'claude_sme' | 'viewer';

const ALL_ROLES: readonly Role[] = [
  'admin', 'executive', 'project_manager', 'team_member', 'scrum_master', 'finance_officer',
  'risk_manager', 'pmo', 'ba', 'qa', 'tester', 'devops', 'claude_sme', 'viewer',
];

// Read-only tools: all roles can access
const READ_TOOLS = new Set([
  // projects
  'list-projects', 'get-project',
  // schedules
  'list-schedules', 'get-critical-path', 'list-baselines',
  // tasks
  'list-tasks', 'list-task-comments', 'get-task-activity',
  // sprints
  'list-sprints', 'get-sprint', 'get-sprint-board', 'get-sprint-burndown', 'get-velocity',
  // resources
  'list-resources', 'get-resource-workload', 'get-resource-histogram',
  // time tracking
  'get-time-entries', 'get-timesheet', 'get-actual-vs-estimated',
  // reports
  'get-burndown', 'get-network-diagram', 'export-project', 'list-report-templates', 'run-report',
  // ai insights (read)
  'get-project-health', 'get-project-risks', 'get-alerts', 'get-analytics-summary',
  'get-portfolio-overview', 'natural-language-query', 'get-predictions-dashboard',
  'run-monte-carlo', 'get-evm-forecast',
  // approvals (read)
  'list-change-requests',
  // auto-reschedule & agent proposals (read)
  'detect-delays', 'list-proposals', 'get-proposal',
  // custom fields (read)
  'list-custom-fields',
  // intake (read)
  'list-intake-forms', 'list-intake-submissions',
  // integrations (read)
  'list-integrations',
  // raid (read)
  'list-raid-items', 'get-raid-stats',
  // lessons learned (read)
  'list-lessons', 'get-knowledge-base', 'find-relevant-lessons', 'find-similar-lessons',
  // resource optimizer (read)
  'get-resource-availability', 'forecast-resource-bottlenecks',
  // ai estimation
  'ai-estimate-task',
  // briefing
  'get-daily-briefing',
  // standup
  'get-standup-summary',
  // admin (read-safe)
  'search', 'get-audit-trail', 'list-notifications', 'mark-notifications-read',
  // templates (read)
  'list-templates', 'list-workflows',
]);

// Budget/financial insight tools: PM, finance, executive, pmo, admin
const FINANCE_TOOLS = new Set([
  'get-budget-forecast', 'get-evm-forecast', 'get-spend-to-date', 'get-burn-rate',
]);

// Risk analysis tools: PM, risk_manager, pmo, ba, admin
const RISK_ANALYSIS_TOOLS = new Set([
  'suggest-risk-mitigations',
]);

// Meeting analysis tools: PM, scrum_master, pmo, ba, admin
const MEETING_TOOLS = new Set([
  'get-meeting-summary',
]);

// Task write tools: team_member, scrum_master, project_manager, ba, qa, devops, admin
const TASK_WRITE_TOOLS = new Set([
  'create-task', 'update-task', 'bulk-create-tasks', 'bulk-update-tasks', 'bulk-status-update',
  'add-task-comment',
]);

// Task delete: scrum_master, project_manager, pmo, admin
const TASK_DELETE_TOOLS = new Set([
  'delete-task',
]);

// Sprint management: scrum_master, project_manager, pmo, admin
const SPRINT_WRITE_TOOLS = new Set([
  'create-sprint', 'update-sprint', 'add-task-to-sprint', 'remove-task-from-sprint',
  'start-sprint', 'complete-sprint',
]);

// Schedule write: project_manager, pmo, admin
const SCHEDULE_WRITE_TOOLS = new Set([
  'create-schedule', 'update-schedule', 'delete-schedule',
  'remove-dependency', 'clear-all-dependencies',
]);

// Project write: project_manager, pmo, admin
const PROJECT_WRITE_TOOLS = new Set([
  'create-project', 'update-project', 'delete-project',
]);

// Resource management: project_manager, pmo, admin
const RESOURCE_WRITE_TOOLS = new Set([
  'create-resource', 'update-resource', 'delete-resource',
  'set-resource-availability', 'find-skill-match',
]);

// RAID write: project_manager, scrum_master, risk_manager, pmo, ba, admin
const RAID_WRITE_TOOLS = new Set([
  'create-raid-item', 'update-raid-item', 'ai-scan-risks',
]);

// Lessons learned write: project_manager, pmo, ba, admin
const LESSONS_WRITE_TOOLS = new Set([
  'extract-lessons', 'detect-patterns', 'add-lesson',
]);

// Approval actions: project_manager, executive, pmo, admin
const APPROVAL_WRITE_TOOLS = new Set([
  'create-change-request', 'submit-for-approval', 'act-on-approval',
  'propose-reschedule', 'accept-proposal', 'reject-proposal',
]);

// Time logging: team_member, scrum_master, project_manager, ba, qa, tester, devops, admin
const TIME_TOOLS = new Set([
  'log-time',
]);

// Intake submission: all roles; review: project_manager, pmo, admin
const INTAKE_SUBMIT_TOOLS = new Set(['submit-intake-form']);
const INTAKE_REVIEW_TOOLS = new Set(['review-submission']);

// Custom field write: project_manager, pmo, admin
const CUSTOM_FIELD_WRITE_TOOLS = new Set([
  'create-custom-field', 'set-custom-field-values',
]);

// Admin/integration tools: admin only
const ADMIN_ONLY_TOOLS = new Set([
  'create-integration', 'sync-integration', 'trigger-agent',
]);

// Status report generation: project_manager, scrum_master, pmo, ba, admin
const STATUS_REPORT_TOOLS = new Set([
  'generate-status-report',
]);

// Template/workflow management: project_manager, pmo, admin
const TEMPLATE_WRITE_TOOLS = new Set([
  'apply-template', 'create-workflow',
]);

/** Role-to-tool permission mapping */
const ROLE_PERMISSIONS: Record<Role, (toolName: string) => boolean> = {
  admin: () => true, // admin can access everything

  executive: (tool) =>
    READ_TOOLS.has(tool) ||
    FINANCE_TOOLS.has(tool) ||
    APPROVAL_WRITE_TOOLS.has(tool),

  project_manager: (tool) =>
    READ_TOOLS.has(tool) ||
    FINANCE_TOOLS.has(tool) ||
    RISK_ANALYSIS_TOOLS.has(tool) ||
    MEETING_TOOLS.has(tool) ||
    STATUS_REPORT_TOOLS.has(tool) ||
    TASK_WRITE_TOOLS.has(tool) ||
    TASK_DELETE_TOOLS.has(tool) ||
    SPRINT_WRITE_TOOLS.has(tool) ||
    SCHEDULE_WRITE_TOOLS.has(tool) ||
    PROJECT_WRITE_TOOLS.has(tool) ||
    RESOURCE_WRITE_TOOLS.has(tool) ||
    APPROVAL_WRITE_TOOLS.has(tool) ||
    TIME_TOOLS.has(tool) ||
    INTAKE_SUBMIT_TOOLS.has(tool) ||
    INTAKE_REVIEW_TOOLS.has(tool) ||
    CUSTOM_FIELD_WRITE_TOOLS.has(tool) ||
    TEMPLATE_WRITE_TOOLS.has(tool) ||
    RAID_WRITE_TOOLS.has(tool) ||
    LESSONS_WRITE_TOOLS.has(tool),

  scrum_master: (tool) =>
    READ_TOOLS.has(tool) ||
    MEETING_TOOLS.has(tool) ||
    STATUS_REPORT_TOOLS.has(tool) ||
    TASK_WRITE_TOOLS.has(tool) ||
    TASK_DELETE_TOOLS.has(tool) ||
    SPRINT_WRITE_TOOLS.has(tool) ||
    TIME_TOOLS.has(tool) ||
    INTAKE_SUBMIT_TOOLS.has(tool) ||
    RAID_WRITE_TOOLS.has(tool),

  team_member: (tool) =>
    READ_TOOLS.has(tool) ||
    TASK_WRITE_TOOLS.has(tool) ||
    TIME_TOOLS.has(tool) ||
    INTAKE_SUBMIT_TOOLS.has(tool) ||
    RAID_WRITE_TOOLS.has(tool),

  finance_officer: (tool) =>
    READ_TOOLS.has(tool) ||
    FINANCE_TOOLS.has(tool),

  risk_manager: (tool) =>
    READ_TOOLS.has(tool) ||
    FINANCE_TOOLS.has(tool) ||
    RISK_ANALYSIS_TOOLS.has(tool) ||
    TASK_WRITE_TOOLS.has(tool) ||
    APPROVAL_WRITE_TOOLS.has(tool) ||
    INTAKE_SUBMIT_TOOLS.has(tool) ||
    RAID_WRITE_TOOLS.has(tool),

  pmo: (tool) =>
    READ_TOOLS.has(tool) ||
    FINANCE_TOOLS.has(tool) ||
    RISK_ANALYSIS_TOOLS.has(tool) ||
    MEETING_TOOLS.has(tool) ||
    STATUS_REPORT_TOOLS.has(tool) ||
    TASK_WRITE_TOOLS.has(tool) ||
    TASK_DELETE_TOOLS.has(tool) ||
    SPRINT_WRITE_TOOLS.has(tool) ||
    SCHEDULE_WRITE_TOOLS.has(tool) ||
    PROJECT_WRITE_TOOLS.has(tool) ||
    RESOURCE_WRITE_TOOLS.has(tool) ||
    APPROVAL_WRITE_TOOLS.has(tool) ||
    TIME_TOOLS.has(tool) ||
    INTAKE_SUBMIT_TOOLS.has(tool) ||
    INTAKE_REVIEW_TOOLS.has(tool) ||
    CUSTOM_FIELD_WRITE_TOOLS.has(tool) ||
    TEMPLATE_WRITE_TOOLS.has(tool) ||
    RAID_WRITE_TOOLS.has(tool) ||
    LESSONS_WRITE_TOOLS.has(tool),

  ba: (tool) =>
    READ_TOOLS.has(tool) ||
    RISK_ANALYSIS_TOOLS.has(tool) ||
    MEETING_TOOLS.has(tool) ||
    STATUS_REPORT_TOOLS.has(tool) ||
    TASK_WRITE_TOOLS.has(tool) ||
    TIME_TOOLS.has(tool) ||
    INTAKE_SUBMIT_TOOLS.has(tool) ||
    CUSTOM_FIELD_WRITE_TOOLS.has(tool) ||
    RAID_WRITE_TOOLS.has(tool) ||
    LESSONS_WRITE_TOOLS.has(tool),

  qa: (tool) =>
    READ_TOOLS.has(tool) ||
    TASK_WRITE_TOOLS.has(tool) ||
    TIME_TOOLS.has(tool) ||
    INTAKE_SUBMIT_TOOLS.has(tool) ||
    RAID_WRITE_TOOLS.has(tool),

  tester: (tool) =>
    READ_TOOLS.has(tool) ||
    TASK_WRITE_TOOLS.has(tool) ||
    TIME_TOOLS.has(tool) ||
    INTAKE_SUBMIT_TOOLS.has(tool) ||
    RAID_WRITE_TOOLS.has(tool),

  devops: (tool) =>
    READ_TOOLS.has(tool) ||
    TASK_WRITE_TOOLS.has(tool) ||
    TIME_TOOLS.has(tool) ||
    INTAKE_SUBMIT_TOOLS.has(tool) ||
    RAID_WRITE_TOOLS.has(tool),

  claude_sme: (tool) =>
    READ_TOOLS.has(tool) ||
    FINANCE_TOOLS.has(tool),

  viewer: (tool) =>
    READ_TOOLS.has(tool) ||
    tool === 'update-raid-item',
};

/**
 * Check if a tool is allowed for a given role.
 */
export function isToolAllowed(toolName: string, role: Role): boolean {
  const checker = ROLE_PERMISSIONS[role];
  if (!checker) return false;
  return checker(toolName);
}

/**
 * Get all roles that can access a given tool.
 */
export function getAllowedRoles(toolName: string): Role[] {
  return ALL_ROLES.filter(role => isToolAllowed(toolName, role));
}
