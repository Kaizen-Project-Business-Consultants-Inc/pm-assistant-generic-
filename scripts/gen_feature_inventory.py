"""Generate Feature Inventory Excel for tier review."""
import openpyxl
from openpyxl.styles import Font, PatternFill, Alignment, Border, Side
from openpyxl.utils import get_column_letter

wb = openpyxl.Workbook()
ws = wb.active
ws.title = 'Feature Inventory'

# Styles
header_font = Font(bold=True, color='FFFFFF', size=11)
header_fill = PatternFill(start_color='2D3748', end_color='2D3748', fill_type='solid')
wrap = Alignment(wrap_text=True, vertical='top')
thin_border = Border(
    left=Side(style='thin', color='CBD5E0'),
    right=Side(style='thin', color='CBD5E0'),
    top=Side(style='thin', color='CBD5E0'),
    bottom=Side(style='thin', color='CBD5E0'),
)

TIER_FILLS = {
    'Pro+': PatternFill(start_color='BEE3F8', end_color='BEE3F8', fill_type='solid'),
    'Basic+': PatternFill(start_color='C6F6D5', end_color='C6F6D5', fill_type='solid'),
    'SME': PatternFill(start_color='E9D8FD', end_color='E9D8FD', fill_type='solid'),
    'Paid': PatternFill(start_color='C6F6D5', end_color='C6F6D5', fill_type='solid'),
    'Admin': PatternFill(start_color='FBD38D', end_color='FBD38D', fill_type='solid'),
    'Public': PatternFill(start_color='F7FAFC', end_color='F7FAFC', fill_type='solid'),
    'budget': PatternFill(start_color='FEFCBF', end_color='FEFCBF', fill_type='solid'),
    'Trial': PatternFill(start_color='E2E8F0', end_color='E2E8F0', fill_type='solid'),
    'All tiers': PatternFill(start_color='C6F6D5', end_color='C6F6D5', fill_type='solid'),
}

# Headers
headers = ['#', 'Category', 'Feature', 'Description', 'Visibility', 'Current Tier', 'Gating Method', 'Notes']
for col, h in enumerate(headers, 1):
    cell = ws.cell(row=1, column=col, value=h)
    cell.font = header_font
    cell.fill = header_fill
    cell.alignment = Alignment(horizontal='center', vertical='center')
    cell.border = thin_border

widths = [5, 22, 30, 50, 12, 22, 22, 45]
for i, w in enumerate(widths, 1):
    ws.column_dimensions[get_column_letter(i)].width = w

