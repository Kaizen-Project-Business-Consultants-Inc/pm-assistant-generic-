import React from 'react';
import {
  Rocket,
  FolderKanban,
  TrendingUp,
  FileText,
  Layers,
  Brain,
  Dice5,
  Workflow,
  MessageSquare,
  BookOpen,
  Search,
  CreditCard,
  Activity,
  Paperclip,
  Clock,
  SlidersHorizontal,
  Network,
  BarChart3,
  GitPullRequest,
  Link,
  BarChart2,
  Plug,
  Kanban,
  FileBarChart,
  ClipboardList,
  Key,
  Webhook,
  Settings,
  Bot,
  Layers3,
  Moon,
} from 'lucide-react';

interface Section {
  id: string;
  title: string;
  icon: React.ElementType;
  description: string;
  items: string[];
}

const sections: Section[] = [
  {
    id: 'getting-started',
    title: 'Getting Started',
    icon: Rocket,
    description:
      'Create your account, sign in, and get oriented with the dashboard.',
    items: [
      'Sign up with email and verify your account',
      'Log in and explore the main dashboard',
      'View project summaries, upcoming deadlines, and key metrics at a glance',
      'Use the sidebar to navigate between features',
    ],
  },
  {
    id: 'managing-projects',
    title: 'Managing Projects',
    icon: FolderKanban,
    description:
      'Create and manage projects with multiple visualization options.',
    items: [
      'Create new projects with name, dates, and budget',
      'Switch between Gantt, Kanban, Table, and Calendar views',
      'Add, edit, and delete tasks with dependencies',
      'Assign resources and track progress percentages',
      'Drag-and-drop tasks in Kanban and Gantt views',
    ],
  },
  {
    id: 'earned-value',
    title: 'Earned Value & Forecasting',
    icon: TrendingUp,
    description:
      'Track project health with Earned Value Management metrics and automated forecasting.',
    items: [
      'Monitor CPI, SPI, EAC, and other EVM indicators',
      'View S-curve charts comparing planned vs. actual progress',
      'Use auto-reschedule to adjust timelines based on current performance',
      'Identify cost and schedule variances early',
    ],
  },
  {
    id: 'reports',
    title: 'Reports',
    icon: FileText,
    description:
      'Generate comprehensive reports for stakeholders and decision-making.',
    items: [
      'Status reports with executive summaries',
      'Risk assessment reports with mitigation plans',
      'Budget tracking and variance analysis',
      'Resource utilization and allocation reports',
    ],
  },
  {
    id: 'portfolio',
    title: 'Portfolio View',
    icon: Layers,
    description:
      'Get a bird\u2019s-eye view across all your projects.',
    items: [
      'Cross-project Gantt chart for timeline comparison',
      'Portfolio health dashboard with red/amber/green indicators',
      'Aggregate budget and resource utilization',
      'Filter and sort projects by status, priority, or health',
    ],
  },
  {
    id: 'intelligence',
    title: 'Intelligence',
    icon: Brain,
    description:
      'AI-powered scenario modeling and risk analysis tools.',
    items: [
      'Scenario modeling to compare what-if plans',
      'Risk heatmap for visual risk prioritization',
      'Budget analysis with trend detection',
      'Anomaly detection to flag unusual project patterns',
    ],
  },
  {
    id: 'monte-carlo',
    title: 'Monte Carlo Simulation',
    icon: Dice5,
    description:
      'Run probabilistic simulations to forecast project outcomes.',
    items: [
      'Configure and run simulations with custom parameters',
      'View confidence levels for completion dates and budgets',
      'Sensitivity analysis to identify highest-impact variables',
      'Export simulation results for stakeholder presentations',
    ],
  },
  {
    id: 'workflows',
    title: 'Workflows',
    icon: Workflow,
    description:
      'Automate repetitive actions with trigger-based rules.',
    items: [
      'Create automation rules with triggers and actions',
      'Trigger on task status changes, date thresholds, or budget alerts',
      'Actions include notifications, status updates, and assignments',
      'Enable or disable rules without deleting them',
    ],
  },
  {
    id: 'meetings',
    title: 'Meeting Intelligence',
    icon: MessageSquare,
    description:
      'Upload meeting transcripts and let AI extract key information.',
    items: [
      'Upload or paste meeting transcripts',
      'AI extracts action items, decisions, and risks',
      'Link extracted items directly to project tasks',
      'Search and review past meeting notes',
    ],
  },
  {
    id: 'lessons-learned',
    title: 'Lessons Learned',
    icon: BookOpen,
    description:
      'Capture project insights and discover patterns across your portfolio.',
    items: [
      'Record lessons with category, impact, and recommendations',
      'AI pattern analysis to surface recurring themes',
      'Filter by project, category, or time period',
      'Share insights across teams to prevent repeated mistakes',
    ],
  },
  {
    id: 'ask-ai',
    title: 'Ask AI',
    icon: Search,
    description:
      'Query your project data using natural language.',
    items: [
      'Ask questions like "Which projects are over budget?"',
      'AI generates charts and tables from your data',
      'Get contextual recommendations and insights',
      'Export AI-generated visualizations',
    ],
  },
  {
    id: 'agent-activity',
    title: 'Agent Activity',
    icon: Activity,
    description:
      'See what each AI agent decided for your project and why.',
    items: [
      'View the "Agent Activity" tab on any project detail page',
      'Each agent run logs its decision: alert created, skipped, or error',
      'Filter by agent (Auto-Reschedule, Budget, Monte Carlo, Meeting)',
      'Summaries explain why an alert was or wasn\'t created (e.g., thresholds, metrics)',
      'Paginated log with timestamps for full audit trail',
    ],
  },
  {
    id: 'file-attachments',
    title: 'File Attachments',
    icon: Paperclip,
    description:
      'Attach files to projects and tasks with drag-and-drop uploading and version history.',
    items: [
      'Drag and drop files onto the attachment panel or click to browse',
      'Attach files to projects (in the Overview tab) or individual tasks (in the task editor)',
      'Preview images and PDFs directly in the browser',
      'Upload new versions of a file and view version history',
      'Download or delete attachments at any time',
    ],
  },
  {
    id: 'time-tracking',
    title: 'Time Tracking & Timesheets',
    icon: Clock,
    description:
      'Log time against tasks and review weekly timesheets with estimated-vs-actual comparisons.',
    items: [
      'Open any task and click "Log Time" to record hours, date, and description',
      'Mark entries as billable or non-billable',
      'Navigate to Timesheets from the sidebar for a weekly grid view',
      'Use prev/next arrows to move between weeks',
      'Switch to "Project Summary" tab to see actual vs. estimated hours per task',
    ],
  },
  {
    id: 'custom-fields',
    title: 'Custom Fields',
    icon: SlidersHorizontal,
    description:
      'Define project-specific fields (text, number, date, dropdown, checkbox) for tasks and projects.',
    items: [
      'In the project Overview tab, use "Custom Fields (task)" to define fields',
      'Choose from Text, Number, Date, Dropdown, or Checkbox types',
      'For dropdowns, add option values in the field editor',
      'Mark fields as required to enforce data entry',
      'Custom field values auto-save on blur when editing tasks or projects',
    ],
  },
  {
    id: 'network-diagram',
    title: 'Network Diagram',
    icon: Network,
    description:
      'Visualize task dependencies as an interactive network (precedence) diagram with critical path highlighting.',
    items: [
      'Open the "Network Diagram" tab on any project with dependencies',
      'Critical path tasks and edges are highlighted in red',
      'Hover over any node to see ES, EF, LS, LF, and total float values',
      'Zoom with the mouse wheel and pan by dragging',
      'Click "Fit to Screen" to auto-size the diagram',
    ],
  },
  {
    id: 'burndown-charts',
    title: 'Burndown & Velocity Charts',
    icon: BarChart3,
    description:
      'Track project progress with burndown/burnup lines and team velocity trends.',
    items: [
      'Open the "Burndown" tab on any project',
      'View KPI cards: total scope, % complete, velocity, and estimated completion',
      'Burndown chart shows ideal line (dashed), actual remaining (indigo), and completed (green)',
      'A "Today" marker shows current position in the timeline',
      'Velocity chart shows tasks completed per week with an average velocity line',
    ],
  },
  {
    id: 'approval-workflows',
    title: 'Approval Workflows & Change Requests',
    icon: GitPullRequest,
    description:
      'Define multi-step approval workflows and manage formal change requests with full audit trails.',
    items: [
      'Open the "Change Requests" tab on any project',
      'Click "Manage Workflows" to define approval steps with roles and actions',
      'Create a change request with title, description, category, priority, and impact summary',
      'Submit a CR for approval — it progresses through each workflow step',
      'Approvers can approve, reject, or return CRs with comments',
      'View the full approval timeline showing who acted at each step',
    ],
  },
  {
    id: 'client-portal',
    title: 'Client / Stakeholder Portal',
    icon: Link,
    description:
      'Share read-only project views with clients and stakeholders via secure portal links.',
    items: [
      'In the project Overview tab, use the Portal Links section to create a link',
      'Set permissions: Gantt view, budget visibility, commenting, and reports',
      'Optionally set an expiration date for the link',
      'Copy the link and share it — no login required for recipients',
      'Stakeholders see a branded dashboard with project status, tasks, and timeline',
      'If commenting is enabled, stakeholders can leave feedback with their name',
    ],
  },
  {
    id: 'resource-leveling',
    title: 'Resource Leveling',
    icon: BarChart2,
    description:
      'Identify over-allocated resources and automatically level workload by adjusting non-critical tasks.',
    items: [
      'Open the "Resource Leveling" tab on any project',
      'View the resource histogram showing daily demand per resource',
      'Red bars indicate over-allocated periods (demand > 8 hours/day)',
      'Click "Level Resources" to compute proposed schedule adjustments',
      'Review the before/after comparison and adjustment details',
      'Click "Apply" to update task dates and resolve over-allocations',
    ],
  },
  {
    id: 'external-integrations',
    title: 'External Integrations',
    icon: Plug,
    description:
      'Connect with Jira, GitHub, Slack, and Trello to sync tasks and send notifications.',
    items: [
      'Navigate to Integrations from the sidebar',
      'Click "Connect" on a provider card and enter your API credentials',
      'Use "Test Connection" to verify your credentials work',
      'Trigger a sync to pull issues/cards into your project or push tasks out',
      'View sync history to monitor successful and failed syncs',
      'Slack integration sends formatted project update notifications',
    ],
  },
  {
    id: 'sprint-planning',
    title: 'Sprint Planning / Agile Mode',
    icon: Kanban,
    description:
      'Plan sprints, manage backlogs, track velocity, and use Kanban boards for agile workflows.',
    items: [
      'Open the "Sprints" tab on any project',
      'Create a sprint with name, goal, date range, and velocity commitment',
      'Use the planning view to drag tasks from the backlog into the sprint',
      'Assign story points to each sprint task for capacity tracking',
      'Start the sprint and use the Kanban board to track progress (Todo → In Progress → Done)',
      'View sprint burndown charts and velocity history across completed sprints',
    ],
  },
  {
    id: 'report-builder',
    title: 'Custom Report Builder',
    icon: FileBarChart,
    description:
      'Design custom reports with KPI cards, tables, and charts, then export to CSV or PDF.',
    items: [
      'Navigate to Report Builder from the sidebar',
      'Create a new report template with a name and description',
      'Add sections: KPI Card, Table, Bar Chart, Line Chart, or Pie Chart',
      'Configure each section with a data source (projects, tasks, time, budgets) and filters',
      'Set group-by options to aggregate data by project, resource, status, or time period',
      'Generate the report to see a live preview, then export as CSV or print as PDF',
    ],
  },
  {
    id: 'project-intake',
    title: 'Project Intake Forms',
    icon: ClipboardList,
    description:
      'Create intake form templates, collect project requests, review submissions, and convert approved requests into projects.',
    items: [
      'Navigate to Intake from the sidebar',
      'Create a form template with custom fields (text, number, date, dropdown, textarea, checkbox)',
      'Share the form — any team member can fill it out and submit a project request',
      'Review submissions in the Submissions tab with approve/reject/notes workflow',
      'Convert approved submissions directly into new projects with one click',
      'Track submission status: Submitted → Under Review → Approved → Converted',
    ],
  },
  {
    id: 'settings',
    title: 'Settings',
    icon: Settings,
    description:
      'Manage your profile, notification preferences, display options, API keys, and webhooks.',
    items: [
      'Profile tab: update your display name, email, and password',
      'Notifications tab: configure which email and in-app notifications you receive',
      'Display tab: toggle dark mode and adjust interface preferences',
      'API Keys tab: create and manage API keys for external agent access',
      'Webhooks tab: register webhook URLs to receive real-time event notifications',
      'Danger Zone: delete your account (irreversible)',
    ],
  },
  {
    id: 'api-keys',
    title: 'API Keys & External Agent Access',
    icon: Key,
    description:
      'Create API keys so external AI agents or scripts can authenticate and interact with the application programmatically.',
    items: [
      'Navigate to Settings → API Keys tab to create a new key',
      'Choose a name and select scopes: read, write, or admin',
      'The full API key (kpm_...) is shown only once — copy it immediately',
      'Use the key as a Bearer token: Authorization: Bearer kpm_...',
      'Each key has its own rate limit (default 100 requests/minute)',
      'Rate limit headers (X-RateLimit-Limit, X-RateLimit-Remaining, X-RateLimit-Reset) are included in every API response',
      'Revoke a key at any time — it is immediately invalidated',
      'View usage statistics per key including request counts and average response times',
    ],
  },
  {
    id: 'webhooks',
    title: 'Webhooks',
    icon: Webhook,
    description:
      'Register webhook endpoints to receive real-time HTTP POST notifications when events occur in your projects.',
    items: [
      'Navigate to Settings → Webhooks tab to register a new webhook',
      'Provide a URL and select which events to subscribe to',
      'Supported events: task.created, task.updated, task.deleted, project.created, project.updated, proposal.created, proposal.accepted, agent.scan_completed',
      'Each webhook receives an HMAC-SHA256 signature in the X-Signature header for verification',
      'Use the "Test" button to send a test ping to your endpoint',
      'Webhooks auto-disable after 5 consecutive delivery failures',
      'View failure count and last status code for troubleshooting',
    ],
  },
  {
    id: 'bulk-operations',
    title: 'Bulk Operations',
    icon: Layers3,
    description:
      'Perform batch operations on tasks via the API for efficient large-scale updates.',
    items: [
      'POST /api/v1/bulk/tasks — create up to 100 tasks in a single request',
      'PUT /api/v1/bulk/tasks — update multiple tasks with individual field changes',
      'PUT /api/v1/bulk/tasks/status — batch update the status of multiple tasks at once',
      'All bulk endpoints return { succeeded, failed } arrays with per-item error details',
      'Operations run within a database transaction for consistency',
    ],
  },
  {
    id: 'dark-mode',
    title: 'Dark Mode',
    icon: Moon,
    description:
      'Switch between light and dark themes for comfortable viewing in any environment.',
    items: [
      'Toggle dark mode from the top navigation bar (moon/sun icon)',
      'Or set your preference in Settings → Display tab',
      'Dark mode applies across all pages, charts, and dialogs',
      'Your preference is saved and persists across sessions',
    ],
  },
  {
    id: 'agent-api',
    title: 'Agent API Overview',
    icon: Bot,
    description:
      'A summary of the full REST API surface available for external AI agents and automation scripts.',
    items: [
      'All application features are accessible via REST API at /api/v1/*',
      'Authenticate with Bearer token (API key) or JWT cookie',
      'OpenAPI/Swagger documentation available at /documentation',
      'API endpoints cover: projects, tasks, schedules, AI chat, reports, sprints, approvals, integrations, search, and more',
      'Analytics summary endpoint: GET /api/v1/analytics/summary returns pre-computed KPIs, trends, and at-risk projects',
      'Rate limiting protects the server — monitor X-RateLimit-* headers in responses',
      'Webhook callbacks deliver real-time event notifications to your agent',
      'Bulk endpoints enable efficient batch operations (up to 100 items per request)',
    ],
  },
  {
    id: 'account-billing',
    title: 'Account & Billing',
    icon: CreditCard,
    description:
      'Manage your subscription, billing, and account settings.',
    items: [
      'View current plan and usage',
      'Upgrade, downgrade, or cancel your subscription',
      '14-day free trial on paid tiers',
      'Manage payment methods via Stripe portal',
    ],
  },
];