# (category, feature, description, visibility, tier, gating, notes)
features = [
    # CORE PM
    ('Core PM', 'Project CRUD', 'Create, edit, delete projects with methodology, status, budget', 'UI', 'All tiers', 'None (trial: 3 project limit)', 'Trial limited to 3 projects'),
    ('Core PM', 'Project Brief Card', 'Editable summary with markdown, auto-save, presence', 'UI', 'All tiers', 'None', ''),
    ('Core PM', 'Project Grouping', 'Organize projects into custom groups', 'UI', 'All tiers', 'None', ''),
    ('Core PM', 'Project Links', 'Link projects together, pin to overview', 'UI', 'All tiers', 'None', ''),
    ('Core PM', 'Project Members', 'Manage team with owner/manager/editor/viewer roles', 'UI', 'All tiers', 'None', ''),
    ('Core PM', 'Project Search & Filter', 'Filter by status, type, team member', 'UI', 'All tiers', 'None', ''),
    ('Core PM', 'Favorite Projects', 'Star projects for quick access', 'UI', 'All tiers', 'None', ''),
    ('Core PM', 'Custom Fields', 'Add custom fields to projects/tasks', 'UI', 'All tiers', 'None', ''),
    ('Core PM', 'Dashboard Widgets', 'Customizable widget grid with KPIs', 'UI', 'All tiers', 'None', ''),
    ('Core PM', 'Full-Text Search', 'Search projects, tasks, documents', 'UI', 'All tiers', 'None', ''),

    # SCHEDULING
    ('Scheduling', 'Schedule Management', 'Multi-schedule per project, task hierarchies', 'UI', 'All tiers', 'None', ''),
    ('Scheduling', 'Gantt Chart', 'Interactive timeline, drag-to-reschedule, critical path', 'UI', 'All tiers', 'None', ''),
    ('Scheduling', 'Table View', 'Spreadsheet-style inline task editor', 'UI', 'All tiers', 'None', ''),
    ('Scheduling', 'Kanban Board', 'Drag-drop status columns', 'UI', 'All tiers', 'None', ''),
    ('Scheduling', 'Calendar View', 'Month/week calendar of tasks', 'UI', 'All tiers', 'None', ''),
    ('Scheduling', 'Task Dependencies', 'FS/SS/FF/SF with lag days', 'UI', 'All tiers', 'None', ''),
    ('Scheduling', 'Recurring Tasks', 'Daily/weekly/monthly/yearly auto-generation', 'UI', 'All tiers', 'None', 'Cron: daily 02:00'),
    ('Scheduling', 'Milestones', 'Mark tasks as milestones (diamond in Gantt)', 'UI', 'All tiers', 'None', ''),
    ('Scheduling', 'Task Checklists', 'Sub-items within tasks', 'UI', 'All tiers', 'None', ''),
    ('Scheduling', 'Task Priority & Assignment', 'Low/med/high/urgent, resource assignment', 'UI', 'All tiers', 'None', ''),
    ('Scheduling', 'Baselines', 'Snapshot schedule for variance tracking', 'UI', 'All tiers', 'None', ''),
    ('Scheduling', 'Network Diagram', 'PERT chart of dependencies', 'UI', 'All tiers', 'None', ''),
    ('Scheduling', 'Burndown Charts', 'Sprint/iteration progress tracking', 'UI', 'All tiers', 'None', ''),
    ('Scheduling', 'Import (CSV/Excel/MSPDI)', 'Bulk import tasks and schedules', 'UI', 'All tiers', 'None', '5MB limit, duplicate detection'),
    ('Scheduling', 'Scenario Modeling', 'What-if schedule scenarios', 'UI', 'All tiers', 'None', ''),

    # AGILE
    ('Agile', 'Sprints & Backlog', 'Sprint planning, backlog grooming, velocity', 'UI', 'All tiers', 'None', ''),
    ('Agile', 'Story Points', 'Agile estimation on tasks', 'UI', 'All tiers', 'None', ''),
    ('Agile', 'Epic Board & List', 'Epic-level views of features', 'UI', 'All tiers', 'None', ''),
    ('Agile', 'Flow Metrics', 'Cycle time, throughput (Kanban)', 'Backend', 'All tiers', 'None', ''),
    ('Agile', 'Scrum Definition', 'Sprint length, ceremonies config', 'UI', 'All tiers', 'None', ''),
    ('Agile', 'Retrospectives', 'Sprint retro item capture', 'UI', 'All tiers', 'None', ''),

    # RESOURCE MANAGEMENT
    ('Resources', 'Resource Hub', 'Org-wide resource pool with project allocations', 'UI', 'Basic+', 'requireFeature(resources)', 'Trial gets sample response'),
    ('Resources', 'Resource Allocation', 'Assign resources to tasks (hours/%)', 'UI', 'Basic+', 'requireFeature(resources)', ''),
    ('Resources', 'Resource Availability', 'Availability calendar by date range', 'UI', 'Basic+', 'requireFeature(resources)', ''),
    ('Resources', 'Resource Leveling', 'Auto-balance resources across tasks', 'UI', 'Basic+', 'requireFeature(resources)', ''),
    ('Resources', 'Resource Optimizer (AI)', 'AI-driven allocation recommendations', 'UI', 'Pro+', 'requireFeature(resources) + AI budget', ''),
    ('Resources', 'Resource Forecast', 'Predict future resource needs', 'UI', 'Basic+', 'requireFeature(resources)', ''),
    ('Resources', 'Resource Histogram', 'Bar chart of allocation by role', 'UI', 'Basic+', 'requireFeature(resources)', ''),
    ('Resources', 'Workload Heatmap', 'Color-coded workload intensity', 'UI', 'Basic+', 'requireFeature(resources)', ''),
    ('Resources', 'Utilization Trends', '12-week SVG line chart', 'UI', 'Basic+', 'requireFeature(resources)', ''),
    ('Resources', 'Utilization Coaching', 'Weekly AI coaching emails', 'Backend', 'Pro+', 'AI budget', 'Cron: Mondays 09:00'),
    ('Resources', 'Resource Requests', 'Formal resource request workflow', 'UI', 'Basic+', 'requireFeature(resources)', ''),
    ('Resources', 'Calendar Templates', 'Pre-built working calendars (holidays)', 'UI', 'Basic+', 'requireFeature(resources)', ''),
    ('Resources', 'Resource Usage View', 'Per-resource task breakdown (MPP-style)', 'UI', 'Basic+', 'requireFeature(resources)', 'New: Sep 2026'),
    ('Resources', 'Resource Quick-Assign', 'Gantt column with chips + dropdown', 'UI', 'Basic+', 'requireFeature(resources)', ''),
    ('Resources', 'Effort-Driven Scheduling', 'Auto-recalc duration on assignment change', 'Backend', 'Basic+', 'requireFeature(resources)', ''),
    ('Resources', 'Skill Proficiency', '1-5 scale skill tracking', 'UI', 'Basic+', 'requireFeature(resources)', ''),
    ('Resources', 'Cost Rollup', 'costRateHourly, per-week cost, total project cost', 'UI', 'Basic+', 'requireFeature(resources)', ''),
    ('Resources', 'Resource Groups', 'Group resources by custom categories', 'UI', 'Basic+', 'requireFeature(resources)', ''),
    ('Resources', 'Conflict Detection', 'Over-allocation warning (advisory)', 'UI', 'Basic+', 'requireFeature(resources)', ''),

    # TIME TRACKING
    ('Time Tracking', 'Time Entries', 'Log hours on tasks', 'UI', 'All tiers', 'None', ''),
    ('Time Tracking', 'Timesheet Page', 'Weekly timesheet view', 'UI', 'All tiers', 'None', ''),
    ('Time Tracking', 'Timesheet Approval', 'Draft > submitted > approved/rejected workflow', 'UI', 'All tiers', 'None', ''),
    ('Time Tracking', 'Timesheet Compliance', 'Auto-remind to submit timesheets', 'Backend', 'All tiers', 'None', 'Cron: weekdays 16:00'),
    ('Time Tracking', 'Rate Types', 'Regular/overtime hourly rates', 'UI', 'All tiers', 'None', ''),
    ('Time Tracking', 'Expense Tracking', 'Log non-labor project costs', 'UI', 'All tiers', 'None', ''),

    # FINANCIAL / EVM
    ('Financial/EVM', 'EVM Dashboard', 'CPI/SPI gauges, variance analysis, forecasting', 'UI', 'Pro+', 'requireFeature(evm)', 'Trial gets sample metrics'),
    ('Financial/EVM', 'S-Curve Analysis', 'Planned vs actual cumulative progress', 'UI', 'Pro+', 'requireFeature(evm)', ''),
    ('Financial/EVM', 'Variance Pareto', 'Top variance contributors chart', 'UI', 'Pro+', 'requireFeature(evm)', ''),
    ('Financial/EVM', 'Earned Schedule', 'Schedule performance metrics', 'UI', 'Pro+', 'requireFeature(evm)', ''),
    ('Financial/EVM', 'TCPI', 'To-Complete Performance Index', 'UI', 'Pro+', 'requireFeature(evm)', ''),
    ('Financial/EVM', 'Budget Thresholds', 'Alert thresholds for budget overruns', 'UI', 'Pro+', 'requireFeature(evm)', ''),
    ('Financial/EVM', 'EVM What-If', 'Scenario modeling within EVM', 'UI', 'Pro+', 'requireFeature(evm)', ''),
    ('Financial/EVM', 'Monte Carlo Simulation', 'Probabilistic schedule/cost forecasting', 'UI', 'Pro+', 'requireFeature(monte_carlo)', 'Trial gets sample'),
    ('Financial/EVM', 'Budget Management', 'Allocated vs spent tracking (basic)', 'UI', 'All tiers', 'None', 'Basic field on project'),

    # RAID
    ('RAID', 'Risk Management', 'Create/track risks with probability/impact matrix', 'UI', 'All tiers', 'None', ''),
    ('RAID', 'Action Item Tracking', 'Log actions with owners and due dates', 'UI', 'All tiers', 'None', ''),
    ('RAID', 'Issue Logging', 'Issue tracking and escalation path', 'UI', 'All tiers', 'None', ''),
    ('RAID', 'Decision Logging', 'Record decisions for audit trail', 'UI', 'All tiers', 'None', ''),
    ('RAID', 'RAID Reports', 'Formatted RAID reports with export', 'UI', 'Paid tiers', 'requirePaidTier', 'Trial gets sample'),
    ('RAID', 'Strategic Risk Scan (AI)', 'Cross-project AI risk analysis', 'UI', 'Paid tiers', 'requirePaidTier + AI budget', ''),

    # REPORTING
    ('Reporting', 'Status Reports', 'AI-generated or manual reports; PDF/Word/HTML/Email', 'UI', 'Paid tiers', 'requirePaidTier', 'Trial gets sample'),
    ('Reporting', 'Report Builder', 'Custom drag-drop report builder', 'UI', 'Basic+', 'requireFeature(reports)', 'Trial gets sample'),
    ('Reporting', 'Report Scheduler', 'Scheduled report delivery (email/Slack)', 'UI', 'Basic+', 'requireFeature(reports)', ''),
    ('Reporting', 'Instant Reports', 'Quick pre-built report generation', 'UI', 'Basic+', 'requireFeature(reports)', ''),
    ('Reporting', 'Portfolio Dashboard', 'Multi-project KPI overview', 'UI', 'All tiers', 'None', ''),
    ('Reporting', 'Analytics Summary', 'High-level metrics across projects', 'UI', 'All tiers', 'None', ''),
    ('Reporting', 'KPI Drill-In', 'Click KPI to see underlying tasks', 'UI', 'All tiers', 'None', ''),
    ('Reporting', 'Daily Briefing', 'Morning priorities email', 'Backend', 'All tiers', 'None', 'Cron: daily 07:00'),
    ('Reporting', 'Compliance Reporting', 'Project compliance metrics', 'UI', 'All tiers', 'None', ''),

    # EXPORTS
    ('Exports', 'CSV/Excel Export', 'Export tasks, resources to spreadsheet', 'UI', 'Basic+', 'requireFeature(exports)', 'Trial gets sample'),
    ('Exports', 'PDF Export', 'Export reports, Gantt to PDF', 'UI', 'Basic+', 'requireFeature(exports)', ''),
    ('Exports', 'Word/DOCX Export', 'Export reports to Microsoft Word', 'UI', 'Basic+', 'requireFeature(exports)', ''),
    ('Exports', 'PNG Export', 'Export Gantt/charts as images', 'UI', 'Basic+', 'requireFeature(exports)', ''),
    ('Exports', 'Bulk Operations', 'Batch update multiple tasks at once', 'UI', 'All tiers', 'None', ''),

    # COLLABORATION
    ('Collaboration', 'Meetings & Agenda', 'Schedule meetings, create agendas', 'UI', 'All tiers', 'None', ''),
    ('Collaboration', 'Meeting Minutes', 'Record minutes with action items', 'UI', 'All tiers', 'None', ''),
    ('Collaboration', 'Meeting Action Items', 'Track follow-ups with owners/due dates', 'UI', 'All tiers', 'None', ''),
    ('Collaboration', 'Comments & Discussion', 'Task/project inline comments', 'UI', 'All tiers', 'None', ''),
    ('Collaboration', 'Presence Indicators', 'Real-time who-is-viewing (WebSocket)', 'UI', 'All tiers', 'None', ''),
    ('Collaboration', 'File Attachments', 'Attach files to tasks/projects', 'UI', 'All tiers', 'None', ''),
    ('Collaboration', 'Lessons Learned', 'Capture and reuse project lessons', 'UI', 'All tiers', 'None', ''),
    ('Collaboration', 'Intake Forms', 'Template-based data collection forms', 'UI', 'All tiers', 'None', ''),
    ('Collaboration', 'Approval Workflows', 'Multi-step approval routing', 'UI', 'All tiers', 'None', ''),
    ('Collaboration', 'Change Requests', 'Formal change management process', 'UI', 'All tiers', 'None', ''),
    ('Collaboration', 'Goals Tracking', 'Set and track project/org goals', 'UI', 'All tiers', 'None', ''),
    ('Collaboration', 'Stakeholder Portal', 'Branded read-only portal for clients', 'UI', 'Basic+', 'requireFeature(portal)', 'Trial gets sample'),

    # AI FEATURES
    ('AI', 'Mjuzi AI Chat', 'Persistent chat panel with project context', 'UI', 'All tiers (budget-gated)', 'AI budget only', 'Trial:5K; Basic:0; Pro:500K; SME:500K/seat'),
    ('AI', 'AI Task Estimation', 'AI estimates task duration and effort', 'UI', 'All tiers (budget-gated)', 'AI budget only', ''),
    ('AI', 'AI Task Breakdown', 'AI decomposes epics into subtasks', 'UI', 'All tiers (budget-gated)', 'AI budget only', ''),
    ('AI', 'AI Risk Scan', 'AI identifies project risks', 'UI', 'All tiers (budget-gated)', 'AI budget only', ''),
    ('AI', 'AI Report Generation', 'AI writes narrative project reports', 'UI', 'All tiers (budget-gated)', 'AI budget only', ''),
    ('AI', 'AI Text Simplification', 'Simplify text for accessibility', 'UI', 'All tiers', 'None', 'No tier or budget check'),
    ('AI', 'AI Auto-Reschedule', 'AI suggests schedule adjustments', 'UI', 'Pro+', 'requireFeature(auto_reschedule)', 'Trial gets sample'),
    ('AI', 'Natural Language Query', 'Ask questions in plain English', 'UI', 'Pro+', 'requireFeature(nl_query)', 'Trial gets sample'),
    ('AI', 'Meeting Intelligence', 'AI analyzes transcripts, extracts actions', 'UI', 'Pro+', 'requireFeature(meeting_intelligence)', 'Trial gets sample'),
    ('AI', 'Cross-Project Intelligence', 'AI insights across portfolio', 'UI', 'Pro+', 'requireFeature(cross_project_intelligence)', ''),
    ('AI', 'Predictive Intelligence', 'ML-based delay/risk/budget forecasting', 'Backend', 'All tiers (budget-gated)', 'AI budget only', ''),
    ('AI', 'AI Task Prioritization', 'AI suggests optimal task order', 'UI', 'All tiers (budget-gated)', 'AI budget only', ''),
    ('AI', 'Narrative Generation', 'AI writes project prose summaries', 'Backend', 'All tiers (budget-gated)', 'AI budget only', ''),
    ('AI', 'AI Learning System', 'Track what AI learns from feedback', 'Backend', 'All tiers', 'None', ''),
    ('AI', 'AI Budget Management', 'Track/enforce per-tier token budgets', 'Backend', 'All tiers', 'Automatic', '429 when exceeded'),
    ('AI', 'Knowledge Base (RAG)', 'Search product docs via AI', 'Backend', 'All tiers (budget-gated)', 'AI budget only', 'Requires EMBEDDING_ENABLED'),
    ('AI', 'Standup Summaries', 'AI summarizes daily standups', 'Backend', 'All tiers (budget-gated)', 'AI budget only', ''),

    # CONTEXT ENGINEERING
    ('AI Context', 'Context Config', 'Configure AI preferences and behavior', 'UI', 'All tiers', 'None', 'Settings > AI Context tab'),
    ('AI Context', 'Versioned Memory', 'Persistent AI memory (session/project/role)', 'UI', 'All tiers', 'None', ''),
    ('AI Context', 'Dreaming', 'Nightly AI memory refinement batch job', 'Backend', 'All tiers', 'None', 'Cron: 02:30 daily'),
    ('AI Context', 'Context Preview', 'See exactly what context is sent to AI', 'UI', 'All tiers', 'None', ''),
    ('AI Context', 'Skill Registry', 'Catalog of AI capabilities', 'UI', 'All tiers', 'None', ''),

    # AGENT SYSTEM
    ('Agents', 'Agent Framework', '16 autonomous AI agents for risk, budget, schedule', 'Backend', 'All tiers (budget-gated)', 'AI budget only', 'Agents consume AI tokens'),
    ('Agents', 'Budget Intelligence Agent', 'Monitor budget health, predict overruns', 'Backend', 'All tiers (budget-gated)', 'AI budget only', ''),
    ('Agents', 'Dependency Risk Agent', 'Identify critical path risks', 'Backend', 'All tiers (budget-gated)', 'AI budget only', ''),
    ('Agents', 'Lessons Learned Agent', 'Extract and suggest lessons from history', 'Backend', 'All tiers (budget-gated)', 'AI budget only', ''),
    ('Agents', 'Predictive Alerting Agent', 'Early warning of problems', 'Backend', 'All tiers (budget-gated)', 'AI budget only', ''),
    ('Agents', 'Project Hygiene Agent', 'Flag data quality issues', 'Backend', 'All tiers (budget-gated)', 'AI budget only', ''),
    ('Agents', 'Resource Optimization Agent', 'Suggest resource rebalancing', 'Backend', 'All tiers (budget-gated)', 'AI budget only', ''),
    ('Agents', 'Risk Escalation Agent', 'Auto-escalate critical risks', 'Backend', 'All tiers (budget-gated)', 'AI budget only', ''),
    ('Agents', 'Schedule Recovery Agent', 'Suggest schedule recovery plans', 'Backend', 'All tiers (budget-gated)', 'AI budget only', ''),
    ('Agents', 'Scope Creep Agent', 'Detect scope expansion patterns', 'Backend', 'All tiers (budget-gated)', 'AI budget only', ''),
    ('Agents', 'Stakeholder Comms Agent', 'Schedule stakeholder updates', 'Backend', 'All tiers (budget-gated)', 'AI budget only', ''),
    ('Agents', 'Cross-Project Intel Agent', 'Cross-project risk and pattern detection', 'Backend', 'All tiers (budget-gated)', 'AI budget only', ''),
    ('Agents', 'Agent Proposals', 'Human-in-the-loop: review/approve agent actions', 'UI', 'All tiers', 'None', ''),
    ('Agents', 'Agent Memory & Learning', 'Agents learn from actions and feedback', 'Backend', 'All tiers', 'None', ''),
    ('Agents', 'Agent Health & Diagnostics', 'Monitor agent performance and errors', 'UI (admin)', 'All tiers', 'None', 'Admin only'),
    ('Agents', 'Agent Kill Switch', 'Emergency stop all agents', 'UI (admin)', 'All tiers', 'None', 'Admin only'),
    ('Agents', 'Agent Autonomy Levels', 'Observe / suggest / auto-execute control', 'UI', 'All tiers', 'None', ''),
    ('Agents', 'Agent Activity Log', 'Audit trail of all agent actions', 'UI', 'All tiers', 'None', ''),
    ('Agents', 'Agent Policies', 'Safety guardrails and constraints', 'Backend', 'All tiers', 'None', ''),
    ('Agents', 'Agent Alerts', 'Notifications of agent actions/risks', 'UI', 'All tiers', 'None', ''),
    ('Agents', 'Agent Cost Tracking', 'Monitor per-agent token consumption', 'Backend', 'All tiers', 'None', ''),

    # AUTOMATION
    ('Automation', 'Automation Rules', '21 event types, 14 conditions, 14 action types', 'UI', 'Basic+', 'requireFeature(workflows)', 'Trial gets sample'),
    ('Automation', 'Nested AND/OR Conditions', 'Complex trigger logic with nesting', 'UI', 'Basic+', 'requireFeature(workflows)', ''),
    ('Automation', 'AI Content Generation', 'AI-generated content in workflow actions', 'Backend', 'Pro+', 'requireFeature(workflows) + AI', ''),
    ('Automation', 'Cross-Project Automations', 'Portfolio-level automation scope', 'UI', 'Basic+', 'requireFeature(workflows)', ''),
    ('Automation', 'Automation Marketplace', 'Share/discover automation templates', 'UI', 'Basic+', 'requireFeature(workflows)', ''),
    ('Automation', 'Governance Packs', 'Pre-built ITIL/PMI automation bundles', 'UI', 'Basic+', 'requireFeature(workflows)', '4 packs'),
    ('Automation', 'Scheduled Automations', 'Cron-like time-based execution', 'Backend', 'Basic+', 'requireFeature(workflows)', 'Cron: every minute'),
    ('Automation', 'Automation Debugger', 'Execution logs and insights', 'UI', 'Basic+', 'requireFeature(workflows)', ''),

    # DOCUMENT INTELLIGENCE
    ('Documents', 'Project Documents', 'Upload and manage project documents', 'UI', 'All tiers', 'None', ''),
    ('Documents', 'Document Classification (AI)', 'AI classifies document type and extracts insights', 'Backend', 'All tiers (budget-gated)', 'AI budget only', ''),
    ('Documents', 'Document Entity Linking', 'Link doc excerpts to tasks/risks/actions', 'Backend', 'All tiers', 'None', ''),
    ('Documents', 'Document Search (RAG)', 'Semantic search across documents', 'UI', 'All tiers (budget-gated)', 'AI budget only', 'Requires EMBEDDING_ENABLED'),
    ('Documents', 'Storage Connectors', 'SharePoint, OneDrive, Google Drive, Dropbox', 'UI', 'Pro+', 'Client-side tier check', 'CONNECTOR_TIERS=[pro, sme, enterprise]'),

    # NOTIFICATIONS
    ('Notifications', 'Notification Hub', 'Centralized notification inbox', 'UI', 'All tiers', 'None', ''),
    ('Notifications', 'Email Digest', 'Daily aggregated email of key updates', 'Backend', 'All tiers', 'None', 'Cron: daily 07:00'),
    ('Notifications', 'Email Alerts', 'Real-time email for important events', 'Backend', 'All tiers', 'None', ''),
    ('Notifications', 'Deadline Reminders', 'Upcoming task deadline alerts', 'Backend', 'All tiers', 'None', 'Cron: daily 08:00'),
    ('Notifications', 'WebSocket Real-Time', 'Push notifications to connected browsers', 'UI', 'All tiers', 'None', ''),
    ('Notifications', 'Proactive AI Alerts', 'AI-triggered risk/budget alerts', 'Backend', 'All tiers (budget-gated)', 'AI budget only', ''),
    ('Notifications', 'Notification Preferences', 'Per-channel control (email/app/Slack)', 'UI', 'All tiers', 'None', ''),

    # INTEGRATIONS
    ('Integrations', 'Slack Integration', 'Post updates, risks, reminders to Slack', 'UI', 'All tiers', 'None', ''),
    ('Integrations', 'Jira Integration', 'Sync tasks with Jira', 'Backend', 'All tiers', 'None', 'Adapter exists'),
    ('Integrations', 'Trello Integration', 'Sync Kanban boards with Trello', 'Backend', 'All tiers', 'None', 'Adapter exists'),
    ('Integrations', 'GitHub Integration', 'Link tasks to GitHub issues', 'Backend', 'All tiers', 'None', 'Adapter exists'),
    ('Integrations', 'Webhooks (Outbound)', 'Send events to external systems', 'UI', 'All tiers', 'None', ''),
    ('Integrations', 'MCP Integration', 'Connect to MCP servers for AI tools', 'UI', 'All tiers', 'None', ''),
    ('Integrations', 'API Keys', 'Programmatic API access', 'UI', 'Basic+', 'requireFeature(api_keys)', 'Trial gets sample'),
    ('Integrations', 'OAuth (Google/Microsoft)', 'Social sign-in', 'UI', 'All tiers', 'None', ''),

    # USER MANAGEMENT
    ('User Mgmt', '5 User Roles', 'Admin, PM, team_member, viewer, executive', 'UI', 'All tiers', 'None', '14 retained in backend for compat'),
    ('User Mgmt', '4 Project Roles', 'Owner, manager, editor, viewer', 'UI', 'All tiers', 'None', ''),
    ('User Mgmt', 'Org Management', 'Manage org name, members, billing', 'UI', 'All tiers', 'None', ''),
    ('User Mgmt', 'User Invites', 'Invite with auto-create + temp password', 'UI', 'All tiers', 'None', 'New: Sep 2026'),
    ('User Mgmt', 'Password Change/Reset', 'Change password, forgot password, forced change', 'UI', 'All tiers', 'None', ''),
    ('User Mgmt', 'Email Verification', 'Verify email on signup', 'UI', 'All tiers', 'None', ''),
    ('User Mgmt', 'Profile Management', 'Edit name, avatar, timezone', 'UI', 'All tiers', 'None', ''),
    ('User Mgmt', 'Multi-Tenant Isolation', 'Separate database per organization', 'Backend', 'All tiers', 'Automatic', ''),

    # BILLING
    ('Billing', 'Stripe Integration', 'Payment processing and subscription management', 'Backend', 'Paid tiers', 'Automatic', ''),
    ('Billing', 'Per-Seat Billing', 'SME quantity-based Stripe subscriptions', 'Backend', 'SME', 'Automatic', 'Min 3 seats'),
    ('Billing', 'Token Top-Ups', 'Buy 500K AI tokens for $10', 'UI', 'Pro+', 'Stripe checkout', ''),
    ('Billing', 'Billing Portal', 'Stripe customer portal for invoices', 'UI', 'Paid tiers', 'Automatic', ''),
    ('Billing', 'Trial (14 days)', 'Full access trial, 3 project limit, 0 AI tokens (samples only)', 'UI', 'Trial', 'Automatic', 'No credit card required'),

    # SETTINGS
    ('Settings', 'Theme (Light/Dark)', 'Toggle display theme', 'UI', 'All tiers', 'None', ''),
    ('Settings', 'Font Size', 'Adjustable font sizing slider', 'UI', 'All tiers', 'None', ''),
    ('Settings', 'Accessibility', 'Keyboard shortcuts, reduced motion, high contrast', 'UI', 'All tiers', 'None', 'WCAG 2.2 AA compliant'),
    ('Settings', 'Danger Zone', 'Delete account, leave org', 'UI', 'All tiers', 'None', ''),
    ('Settings', 'Viewer Invite Panel', 'Invite external viewers with limited access', 'UI', 'All tiers', 'None', ''),

    # ADMIN
    ('Admin', 'User Management', 'View all users, manage roles, deactivate', 'UI', 'Admin only', 'requireRole(admin)', ''),
    ('Admin', 'Tenant Management', 'View orgs, provisioning, billing', 'UI', 'Admin only', 'requireRole(admin)', ''),
    ('Admin', 'System Health', 'DB health, cache, service status', 'UI', 'Admin only', 'requireRole(admin)', ''),
    ('Admin', 'AI Usage Monitoring', 'Token usage by user/org, costs', 'UI', 'Admin only', 'requireRole(admin)', ''),
    ('Admin', 'Audit Trail', 'All user actions for compliance', 'UI', 'Admin only', 'requireRole(admin)', ''),
    ('Admin', 'Revenue Dashboard', 'MRR, churn, LTV metrics', 'UI', 'Admin only', 'requireRole(admin)', ''),
    ('Admin', 'Pricing Configuration', 'Edit tier pricing and feature limits', 'UI', 'Admin only', 'requireRole(admin)', ''),
    ('Admin', 'Waitlist Management', 'Manage pre-launch signups', 'UI', 'Admin only', 'requireRole(admin)', ''),
    ('Admin', 'Knowledge Base Mgmt', 'Manage docs and embeddings', 'UI', 'Admin only', 'requireRole(admin)', ''),
    ('Admin', 'Dead Letter Queue', 'View/replay failed async jobs', 'UI', 'Admin only', 'requireRole(admin)', ''),
    ('Admin', 'Operations Dashboard', 'Logs, errors, performance metrics', 'UI', 'Admin only', 'requireRole(admin)', ''),
    ('Admin', 'Feedback Management', 'User feedback and feature requests', 'UI', 'Admin only', 'requireRole(admin)', ''),

    # MARKETING / ONBOARDING
    ('Marketing', 'Landing Page', 'Public homepage with feature overview', 'UI', 'Public', 'None', ''),
    ('Marketing', 'Prelaunch Landing', 'Countdown timer + waitlist signup', 'UI', 'Public', 'None', ''),
    ('Marketing', 'Pricing Page', 'Tier comparison with checkout', 'UI', 'Public', 'None', ''),
    ('Marketing', 'Features Page', 'Feature showcase for marketing', 'UI', 'Public', 'None', ''),
    ('Marketing', 'About Page', 'Company info and mission', 'UI', 'Public', 'None', ''),
    ('Marketing', 'Roadmap Page', 'Public feature roadmap', 'UI', 'Public', 'None', ''),
    ('Marketing', 'Terms & Privacy', 'Legal compliance pages', 'UI', 'Public', 'None', ''),
    ('Marketing', 'User Guide', 'Public documentation', 'UI', 'Public', 'None', ''),
    ('Marketing', 'SME Onboarding', '4-step onboarding (Profile > Team > Project > Done)', 'UI', 'SME', 'Automatic', ''),
    ('Marketing', 'Starter Templates', '6 auto-seeded project templates', 'Backend', 'All tiers', 'Automatic', 'Seeded on tenant provisioning'),
    ('Marketing', 'Template Marketplace', 'Browse/use 14+ community templates', 'UI', 'All tiers', 'None', ''),

    # INFRASTRUCTURE
    ('Infrastructure', 'Data Retention & Purge', 'Auto-purge old data per retention policy', 'Backend', 'All tiers', 'Automatic', 'Cron-driven, 7 purge steps'),
    ('Infrastructure', 'Anomaly Detection', 'Detect velocity drops, cost spikes', 'Backend', 'All tiers', 'None', ''),
    ('Infrastructure', 'Redis Caching', 'Cache hot data with graceful fallback', 'Backend', 'All tiers', 'Automatic', ''),
    ('Infrastructure', 'Embedding Service', 'Generate embeddings for semantic search', 'Backend', 'All tiers', 'Automatic', 'Requires EMBEDDING_ENABLED'),
    ('Infrastructure', 'Vector Search', 'MariaDB native VEC_DISTANCE_COSINE', 'Backend', 'All tiers', 'Automatic', ''),
    ('Infrastructure', 'Rate Limiting', 'Per-user/IP API rate limits', 'Backend', 'All tiers', 'Automatic', ''),
    ('Infrastructure', 'Health Snapshot', 'Nightly metrics snapshot', 'Backend', 'All tiers', 'Automatic', 'Cron: daily 03:00'),
    ('Infrastructure', 'Trial Reminders', 'Email before trial expires', 'Backend', 'Trial', 'Automatic', 'Cron: daily 09:00'),
    ('Infrastructure', 'Weekly Review Pack', 'Friday summary email', 'Backend', 'All tiers', 'Automatic', 'Cron: Friday 17:00'),
    ('Infrastructure', 'Storage Sync', 'Periodically sync docs from cloud storage', 'Backend', 'All tiers', 'Automatic', 'Cron: every 15 min'),
    ('Infrastructure', 'Cookie Consent', 'GDPR compliance banner', 'UI', 'Public', 'None', ''),
    ('Infrastructure', 'Error Boundary', 'Graceful error handling in UI', 'UI', 'All tiers', 'Automatic', ''),
]