export const UserGuideContent: React.FC = () => {
  return (
    <div className="max-w-4xl mx-auto">
      <h1 className="text-3xl font-bold text-gray-900 dark:text-white mb-2">User Guide</h1>
      <p className="text-gray-500 dark:text-gray-400 mb-8">
        Everything you need to know to get the most out of Kovarti PM.
      </p>

      {/* Table of Contents */}
      <nav className="bg-gray-50 dark:bg-gray-900 rounded-xl p-6 mb-10 border border-gray-200 dark:border-gray-700">
        <h2 className="text-sm font-semibold text-gray-500 dark:text-gray-400 uppercase tracking-wider mb-3">
          Contents
        </h2>
        <ol className="grid grid-cols-1 sm:grid-cols-2 gap-x-6 gap-y-1.5">
          {sections.map((s, i) => (
            <li key={s.id}>
              <a
                href={`#${s.id}`}
                className="text-sm text-primary-600 dark:text-primary-400 hover:text-primary-800 hover:underline"
              >
                {i + 1}. {s.title}
              </a>
            </li>
          ))}
        </ol>
      </nav>

      {/* Sections */}
      <div className="space-y-10">
        {sections.map((s) => {
          const Icon = s.icon;
          return (
            <section key={s.id} id={s.id} className="scroll-mt-24">
              <div className="flex items-center gap-3 mb-3">
                <div className="w-9 h-9 rounded-lg bg-primary-100 dark:bg-primary-900/40 flex items-center justify-center flex-shrink-0">
                  <Icon className="w-5 h-5 text-primary-600 dark:text-primary-400" />
                </div>
                <h2 className="text-xl font-semibold text-gray-900 dark:text-white">
                  {s.title}
                </h2>
              </div>
              <p className="text-gray-600 dark:text-gray-300 mb-3">{s.description}</p>
              <ul className="list-disc list-inside space-y-1 text-sm text-gray-600 dark:text-gray-300">
                {s.items.map((item, idx) => (
                  <li key={idx}>{item}</li>
                ))}
              </ul>
            </section>
          );
        })}
      </div>
    </div>
  );
};

export const UserGuidePage: React.FC = () => {
  return (
    <div className="p-6 md:p-10">
      <UserGuideContent />
    </div>
  );
};