# Write data
row = 2
for i, (cat, feat, desc, vis, tier, gating, notes) in enumerate(features, 1):
    ws.cell(row=row, column=1, value=i).border = thin_border
    ws.cell(row=row, column=2, value=cat).border = thin_border
    ws.cell(row=row, column=3, value=feat).border = thin_border
    c4 = ws.cell(row=row, column=4, value=desc)
    c4.border = thin_border
    c4.alignment = wrap
    ws.cell(row=row, column=5, value=vis).border = thin_border
    c6 = ws.cell(row=row, column=6, value=tier)
    c6.border = thin_border
    ws.cell(row=row, column=7, value=gating).border = thin_border
    c8 = ws.cell(row=row, column=8, value=notes)
    c8.border = thin_border
    c8.alignment = wrap

    # Color-code tier
    for key, fill in TIER_FILLS.items():
        if key in tier:
            c6.fill = fill
            break

    row += 1

# --- Summary sheet ---
ws2 = wb.create_sheet('Summary')
ws2.column_dimensions['A'].width = 30
ws2.column_dimensions['B'].width = 12

summary = [
    ('FEATURE INVENTORY SUMMARY', ''),
    ('Total Features', len(features)),
    ('', ''),
    ('BY TIER GATE', 'Count'),
    ('All tiers (no gate)', sum(1 for f in features if f[4] == 'All tiers')),
    ('All tiers (AI budget-gated)', sum(1 for f in features if 'budget' in f[4])),
    ('Basic+ (paid)', sum(1 for f in features if 'Basic+' in f[4])),
    ('Paid tiers', sum(1 for f in features if f[4] == 'Paid tiers')),
    ('Pro+', sum(1 for f in features if 'Pro+' in f[4])),
    ('SME only', sum(1 for f in features if f[4] == 'SME')),
    ('Admin only', sum(1 for f in features if 'Admin' in f[4])),
    ('Public', sum(1 for f in features if 'Public' in f[4])),
    ('Trial only', sum(1 for f in features if f[4] == 'Trial')),
    ('', ''),
    ('BY CATEGORY', 'Count'),
]
cats = {}
for f in features:
    cats[f[0]] = cats.get(f[0], 0) + 1
for cat, count in sorted(cats.items(), key=lambda x: -x[1]):
    summary.append((cat, count))

for r, (label, val) in enumerate(summary, 1):
    c1 = ws2.cell(row=r, column=1, value=label)
    c2 = ws2.cell(row=r, column=2, value=val if val != '' else None)
    if r <= 2 or label in ('BY TIER GATE', 'BY CATEGORY'):
        c1.font = Font(bold=True, size=12)

# Freeze and filter
ws.freeze_panes = 'A2'
ws.auto_filter.ref = f'A1:H{row-1}'

output = r'C:\Users\gerog\Downloads\Kovarti_PM_Feature_Inventory_v3.xlsx'
wb.save(output)
print(f'Saved: {output}')
print(f'Total features: {len(features)}')
