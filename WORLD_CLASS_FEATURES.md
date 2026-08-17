# World-Class Features Roadmap

## Vision
An agentic AI project management platform that combines the scheduling power of Primavera P6, the usability of Monday.com/Smartsheet, and autonomous AI agents that no competitor offers. 14 agents continuously detect, reason, and act — with human-in-the-loop governance and full audit trails.

## Benchmarked Against
- Oracle Primavera P6 (enterprise scheduling, EVM, critical path)
- Microsoft Project (Gantt, resource leveling, baselines)
- Monday.com (UX, automation, collaboration)
- Wrike (AI features, resource management)
- Smartsheet (portfolio management, dashboards)
- Asana (workload management, goals)

---

## Priority 1: Table Stakes (Must-Have to Be Taken Seriously)

### 1.1 Critical Path Method (CPM)
- Auto-calculate forward/backward pass (ES, EF, LS, LF)
- Total float and free float per task
- Highlight critical path on Gantt chart (red bars)
- Recalculate on demand via API and UI toggle
- **Benchmark:** Primavera P6, MS Project

### 1.1b Task Constraints (CPM)
- 8 constraint types: ASAP, ALAP, SNET, SNLT, FNET, FNLT, MSO, MFO
- Constraints enforced in CPM forward/backward pass
- Inline editing in Table view (dropdown + date picker)
- Task Form modal constraint section with conditional date field
- **Benchmark:** MS Project, Primavera P6

### 1.1c Task-Level Budget
- Budget Allocated and Actual Cost per task (DECIMAL 12,2)
- Cost Variance = Budget - Actual (color-coded green/red)
- Inline editable in Table view Cost column group
- Budget fields in Task Form modal
- Summary task budget auto-rollup from children
- **Benchmark:** MS Project

### 1.1d Summary Task Auto-Rollup
- Parent tasks auto-compute dates, progress, status, budget from children
- Recompute-on-write pattern (create/update/delete triggers rollup up the chain)
- Rollup fields read-only in UI (greyed cells, disabled form fields)
- Gantt renders summary tasks with diamond endpoint markers
- Recursive rollup up to 10 levels deep
- **Benchmark:** MS Project, Primavera P6

### 1.1e Custom Calendars (Working Days)
- Per-project calendars with configurable working days (Mon-Sun checkboxes)
- Hours per day setting
- Holiday exceptions (specific dates as non-working)
- Working exceptions (override non-working days as working)
- CRUD API for calendars and exceptions
- Non-working dates API for Gantt shading
- **Benchmark:** MS Project, Primavera P6

### 1.1f Multi-Resource Assignment
- Multiple resources per task (up to 10)
- Allocation percentage (1-100%) per resource
- Role on task label
- Planned hours per assignment
- Primary assignee denormalized for backward compatibility
- Task Form modal multi-resource editor
- **Benchmark:** MS Project, Primavera P6

### 1.2 Baseline Management
- Save schedule baseline snapshots (planned start, planned end, progress)
- Database-persisted baselines survive server restarts (`schedule_baselines` + `baseline_tasks` tables)
- Compare baseline vs actual on Gantt (dual bars)
- Start, end, and duration variance analysis per task
- Multiple baseline support (Baseline 1, 2, 3...)
- Baseline comparison report
- **Benchmark:** Primavera P6, MS Project

### 1.3 Full Earned Value Management (EVM)
- Planned Value (PV / BCWS)
- Earned Value (EV / BCWP)
- Actual Cost (AC / ACWP)
- Cost Performance Index (CPI = EV/AC)
- Schedule Performance Index (SPI = EV/PV)
- Estimate at Completion (EAC)
- Estimate to Complete (ETC)
- To-Complete Performance Index (TCPI)
- Variance at Completion (VAC)
- S-Curve visualization (PV vs EV vs AC over time)
- **Benchmark:** Primavera P6

### 1.4 Gantt Timescale Zoom, Resizable Splitter & Inline Grid Editing
- Five zoom levels: Day (32px/day), Week (10px/day), Month (3.2px/day), Quarter (1.2px/day), Year (0.27px/day)
- Two-tier timescale header (upper tier: coarser unit, lower tier: finer unit)
- Segmented zoom control in toolbar (D | W | M | Q | Y)
- Draggable splitter between task table and timeline (width persists per schedule)
- 11 columns in left panel: #, Task Name, Pred, Start, End, Duration, Est Days, %, Priority, Assigned, Status
- Zoom and splitter width persist per schedule via localStorage
- **Inline grid editing** — click any cell to edit directly in the left panel (11 editable fields: name, predecessor, start, end, duration, est days, work effort hours, %, priority, assigned, status). Tab/Shift+Tab navigates across cells and rows. Duration edits auto-compute end date. Enter saves, Escape cancels, blur auto-saves, green flash confirms success. Input types match field: text, date picker, number, select dropdown, MS Project predecessor notation.
- **Cross-parent row drag reorder** — drag any task to any row position; tasks re-parent automatically to match the drop target (MSP-style free drag). Dropping on a summary task inserts as first child; dropping between tasks makes a sibling. Summary tasks move with their entire subtree. Cycle prevention blocks invalid drops. Sort order and parent changes are undoable.
- **Benchmark:** MS Project, Primavera P6 — matches P6/MS Project zoom + dual header + resizable splitter + inline cell editing + cross-parent drag reorder

### 1.5 Kanban Board View
- Toggle between Gantt / Kanban / Table views
- Columns by status (Pending, In Progress, Completed, Cancelled)
- Drag-and-drop cards between columns
- Card shows: task name, assignee, priority, due date, progress, subtask count badge, dependency count badge
- **Inline quick-add** per column — create tasks without opening a modal
- **Swimlane mode** — group by Assignee or Priority; persists in localStorage
- **Benchmark:** Monday.com, Jira, Asana — **matches** with swimlanes and inline quick-add

### 1.6 Resource Pool & Workload View
- Resource pool: list all team members with roles and capacity
- Assign resources to tasks with effort hours
- Workload heatmap: visual capacity per person per week
- Over-allocation detection and warnings
- **Assignment conflict detection**: Pre-flight capacity check on `POST /resources/assignments` — sums overlapping assignment hours and warns when exceeding resource capacity (advisory, non-blocking)
- Resource utilization percentage
- **Cost rollup**: Workload endpoint computes per-resource and per-project costs from `costRateHourly × allocated hours`. Workload heatmap displays Cost column per resource; Estimated Cost summary card shown when cost data is available; weekly cell tooltips include cost
- Paginated list endpoints (`?limit=&offset=`, max 200, default 50) on resources, projects, schedule tasks, sprints, and templates — shared `paginationSchema` with `PaginatedResponse<T>` format (data, total, page, pageSize, totalPages)
- Dedicated Resource Management page (`/resources`) with project selector, summary cards (including Estimated Cost), and four tabs: Team (full resource table with create/edit/delete CRUD), Workload Heatmap (color-coded weekly utilization grid with cost column), Resource Histogram (SVG bar charts with 8h capacity line), Capacity Forecast (8-week bottleneck predictions + AI recommendations)
- **Benchmark:** MS Project, Wrike, Asana

### 1.6a Gantt Overallocation Warnings & Minimap
- **Overallocation warnings**: Toggle "Overalloc" button in Gantt toolbar; client-side detection of overlapping assignments per resource; amber 2px border + glow + "!" dot on flagged bars; count badge on toolbar button; legend entry
- **Minimap**: 200×80px overview panel (bottom-right); colored rectangles per task matching status colors; semi-transparent blue viewport rectangle tracks scroll position; click/drag to scroll timeline proportionally; enabled by default, toggleable via "Map" button
- **Benchmark:** MS Project (overallocation indicators), Primavera P6 (minimap navigation)

### 1.6b Comments & Activity Feed
- Comment thread on each task
- Activity feed: auto-log all changes (status, assignee, dates, etc.)
- Timestamp and user attribution
- **Benchmark:** All top tools

### 1.7 Export Capabilities
- Export project summary report to PDF (browser print)
- Export project data to CSV
- Export project as MSPDI XML (compatible with MS Project and ProjectLibre)
  - Tasks with UID, Name, WBS, OutlineLevel, Start, Finish, Duration, Milestone, Summary, PercentComplete, PredecessorLinks
  - Resources extracted from assignedTo, Assignments linking tasks to resources
  - Dependency types: FS=1, FF=0, SS=2, SF=3; lag in tenths-of-minutes
  - Duration format: PT{days×8}H0M0S
- **Benchmark:** All top tools; MSPDI export matches MS Project, Primavera P6

---

## Priority 2: Competitive Differentiators

### 2.1 Auto-Scheduling Engine
- Move one task -> cascade all dependent tasks automatically
- Respect all four dependency types (FS, SS, FF, SF) and lag days across multiple predecessors
- Up to 20 predecessors per task; cascades compute the correct early start by taking the maximum constraint from all predecessors
- Remove individual dependencies or bulk-clear all dependencies in a schedule via API, AI agent, and MCP tools
- **Benchmark:** MS Project, Primavera P6

### 2.2 Workflow Automation Builder (DAG Engine)
- Declarative DAG-based workflow engine with DB persistence
- **Natural Language Builder:** "Generate with AI" input — describe automation in plain English, AI returns a structured DAG definition (nodes + edges) for preview and editing before save (`POST /api/v1/workflows/generate`)
- Node types: trigger, condition, action, approval gate, delay, agent
- Triggers: status_change, progress_threshold, date_passed, task_created, priority_change, assignment_change, dependency_change, budget_threshold, project_status_change, manual
- Event-driven: task create/update and project budget/status changes automatically fire matching workflows
- Conditions: field-based evaluation with operators (equals, greater_than, contains, etc.)
- Actions: update_field, log_activity, send_notification (real notifications via NotificationService), invoke_agent
- Agent nodes: invoke registered AI agent capabilities inline with retry logic and backoff
- Approval gates: pause execution until resumed via API/UI
- Multi-step workflows with branching (yes/no edges on conditions)
- Persistent execution history with per-node status tracking
- 15-minute overdue-task scanner triggers date_passed workflows automatically
- Cycle protection, graceful degradation, audit integration
- 5 DB tables: workflow_definitions, workflow_nodes, workflow_edges, workflow_executions, workflow_node_executions
- **Benchmark:** Monday.com, Wrike, Smartsheet (exceeds with DAG support + approval gates + agent nodes + NL builder)

### 2.3 Custom Dashboards
- Role-based dashboards (PM project list, Executive analytics)
- Executive view: portfolio charts, KPI cards, status summaries
- **On Track percentage** uses actual schedule variance (SPI) and budget variance instead of a progress-threshold heuristic, accurately reflecting project health
- Widget drag-to-reorder: drag handle (grip icon) on hover, blue ring drop indicator, order persisted in localStorage (separate from visibility toggles)
- Auto-refresh via WebSocket cache invalidation
- **Benchmark:** Monday.com, Smartsheet

**Dashboard & Projects**
- **Dashboard** (`/dashboard`) — 6 KPI tiles with status dots, 7-day trend arrows, and enriched drill-in pages (summary cards, trend badges, distribution bars, health sparklines + sub-scores). Portfolio Intelligence banner with trend context, Action Center (confidence/risk/health badges on actions), Projects Table, Issues Trend, Milestones, Budget Watch (portfolio summary + burn-rate indicators), Sprint Velocity (delta % + commitment ratio), Activity Feed with filter pills and date grouping. Customizable via widget dropdown (includes opt-in Sprint Snapshot, Goals Progress, Team Workload with overallocation warnings).
- **Projects** (`/projects`) — Filterable card grid with health-based borders. Cards link to `/project/:id` for full Gantt/Kanban/Calendar/EVM detail.

### 2.4 Real-Time Collaboration
- Real-time task updates (WebSocket) with project-scoped broadcast (task events only reach clients viewing that project)
- Real-time presence indicators via shared `PresenceIndicator` component (`avatars` and `chip` variants, `role="status"`, `aria-live="polite"`, `motion-reduce:animate-none`)
- Presence is ephemeral (server in-memory), auto-cleans on disconnect, auto-rejoins on reconnect
- WebSocket `presence:join` requires project membership (admin/executive/pmo bypass); unauthorized join returns `presence:error`
- Per-user connection limit (5 connections per user, 2,000 global cap); ping/pong keepalive (30s/10s)
- Project-scoped query invalidation: task create/update/delete only invalidates queries for the affected schedule, not all cached task data
- **Benchmark:** Monday.com, Smartsheet

### 2.5 Calendar & Table Views
- **Calendar view** with three display modes: Month (default with drag-to-reschedule), Week (7-column with full task cards), Day (single-day detail view). Toggle via header buttons. Navigation arrows and Today button in all modes. Drag-to-reschedule preserves task duration.
- **Table view** with inline editing (spreadsheet-like), full feature parity with Gantt: right-click context menu (Insert Before/After, Edit, Indent, Outdent, Delete), Tab/Shift+Tab indent/outdent, Delete key with confirmation modal, undo/redo buttons and Ctrl+Z/Y support, bulk operations routed through undo history
- MS Project-style column picker: 23 columns across 4 groups (Standard, Scheduling/CPM, Baseline, Other)
- **Notes column** — maps to task description field, available in both Table view and Gantt left panel. Click any Notes cell to open a floating popup editor with a full textarea, Save/Cancel buttons, and auto-save on click-away. Hidden by default; toggle via column picker.
- **Resource auto-creation on import** — CSV/Excel import automatically creates resource entries for any new assignee names found in the data. Import result shows "X resources added."
- **Row number (#) column** — always visible, sequential numbering, cannot be toggled off
- **Multi-predecessor support** — up to 20 predecessors per task, each with its own type (FS/SS/FF/SF) and lag days, stored in a `task_dependencies` junction table
- **MS Project-style predecessor display** — comma-separated compact row-number notation (e.g. "3FS+2d,5SS,7") instead of full task names; same format used in CSV export
- **Dependency health badges** — colour-coded dots (green/yellow/red) per predecessor showing completion status. No other PM tool shows dependency health inline.
- **Inline predecessor editing** — click and type comma-separated row numbers with optional type and lag; validated with error feedback
- **Task form multi-predecessor UI** — add/remove dependency rows in the task modal, each with predecessor selector, type dropdown, and lag field
- **Server-side dependency validation** — single `validateDependency()` method enforces self-reference, circular, cross-schedule, existence, and 20-predecessor limit checks across API, UI, and AI tools. Orphan cleanup via `ON DELETE CASCADE` on task deletion.
- Column visibility persisted per schedule in localStorage
- CPM columns (Early Start, Late Finish, Total Float, etc.) auto-trigger critical path computation
- Baseline variance columns populate when comparison is active
- WBS auto-computed from task hierarchy
- Column sorting on all numeric and date fields
- Saved Views: name and store column+sort configurations per schedule, load/update/delete from dropdown
- **Table group-by** — group rows by Status, Priority, or Assignee with collapsible group headers
- **Table MPP-style empty rows** — 5-8 persistent empty rows at bottom (MS Project style); click Task Name cell and type, Enter creates task; continuation row numbers
- **Gantt MPP-style inline entry** — 3-6 persistent empty rows in the Gantt left panel; type a task name and press Enter to create inline; also shows Add Task button when schedule is empty
- **Gantt click-to-select then edit** — first click selects a row, second click enters inline edit (matches MS Project); Ctrl+click / Shift+click multi-select (like Excel); Tab/Shift+Tab indent/outdent works on single or multi-selected rows; Delete key shows a confirmation modal with exact count ("Delete N tasks?"); right-click on a multi-selected row shows "Delete N Tasks" in context menu — both paths use ConfirmModal, not browser `window.confirm()`
- **Table View arrow key navigation** — Arrow keys navigate between cells (focused cell gets a blue ring); Enter/F2 to edit, Escape to unfocus; click-to-select then click-to-edit pattern matches Gantt; cell-level Ctrl+C/V copies and pastes values between cells of the same field type
- **Copy/Paste rows** — in both Table View and Gantt Chart, when no cell is focused Ctrl+C copies selected/active task(s) and Ctrl+V pastes them as duplicates with "(copy)" suffix; uses `onDuplicateTasks` prop
- **Resource column in Table View** — the `ResourceQuickAssign` column (inline chip assignment, "+" dropdown, hover-remove) is now available in Table View via column picker, previously Gantt-only
- **Column auto-fit** — double-click any column resize handle in Table View or Gantt Chart to auto-fit width to content; canvas `measureText` measurement, capped at 400px
- **Undo/redo for delete** — delete operations (single or bulk) are fully undoable via Ctrl+Z; task data is captured before deletion so undo recreates tasks via the API; redo (Ctrl+Y / Ctrl+Shift+Z) re-deletes; stack holds 50 actions per session, resets on navigation; creating new tasks is not undoable
- **Cross-view filter bar** — search by name, filter by status/priority/assignee, CSV export of filtered tasks. Applies to all views (Gantt, Kanban, Calendar, Table).
- **Gantt row action icons** — edit, insert-below, and delete icons on each row (hover to reveal); delete icon respects multi-select — deletes the full selection when multiple tasks are selected
- **Mobile schedule view** — view switcher (List/Kanban/Calendar) with swipe-to-complete gesture and tap-to-cycle status on task cards
- **Benchmark:** MS Project, Smartsheet, Monday.com — **exceeds MS Project** with multi-predecessor support, health badges, inline predecessor editing, calendar drag-to-reschedule, and mobile swipe gestures

### 2.6 Portfolio Dashboard
- Full portfolio dashboard with 6 KPI cards: Total Projects, Active, On Track, At Risk, Budget Allocated, Budget Spent
- Status filter pills to narrow the project card grid (All / Active / On Hold / Planning / Completed)
- Aggregate portfolio budget progress bar (allocated vs. spent)
- Per-project cards with health indicator, progress bar, task completion ratio, and budget utilization bar
- Dashboard / Timeline toggle preserving the original multi-project Gantt view
- Server-side aggregation via `/api/v1/reporting/portfolio` returning `budgetAllocated`, `budgetSpent`, `progressPercentage`, `totalTasks`, `completedTasks` per project
- **Portfolio Analytics** via `/api/v1/reporting/portfolio/analytics`: cross-project CPI/SPI comparison table with SVG sparkline trends (last 8 weeks), burndown trend sparklines per project (ideal vs. actual), and sortable project comparison matrix (health, CPI, SPI, budget %, progress, tasks). Redis-cached (5 min), bounded concurrency (5 projects in parallel), graceful fallbacks for missing data.
- **Benchmark:** Primavera P6, Smartsheet, Monday.com — **exceeds** with EVM-based portfolio analytics (CPI/SPI sparklines, cross-project comparison matrix) alongside budget KPI cards and per-project health cards

### 2.7 Advanced Security
- Role-based access control (14 roles: admin, executive, project_manager, team_member, scrum_master, finance_officer, risk_manager, pmo, ba, qa, tester, devops, claude_sme, viewer) with project member roles (owner, manager, editor, viewer)
- Two-layer authorization: `requireScope` (read/write/admin) gates action type; `requireProjectAccess` (owner/manager/editor/viewer) gates project membership. Delete operations on project entities require `write` scope (not admin), keeping admin scope reserved for system-level operations (kill switches, agent policies, feedback)
- MCP tool permission matrix: 83 tools filtered by user role at registration time (agents only see permitted tools)
- Append-only chained audit ledger with API search, filter, and pagination
- Data encryption at rest and in transit
- Per-tier AI token budget enforcement (`AIBudgetService`) — tier-aware limits (Trial: 25K, Consultant: 500K, SME: 1.5M, Enterprise: 5M), per-user admin overrides, purchasable token top-ups (500K/$5, FIFO consumption, no expiry), graceful degradation on exhaustion (HTTP 429 with reset date, non-AI features unaffected), `GET /api/v1/ai/budget` usage endpoint, automatic enforcement before every AI call, proactive 80% threshold warning notification (daily-deduped)
- Zod validation on 24 route files covering all critical API inputs
- **Benchmark:** Enterprise tools

---

## Priority 3: AI Moat (What Nobody Else Has)

### 3.1 AI Auto-Rescheduling
- Detect delays automatically
- AI proposes new schedule minimizing total project impact
- One-click accept or modify AI suggestion

### 3.2 Predictive Resource Optimizer
- AI predicts resource bottlenecks up to 8 weeks ahead (configurable)
- Suggests team rebalancing before burnout occurs
- Skill-based matching for task assignment
- Capacity forecasting

### 3.3 Natural Language Queries with Charts
- "Which projects are at risk of missing Q3 deadline?" -> instant answer with chart
- "Show me resource utilization for last month" -> auto-generated visualization
- "Compare Project A vs Project B" -> side-by-side analysis
- Deep integration with all project data

### 3.4 AI Meeting Minutes -> Auto-Update Project
- Paste meeting transcript for analysis
- AI extracts action items, decisions, risks
- Auto-creates/updates tasks in the schedule
- Identifies and categorizes risks from transcript

### 3.5 AI Lessons Learned Engine
- Learns from every completed project
- Pattern recognition across project types
- Auto-suggests risk mitigations from past projects
- Knowledge base that grows smarter
- Full CRUD on the Lessons Learned page: edit opens the lesson modal pre-filled; delete presents a styled confirmation modal before removing the record
- "Load More" pagination on the Lessons Learned page for incremental loading of large knowledge bases

### 3.6 Monte Carlo Simulation
- Probabilistic schedule modeling
- P50, P80, P90 completion date predictions
- Risk-adjusted cost forecasting
- Confidence intervals on all predictions
- Visual tornado diagrams for sensitivity analysis
- **Trial sample simulation**: trial users see a realistic sample result (P50: 142d, P80: 158d, P90: 168d; cost P50: $485K; 10-bin histogram; sensitivity and criticality index for 5 tasks; 10,000-iteration PERT footer) with an amber upgrade banner instead of a 403 error; no computation or DB queries performed

### 3.7 AI-Powered Earned Value Forecasting
- Predict future CPI/SPI trends
- Early warning for projects trending toward overrun
- AI suggests corrective actions with estimated impact
- Compare AI forecast vs traditional EAC formulas
- Dedicated EVM Dashboard page (`/evm`) with 6 KPI cards, 4 forecast cards (with warning borders), CPI/SPI trend line chart, early warnings panel, forecast comparison table, and AI predictions section (confidence range, overrun probability, corrective actions with priority badges)
- Full dark mode across EVM trend chart (class-based SVG), forecast dashboard, and severity badges
- **Trial sample dashboard**: trial users see a realistic sample EVM dashboard (CPI: 0.93, SPI: 1.07, 7-week trend, 3 early warnings, 3 forecast methods) with an amber upgrade banner instead of a 403 error; AI predictions remain paid-only; no tokens or DB queries consumed
- **Budget Tab**: donut chart (SVG category breakdown), semi-circle health gauge, sortable expense table, search + category filter, cumulative spend line, CSV export, mobile card layout

### 3.8 Agent Activity Log
- Per-project decision log for all 4 agentic agents (Auto-Reschedule, Budget, Monte Carlo, Meeting)
- Every agent run records its decision: alert created, skipped (with reason), or error
- Structured details include thresholds, metrics, and context for each decision
- Filterable by agent, paginated API and UI
- "Agent Activity" tab on project detail page
- Full transparency into why alerts were or weren't created

---

## Priority 4: Production Polish (Make It Shippable)

### 4.1 Notification System
- In-app notification center with unread badge
- Full-page Notifications Center (`/notifications`) with severity summary cards (Critical/High/Medium/Low), type and severity filters, full notification list with severity color bars, type icons, project names, and mark-read controls
- Individual mark-as-read persists to the server via API so read state survives page refreshes
- "Load More" pagination on the Notifications Center page for incremental loading of large notification lists
- Accessible from sidebar ("Notifications" under Workspace) and "View all alerts" in bell dropdown
- Email alerts for assignments, deadlines, status changes
- Configurable notification preferences per user
- @mention notifications from comments
- **Benchmark:** All top tools

### 4.2 File Attachments & Documents
- Upload files to tasks and projects
- File preview (images, PDFs, documents)
- Version history on attachments
- Drag-and-drop upload
- **Benchmark:** Monday.com, Wrike, Asana

### 4.3 Time Tracking & Timesheets
- Log hours against tasks
- Weekly timesheet view per resource with inline **"Log Time"** form (project/schedule/task dropdowns, date, hours, description) — create entries without leaving the page
- Actual vs estimated hours comparison
- Time-based cost calculations
- **Timesheet Approval Workflow** — formal draft → submitted → approved/rejected lifecycle; submissions at week + project granularity; manager approval panel with Approve/Reject (reason required); rejection reverts entries to draft for correction and resubmission; recall before review; lock icon and status badges (gray/blue/green/red) on TimesheetGrid; mutation guard returns 409 on edits to non-draft entries; role-gated (managers/owners only); notifications for submitted/approved/rejected events; migration T019
- **Benchmark:** MS Project, Wrike, Smartsheet

### 4.4 Project Templates
- Save project structure as reusable template
- Template library with categories
- One-click project creation from template
- Include tasks, dependencies, roles, and milestones
- **Benchmark:** Monday.com, Asana, Smartsheet

### 4.5 Custom Fields
- User-defined fields on tasks and projects (text, number, date, dropdown, checkbox)
- Custom field filtering and sorting
- Custom fields visible in all views (Gantt, Kanban, Table)
- **Benchmark:** Monday.com, Jira, Asana

### 4.6 Network Diagram View
- Dependency graph visualization (PERT/precedence diagram)
- Interactive node layout with zoom/pan
- Critical path highlighting on network view
- **Benchmark:** Primavera P6, MS Project

### 4.7 Burndown/Burnup Charts
- Sprint burndown chart (remaining work vs time)
- Burnup chart (completed work + scope changes)
- Velocity tracking across sprints
- **Benchmark:** Jira, Azure DevOps

---

## Priority 5: Market Advantage (Win Enterprise Deals)

### 5.1 External Integrations
- **Slack integration** — COMPLETE
  - Event notifications via `SlackEventDispatcher` (fire-and-forget, project-scoped): 11 event types including task_assigned, deadline_approaching, budget_alert, meeting_followup, member_added, and more
  - Dedicated Block Kit builders for budget_alert, deadline_approaching, task_assigned, member_added, meeting_followup, and a generic notification fallback
  - `/kovarti status <project>` slash command for real-time project status
  - Interactive Approve/Reject buttons for agent proposals
  - `POST /api/v1/slack/send` — send ad-hoc messages to a project's Slack channels from agents or workflows
  - IntegrationConfigModal with project selector dropdown and 11-event-type filter checkboxes
  - Per-category Slack toggle in user notification preferences (alongside In-App and Email)
  - HMAC-SHA256 signature verification (Slack signing secret)
  - Bot token support for interactive messages
  - 3 MCP tools: `send-slack-message`, `test-slack-connection`, `list-slack-channels`
- Microsoft Teams integration
- Jira two-way sync
- GitHub/GitLab commit linking
- Email webhook triggers
- **Benchmark:** Monday.com, Asana, Wrike

### 5.2 Client/Stakeholder Portal
- Read-only external view for clients with computed progress percentage
- Branded portal with project status, budget summary, and timeline
- Milestone timeline — vertical timeline with color-coded status indicators
- Recent activity feed — last 10 completed tasks with relative timestamps
- Comment/feedback from external stakeholders with dark mode support
- Permission-controlled sections (budget, milestones, activity, comments)
- **Benchmark:** Wrike, Smartsheet

### 5.3 Approval Workflows & Change Requests
- Formal change request submission
- Multi-level approval chains
- Impact analysis before approval
- Audit trail of all approvals/rejections
- **Benchmark:** Primavera P6, enterprise tools

### 5.4 Resource Leveling
- Automatic over-allocation resolution
- Level within slack / extend project options
- Priority-based resource conflict resolution
- Before/after comparison view
- **Benchmark:** MS Project, Primavera P6

### 5.5 Sprint Planning / Agile Mode
- **Methodology-aware projects** -- Waterfall, Agile, or Hybrid methodology per project. Controls default view (Gantt vs Kanban), tab ordering (Sprints promoted for Agile/Hybrid), readiness bar steps, and context cards (velocity/sprint progress for Agile).
- Scrum board with sprint cycles, WIP limits per column, and assignee swimlane toggle
- Backlog grooming with inline search/filter (text + priority dropdown) in planning panel
- Story points and velocity tracking with sparkline trend visualization (last 6 sprints)
- Sprint list sorting (status-first, date, name) with velocity sparkline in header
- Sprint tab header: active sprint progress bar, "Day X of Y" indicator with mini progress bar
- Deterministic assignee avatars (8-color hash palette) on board cards
- Interactive burndown chart with today marker, hover tooltips, and summary stat tiles
- Full dark mode across all sprint views (list, planning, board, burndown, flow, capacity)
- Mobile-responsive layouts with flex-wrap, condensed labels, and touch-friendly card sizing
- Sprint retrospective summaries (AI-generated)
- **Benchmark:** Jira, Azure DevOps, Monday.com

### 5.6 Custom Report Builder
- Drag-and-drop report designer
- Configurable data sources and filters
- KPI, chart, and table sections render with correct data shapes (fixed section rendering bugs)
- `groupBy` parameter validated against an allowlist for SQL injection protection
- Regular users can delete their own templates (no longer requires admin role)
- Report Designer correctly persists all sections when updating an existing template
- Scheduled report delivery via email (daily/weekly/monthly recurring schedules)
- AI-powered project status reports with email delivery and MCP tool (`generate-status-report`)
- Trial users receive a sample status report with demo data (realistic RAG statuses, trend arrows, management actions) instead of a 403 — no AI tokens consumed; Email/Schedule/Download locked with upgrade banner
- **Trial sample report templates**: trial users see 3 sample Report Builder templates (Weekly Status, Budget Overview, Time Tracking) instead of a 403; New/Edit/Generate/Delete buttons are hidden with an "Upgrade to use" label; amber banner identifies sample state; no tokens or DB writes
- **Trial sample exports**: all 3 export formats (CSV, XML, JSON/PDF) return a sample project with 5 tasks across 2 phases instead of a 403; amber banner shown before download; no real project data read
- **Trial sample cross-project intelligence**: Portfolio Intelligence and Anomaly Detection endpoints return sample portfolio data with amber upgrade banner instead of a 403; What-If Scenarios POST stays hard-gated; Scenario Modeling page shows amber sample banner; no tokens consumed
- **Trial sample natural language query**: `POST /api/v1/nl-query` returns a sample response (demo narrative, bar chart, 3 suggested follow-ups) with amber upgrade banner instead of a 403; no AI tokens consumed
- **Trial sample meeting intelligence**: `POST /api/v1/meeting-intelligence/analyze` returns sample meeting analysis (summary, 3 action items, 2 decisions, 1 risk, 1 task update) with amber upgrade banner instead of a 403; Apply Changes and History remain gated; no AI tokens consumed
- **Trial sample stakeholder portal**: `GET /api/v1/links/:projectId` returns 2 sample portal links (Stakeholder Review Portal, Executive Dashboard) with amber upgrade banner instead of a 403; Create Link button hidden in PortalLinkManager; no DB reads
- **Trial sample workflow automation**: `GET /api/v1/workflows` returns 3 sample workflow definitions (Task Status Notification, Overdue Escalation, Budget Alert) with amber upgrade banner instead of a 403; New Workflow button and AI Generate section hidden on WorkflowPage; no DB reads
- **Trial sample resource management**: `GET /api/v1/resources` returns 4 sample resources (PM, Developer, QA, Designer with skills and rates) with amber upgrade banner instead of a 403; Add Resource button hidden on ResourceManagementPage; no DB reads
- **Trial sample auto-reschedule**: `GET /api/v1/delays` returns 3 sample delays (API Integration, Database Migration, UI Redesign) and `GET /api/v1/proposals` returns 1 sample proposal with amber upgrade banner instead of a 403; Generate Proposal button disabled on AutoReschedulePanel; no AI tokens consumed
- **Trial sample API keys**: `GET /api/v1/api-keys` returns 2 sample keys (CI/CD Pipeline, Dashboard Read-Only) with amber upgrade banner instead of a 403; Create Key button hidden on SettingsPage API Keys tab; no DB reads
- **Sample data architecture**: POST-based sample endpoints (`/nl-query`, `/meeting-intelligence/analyze`) exempt from global `requireActiveSubscription` hook via `SUBSCRIPTION_EXEMPT_PREFIXES`; portal links trial check runs before `requireProjectAccess`; meeting intelligence trial check runs before Zod schema validation; all write endpoints remain hard-gated
- **Trial abuse prevention**: `deleted_emails` table tracks emails of deleted accounts; re-registration with a previously-deleted email skips the 14-day trial (`subscriptionStatus: 'none'`), requiring a paid plan; case-insensitive lookup; migration `079_deleted_emails.sql`
- **Pricing-first signup flow**: All entry points (landing page hero, nav, login page "Sign up") route through plan selection before registration; landing page "Get Started" anchor-scrolls to inline `#pricing` section; login page links to `/pricing`; Trial card links to `/register`, paid cards link to `/register?tier=<tier>&billing=<billing>` for direct Stripe checkout
- Shareable report links
- **Benchmark:** Smartsheet, Monday.com

### 5.7 Project Intake Forms
- Customizable request submission forms
- Triage pipeline with scoring
- Auto-routing to approvers
- Conversion from request to active project
- **Benchmark:** Wrike, Smartsheet, Monday.com

---

### 5.8 RAID Management (BMC Remedy/Helix ITSM-Inspired)

A structured project control register for Risks, Actions, Issues, and Decisions — modelled on enterprise ITSM practices from BMC Remedy/Helix and adapted for project management.

**Capabilities:**
- Four record types in a single unified register: Risk, Action, Issue, Decision
- Global sequential type-prefixed IDs (R-001, I-001, A-001, D-001) assigned atomically and never recycled
- Type-specific status workflows with triage entry point: Risk (proposed → open → monitoring → mitigating → mitigated → closed), Issue (proposed → open → in_progress → resolved → closed), Action (proposed → open → in_progress → completed → closed / deferred), Decision (proposed → pending_decision → decided → deferred / reversed)
- **Triage workflow**: any team member can raise RAID items (PMI/PRINCE2 open identification); non-PM roles create items as `proposed` requiring PM review; PM/admin roles bypass triage to `open`; PMs/owners receive notification when items need triage
- Action records carry due_date and action_type (follow_up, decision_required, information_only, escalation)
- Decision records carry rationale, decided_by, decision_date, and alternatives_considered
- No-delete semantics: records are cancelled (with mandatory reason) rather than deleted; cancelled IDs are never reused; decision reversal (admin-only) creates a `reversed` terminal state
- Slide-out detail panel with inline field editing, dedicated Updates section for team communication, and a pure audit Activity trail
- Updates section: team narratives stored in `raid_updates` table, separate from audit log; users can post and delete their own updates
- Activity auto-logged on every status transition, field edit, cancel, reverse, update added, or update deleted; legacy comments hidden from display
- Role-based permission matrix: all roles can create RAID items (triage-gated for non-PM roles); admin=all operations including reverse; project_manager/scrum_master/pmo/ba=create + triage + cancel; reverse restricted to admin
- **AI Scan**: project-scoped AI analysis surfaces new Risks and Issues from schedule/task/budget data; user selects which findings to import; imported records tagged `source: ai_scan`
- **Agent partnership**: background agents write directly to RAID log via `importFromAgent`; agent-written records tagged `source: agent`; `suggest-mitigation` MCP tool surfaces historical lessons-learned for open risks
- **AI-assisted authoring**: "Suggest with AI" buttons on Mitigation Plan, Trigger Condition, and Response Plan fields; uses RAG-based lesson retrieval + Claude to generate field-specific suggestions (early warning signs for triggers, contingency actions for response plans, preventive strategies for mitigations)
- **RAID notifications**: owner assignment, status changes, updates posted, severity escalation — all notify the right people (owner + PMs) while excluding the actor to prevent noise
- Stats bar with live counts (Open Risks, Open Issues, Open Actions, Pending Decisions) + severity distribution bar
- Search + collapsible multi-filter toolbar (type, status, severity, source) with active filter count badge
- **Three view modes**: Table (sortable columns, inline status change, bulk select), Board (Kanban drag-and-drop by status), Risk Matrix (5×5 heatmap)
- **Sortable columns** — click any column header (ID, Title, Type, Severity, Status, Owner, Score, Date) to sort asc/desc
- **Inline status change** — click a status badge to pick a new status without opening the detail panel
- **Bulk actions** — checkbox selection with bulk status and severity change
- **Due date warnings** — overdue/due-soon badges on actions and issues with unresolved statuses
- **RAID tab badge** — total open item count shown on the tab header
- **Mobile card layout** — responsive cards on small screens with compact severity/status badges
- **Benchmark:** BMC Remedy/Helix ITSM (no-delete audit semantics, sequential IDs, mandatory cancel reason); exceeds traditional PM tools with AI Scan, risk matrix heatmap, Kanban board, and inline status changes
- **RAID Report**: data-driven (no AI) comprehensive RAID report with filter controls (type checkboxes, severity, owner dropdown); report sections include Summary Dashboard (4 cards with severity breakdown), All Items Table, Overdue Actions, and Key Mitigations; Download as HTML, email to stakeholders, schedule recurring delivery (daily/weekly/monthly with `raid-report::` prefix); trial users see sample report with locked email/schedule/download; same preview/download/email/schedule UX pattern as the AI Status Report; `POST /api/v1/raid-reports/generate` endpoint

---

## Implementation Status

| Feature | Status | Priority |
|---------|--------|----------|
| Critical Path Method | Done | P1 |
| Baseline Management | Done | P1 |
| Full EVM Metrics | Done | P1 |
| Kanban Board View | Done | P1 |
| Resource Pool & Workload | Done | P1 |
| Comments & Activity Feed | Done | P1 |
| Export Capabilities | Done | P1 |
| Auto-Scheduling Engine | Done | P2 |
| Workflow Automation | Done | P2 |
| Custom Dashboards | Done | P2 |
| Real-Time Collaboration | Done | P2 |
| Calendar & Table Views | Done | P2 |
| Portfolio-Level Gantt | Done | P2 |
| Advanced Security | Done | P2 |
| AI Auto-Rescheduling | Done | P3 |
| Predictive Resource Optimizer | Done | P3 |
| NL Queries with Charts | Done | P3 |
| AI Meeting -> Auto-Update | Done | P3 |
| AI Lessons Learned | Done | P3 |
| Monte Carlo Simulation | Done | P3 |
| AI EVM Forecasting | Done | P3 |
| Agent Activity Log | Done | P3 |
| Notification System | Done | P4 |
| File Attachments & Documents | Done | P4 |
| Time Tracking & Timesheets | Done | P4 |
| Project Templates | Done | P4 |
| Custom Fields | Done | P4 |
| Network Diagram View | Done | P4 |
| Burndown/Burnup Charts | Done | P4 |
| External Integrations | Partial | P5 |
| Client/Stakeholder Portal | Done | P5 |
| Approval Workflows & Change Requests | Done | P5 |
| Resource Leveling | Done | P5 |
| Sprint Planning / Agile Mode | Done | P5 |
| Custom Report Builder | Done | P5 |
| Project Intake Forms | Done | P5 |
| Gantt Drag-and-Drop Rescheduling | Done | Enhancement |
| Recurring Tasks | Done | Enhancement |
| Resource Availability Calendar | Done | Enhancement |
| Customizable Dashboard Widgets | Done | Enhancement |
| AI Task Slip Predictor | Done | Enhancement |
| AI Status Report Generator + Email & Scheduling | Done | Enhancement |
| AI Scope Creep Detector | Done | Enhancement |
| Mobile-Optimized Views | Done | Enhancement |
| Email Notifications & Digests | Done | Enhancement |
| Scheduled Report Delivery | Done | Enhancement |
| Dark Mode (full coverage — all 41 pages + shared components, Settings all 8 tabs, Admin page, Command Palette; badge/status polish across 9 pages: ProjectDetail, Notifications, Portfolio, Workflow, LessonsLearned, Reports, IntakeForms, AIInsights, AccountBilling) | Done | Enhancement |
| Project Milestones (Gantt diamonds) | Done | Enhancement |
| Dependency Types (FS/FF/SS/SF + lag) | Done | Enhancement |
| Multi-Dependency Support (up to 20 predecessors, junction table) | Done | Enhancement |
| Row Numbers & MS Project-style Predecessors | Done | Enhancement |
| Dependency Health Badges (green/yellow/red) | Done | Innovation |
| Inline Predecessor Editing (multi-predecessor comma syntax) | Done | Enhancement |
| Health-Colored Gantt Dependency Arrows (one per predecessor; hover tooltip shows predecessor→successor name, type, lag) | Done | Innovation |
| Kanban WIP Limits | Done | Enhancement |
| Comment @Mentions | Done | Enhancement |
| Bulk CSV/Excel Task Import (with guardrails + Windows-1252 mojibake normalization) | Done | Enhancement |
| Gantt PDF Export | Done | Enhancement |
| Goals / OKR Tracking | Done | Enhancement |
| Time Zone Support | Done | Enhancement |
| Multi-Language / i18n (EN/FR/ES) | Done | Enhancement |
| Gantt Row Striping (alternating backgrounds, dark mode) | Done | Enhancement |
| Gantt Resource Avatars (initials circles on bars) | Done | Enhancement |
| Gantt Drag-to-Create (click-drag timeline to create task) | Done | Innovation |
| Gantt Resource Overallocation Warnings (amber highlights on overlapping assignments) | Done | Innovation |
| Gantt Minimap (200×80px overview panel with draggable viewport) | Done | Enhancement |
| MS Project XML Export (MSPDI format with tasks, resources, assignments) | Done | Enhancement |
| Resource Management Page (workload heatmap, histogram, capacity forecast) | Done | Enhancement |
| EVM Dashboard Page (KPI cards, trend chart, forecasts, AI predictions) | Done | Enhancement |
| Notifications Center Page (severity cards, filters, full list) | Done | Enhancement |
| Dashboard Widget Drag-to-Reorder (grip handle, localStorage persistence) | Done | Enhancement |
| Mobile-Responsive Gantt Touch Gestures (bar drag, progress drag, drag-to-create) | Done | Enhancement |
| Resource Management Team Tab (create/edit/delete resources from /resources page) | Done | Enhancement |
| Timesheet Inline Log Time Form (project/schedule/task dropdowns, date, hours, description) | Done | Enhancement |
| Notification Mark-as-Read Persistence (individual read state saved to server API) | Done | Bug Fix |
| Executive Dashboard On Track Metric (uses schedule/budget variance, not progress heuristic) | Done | Bug Fix |
| Goals Project Dropdown (replaces free-text Project ID input with searchable dropdown) | Done | Bug Fix |
| Lessons Learned Edit/Delete (pre-filled modal for edit, ConfirmModal for delete) | Done | Enhancement |
| Styled ConfirmModal (replaces window.confirm() across Integrations, Change Requests, Intake, Settings, Report Builder, Goals) | Done | Enhancement |
| Expanded Global Search (9 entity types incl. RAID items, sprints, comments; enriched results with severity/priority/progress badges; type/project/status filters) | Done | Enhancement |
| Portfolio Dashboard (6 KPI cards, status filter pills, budget progress bar, project health cards, Dashboard/Timeline toggle) | Done | Enhancement |
| Portfolio API Enhancement (budgetAllocated, budgetSpent, progressPercentage, totalTasks, completedTasks per project) | Done | Enhancement |
| Portfolio Analytics (CPI/SPI comparison with sparklines, burndown trends, sortable project comparison matrix) | Done | Enhancement |
| Load More Pagination (Notifications Center, Lessons Learned, Agent Proposals pages) | Done | Enhancement |
| Report Builder Data Shape Fixes (KPI/chart/table sections, groupBy SQL injection guard, user-owned template delete, designer section persistence) | Done | Bug Fix |
| Shared Pagination Schema (paginationSchema.ts + PaginatedResponse on projects, schedule tasks, sprints, templates) | Done | Enhancement |
| Per-Tier AI Token Budget (tier-aware budgets, token top-ups, graceful degradation, admin override, Stripe multi-tier checkout) | Done | Enhancement |
| Zod Validation Expansion (9 additional route files: users, bulk, sprints, timeEntries, aiChat, apiKeys, webhooks, intakeForms, goals) | Done | Enhancement |
| Repository Layer (BaseRepository + ProjectRepository, UserRepository, ScheduleRepository — centralized SQL/row mapping, services keep business logic) | Done | Architecture |
| Structured Metrics (MetricsService with request counts, latency p50/p95/p99, AI token usage, DB query counts; GET /api/v1/metrics admin endpoint) | Done | Observability |
| Request Context Propagation (AsyncLocalStorage request ID through all async operations, Winston logger auto-includes requestId) | Done | Observability |
| Transaction Boundaries (queryOn() helper + transaction() wraps 7 multi-table service methods for ACID guarantees) | Done | Reliability |
| DB Pool Timeouts (connectTimeout: 5s, idleTimeout: 30s, queueLimit: 50 — env-configurable) | Done | Reliability |
| AI Budget 80% Threshold Warning (proactive daily-deduped notification before hard block at 100%) | Done | Enhancement |
| AI Circuit Breaker (trips after 5 transient failures, 60s cooldown, returns 503 instantly, auto-recovers) | Done | Reliability |
| Parallel Agent Scheduler (projects processed concurrently with bounded parallelism of 3, ~3x scan speedup) | Done | Performance |
| Structured Log Export (daily-rotated JSON logs with 14d retention, admin query/download endpoints) | Done | Observability |
| Next Best Actions (integrated into Action Center) | Done | Enhancement |
| Health Trends Sparklines (daily cron + migration 038) | Done | Enhancement |
| Dashboard & Projects consolidation (PM pages promoted to primary) | Done | Enhancement |
| PM Dashboard Design Gap Fixes (dark mode, KPI dots, linkPrefix) | Done | Enhancement |
| RAID Management (Risk/Action/Issue/Decision register, sequential IDs, no-delete, AI Scan, agent writes) | Done | Enhancement |
| RAID Report (data-driven report with filters, summary dashboard, overdue actions, key mitigations, download/email/schedule) | Done | Enhancement |
| Report History Organization (sortable paginated table, tiered type dropdown with sub-types, date range picker, search, delete, download, server-side filtering/pagination) | Done | Enhancement |
| NL Workflow Builder (AI generates DAG workflows from plain English descriptions) | Done | Enhancement |
| PWA Support (real service worker, app-shell caching, installable, offline banner, auto-update) | Done | Enhancement |
| KPI Drill-In Enrichment (summary cards, trend badges, distribution bars, health sparklines + sub-scores) | Done | Enhancement |
| Dashboard Widget Enrichment (BudgetWatch burn-rate indicators, TeamWorkload overallocation warnings, VelocitySparkline sprint comparison) | Done | Enhancement |
| Mobile UX Improvements (Notifications/Proposals stat cards 2-col on mobile, Goals modal stacks, Resource tab bar horizontal scroll, Project Detail action condensing + tab scroll, Portfolio tables min-width scroll) | Done | Enhancement |
| Auth & Remaining Dark Mode (auth error/success banners, gray-750→gray-700 fix across 13 files, AgentProposals comprehensive dark mode, TimesheetPage tab contrast fix, AgentActivityTab dark mode) | Done | Enhancement |
| Components Dark Mode (WorkloadHeatmap, QuickActions, TaskPrioritizationPanel, QueryInput, ChangeRequestDetail/List/Form, CustomizeDropdown, ErrorBoundary, CustomFieldEditorModal, IntakeFormDesigner, IntegrationConfigModal, SyncLogPanel, ReportScheduleModal, ResourceLevelingPanel, IntakeReviewPanel, MeetingResultPanel, ResourceForecastPanel, AvailabilityCalendar, WorkflowNodeEditor, WorkflowEditor, IntakeSubmissionForm, CapacityChart, ExecutionDetail, RebalanceSuggestions, NetworkDiagramView, MonteCarloHistogram, ResourceHistogram, SCurveChart, BurndownMiniWidget, ResourceUtilizationWidget, CriticalityIndex, PieChart, BurndownChart, ForecastComparisonChart, TornadoDiagram, VelocityChart, WidgetGrid, LineChart, DynamicChart, AIChatContext, BarChart, PortalLinkManager, TaskActivityPanel, TaskCardMobile, TemplatePicker, ColumnPickerDropdown, TemplateCustomizeForm, TimeTrackingTab, TaskFormModal, ViewerInvitePanel, TimeLogForm, CustomFieldsSection, ResourcesTab, RAIDDetailPanel, SaveAsTemplateModal — 56 components) | Done | Enhancement |
| Dark Mode & Accessibility Polish (ReportScheduleModal form inputs + toggle a11y, ChangeRequestsPage button visibility, 10 chart tooltip dark overlays, close button aria-labels, invalid Tailwind class fix, dead button removal, lazy-load PrelaunchLandingPage, dark:bg-gray-900 always-dark row fix across 16 files, duplicate import consolidation — 11 items, 37 files) | Done | Bug Fix |
| UI Polish Batch 2 (unconditional dark:bg-gray-800/primary hover fixes, dark border variants, admin button dark mode, overflow-x-auto tables, responsive grid breakpoints, z-index layering, RAID panel mobile width, KanbanBoard swimlane overflow, aria-labels on icon buttons, VerifyEmailPage dark containers — 40 files) | Done | Bug Fix |
| UI Audit Sprint 1 (9 missing sidebar nav entries, breadcrumb label map for 44 routes, KPI tiles div→Link a11y, remove "Read-only" chip, dataUpdatedAt footer, "Kovarti PM" branding, theme-color teal, dashboard 13→4 default widgets, global :focus-visible ring, dark link hover underline, bottom nav 10px→12px — 10 findings, 7 files) | Done | UX/A11y |
| UI Audit Sprint 2 (gray→stone neutral alias, teal-*→primary-* across 12 files, landing gradients blue→teal, WCAG AA contrast on trust line/footer, onboarding purple→stone-900 + K mark — 6 findings, 12 files) | Done | Visual System |
| UI Audit Sprint 3 (command palette rewrite with route/verb/recent commands + useModal focus trap, keyboard shortcut cheat sheet via ?, g+key chord navigation, settings accessible to all roles — 4 findings, 4 files) | Done | Navigation/A11y |
| UI Audit Sprint 4 (KPI tiles 6→4 with subtitle dedup, projects table/card toggle with sortable columns, AI panel default closed, scope toggle always visible — 4 findings, 4 files) | Done | Density/Disclosure |
| UI Audit Sprint 5 (token meter hidden below 70% with warning/critical labels, microcopy `…` standardisation across 67 files, debounced+memoised project search, `?tab=` deep-link on project detail + sidebar schedule shortcut — 4 findings, 70 files) | Done | Copy/Performance/Nav |
| UI Audit Sprint 6 (landing page feature cards keyboard/tap/focus support + aria-expanded; hero mockup visible on mobile; `useReducedMotion()` hook + `static` prop on all 6 SVG mockups; system high-contrast CSS overrides in index.css; AI surfaces unified under "Mjuzi AI" sidebar section with renamed nav items and panel header; "See it in action" section on landing page with 3 alternating mockup rows + hero CTA to #see-it-work + refund policy accordion + tier descriptor parentheticals; onboarding rewritten as 3-step wizard with role/methodology step, optional template project step, and done step — 5 findings, D5/D6/E2/E4/E5) | Done | A11y/Branding/Onboarding |
| Project Brief Card (inline-editable markdown description on Overview tab; click-to-edit with save-on-blur; markdown toolbar with bold/italic/heading/list/link/code buttons + Ctrl+B/I shortcuts + flex-wrap on mobile; collaborative editing indicators via WebSocket presence with amber pulsing badge + truncated usernames on mobile; headings/bold/italic/lists/links/inline code rendering; empty-state placeholder; DOMPurify client-only sanitization on render; 50K char description limit; error toast with Retry on failed saves; edit button always visible on touch devices; textarea max-height 50vh on mobile; shared `renderMarkdown` utility extracted from QueryPage; sessionStorage draft recovery on unmount; beforeunload warning; editing presence re-sent on reconnect) | Done | Enhancement/Security |
| Realtime Audit Fixes Batch 1 (8 findings: N1 flush autosave on unmount; N3 keyboard/touch edit access with tabIndex+role+onKeyDown; N4 Escape cancels and reverts draft; P1 WebSocket presence:join membership check + scoped broadcast by projectId; P2 optimistic locking via expectedUpdatedAt with 409 Conflict response; P3 auto re-join presence on reconnect via connectionState dependency; P4 scoped task query invalidation by scheduleId; N6 DOMPurify sanitization of AI-generated status report HTML — 9 files) | Done | Security/UX/Performance |
| Realtime Audit Fixes Batch 2 (7 findings: N5 `marked` GFM parser replacing regex renderMarkdown + prose CSS; N7 link clicks in brief don't enter edit mode; N8 brief card in reorderable overview grid with col-span-full; P5 a11y on editing indicator role=status/aria-live/motion-reduce; P6 shared PresenceIndicator component with avatars/chip variants; R1 SEO noscript prerender fallback in index.html; R3 per-user WebSocket connection limit 5/user + 2000 global cap with ping/pong keepalive — 7 files) | Done | UX/A11y/SEO/Infra |
| Fix Verification Audit (6 findings: F1 scoped notification broadcasts via sendToUser; F2 save-on-blur replacing autosave-while-typing for honest Escape cancel; F3 removed server-side stripDangerousHtml from storage path (DOMPurify at render is the boundary); F4 sessionStorage draft recovery on unmount + beforeunload warning; F5 editing presence re-sent on WebSocket reconnect; F6 debounced portfolio query invalidation 500ms — 6 files) | Done | Security/UX/Performance |
| Cross-Device View Preferences (theme, sidebar, AI panel, schedule view mode, projects view mode synced server-side via `view_preferences` JSON column; debounced 1s write-back; merge-on-update partial updates; localStorage fallback for instant apply — migration 076, 8 files) | Done | UX/Persistence |
| Mjuzi Self-Learning (user preference memory via `remember_user_preference` tool — stores response style, detail level, focus area prefs per user; correction memory via `remember_correction` tool — stores factual corrections scoped to user or project; both recalled and injected into system prompt on every conversation; ~200-600 tokens overhead per request; uses existing `AgentMemoryService` with `role` and `project` memory types — 4 files) | Done | AI/UX |
| Non-Working Day Shading (grey overlay on weekends/holidays/calendar exceptions in Gantt at Day/Week zoom; fetched from non-working-dates API; 5min cache — 3 files) | Done | Enhancement |
| Resource Leveling Quick Button (one-click Level Resources in Gantt toolbar; calls leveling API; modal shows proposed date adjustments with reasons; Apply All commits changes — 1 file + modal) | Done | Enhancement |
| Progress Mode Duration/Work (schedule-level `progress_mode` enum; parent rollup weights by estimatedDays or estimatedDurationHours; toolbar toggle — migration T015, 4 files) | Done | Enhancement |
| Recurring Task On-Demand Expansion (POST expand-recurrence endpoint expands templates up to 90 days; auto-called after template creation; DELETE recurrence-children endpoint; visual indicators in Gantt — 5 files) | Done | Enhancement |
| MSPDI XML Import (client-side DOMParser extracts tasks/hierarchy/dependencies/durations from MS Project XML; POST import-structured server endpoint creates tasks with outline-level hierarchy and predecessor links — 4 files) | Done | Enhancement |
| What-If Scenarios (clone schedule as scenario with task ID mapping; independent editing; compare endpoint shows task-by-task date/duration diffs; Promote to Base replaces original; UI with Create Scenario button, scenario dropdown, Compare panel — migration T016, 6 files) | Done | Enhancement |
| Resource Cost Rollup (costRateHourly on resources; workload computation multiplies allocated hours × rate per week; per-resource totalCost, per-week cost, costSummary.totalProjectCost in API response; Cost column in Workload Heatmap; Estimated Cost summary card) | Done | Enhancement |
| Assignment Conflict Detection (over-allocation check on POST /resources/assignments; sums overlapping assignments against capacity; advisory warnings returned with 140%+ utilization detail; non-blocking — assignment still created) | Done | Enhancement |
| Skill Proficiency Levels (1–5 scale: Junior/Intermediate/Mid/Senior/Expert on resource skills; backward-compatible with plain string tags treated as level 3; skill-match ranking uses proficiency) | Done | Enhancement |
| Cross-Project Workload (GET /resources/workload with no projectId; org-wide demand aggregation across all projects per resource; same response shape as per-project endpoint with over-allocation flags) | Done | Enhancement |
| Resource Groups/Teams (group assignment on resources: Engineering/Design/QA/Management/Operations; ?group= filter on GET /resources; Group filter dropdown in Team tab of /resources page) | Done | Enhancement |
| Utilization Dashboard (12-week SVG line chart on Resource Management page; three series: Planned/Actual/Capacity; spot over/under-run trends before they occur) | Done | Enhancement |
| Gantt Quick-Assign (toggleable Resource column in Gantt table; resource chips with hover-remove; "+" button opens searchable dropdown; inline task_assignment creation via onTaskUpdate; POST /resources/quick-assign backend for MCP; advisory over-allocation warning) | Done | Enhancement |
| Table View Arrow Key Navigation (Arrow keys navigate cells; blue ring focus indicator; Enter/F2 to edit; Escape to unfocus; click-to-select-then-click-to-edit pattern; cell-level Ctrl+C/V copy-paste between same-field-type cells) | Done | Enhancement |
| Copy/Paste Rows — Table View & Gantt (Ctrl+C copies selected/active tasks when no cell focused; Ctrl+V pastes as duplicates with "(copy)" suffix; Ctrl+D duplicates in one step; onDuplicateTasks prop on both view components) | Done | Enhancement |
| Resource Column in Table View (ResourceQuickAssign chip dropdown now available in Table View column picker, matching Gantt Quick-Assign behavior) | Done | Enhancement |
| Column Auto-Fit Double-Click (double-click column resize handle in Table View or Gantt to auto-fit width to content via canvas measureText; capped at 400px) | Done | Enhancement |
| Calendar Templates (customizable working schedules: 5×8/4×10/6×6 presets + custom; CRUD at /resources/calendar-templates; affects capacity and workload calculations when assigned to a resource) | Done | Enhancement |
| Timesheet Integration (userId link on resource record; workload views show actualHours from time entries alongside planned; utilization dashboard Actual series from real logs; per-week variance color-coding green/amber/red) | Done | Enhancement |
| Actual vs Planned Overlay (heatmap cells show actual/allocated hours + utilization %; rich tooltip with allocated/actual/capacity/utilization/cost breakdown; legend updated) | Done | Enhancement |
| Bulk Resource Import CSV (POST /resources/import; drag-drop modal with preview table; validates name/role/email; semicolon-separated skills; error/success counts; max 200 rows, 5MB limit) | Done | Enhancement |
| Resource Profile Modal (GET /resources/:id/profile; click resource name to open; shows details/skills/summary cards/assignments table/utilization trend chart) | Done | Enhancement |
| Rate Types — Overtime (overtime_rate_hourly on resources; rate_type ENUM on time_entries; cost calculation uses overtime rate for OT hours; fallback 1.5× standard; OT Rate field in form+table; migration 080) | Done | Enhancement |
| Capacity Planning by Role (GET /resources/capacity-by-role; Role Capacity sub-tab; groups resources by role; 12-week capacity vs demand table; green surplus/yellow tight/red over-committed color coding) | Done | Enhancement |
| Effort-Driven Scheduling (work_hours + effort_driven on tasks; duration auto-recalculated on assignment add/remove; hours_per_day from resource capacity × allocation%; skips weekends; Work Hours + Effort Driven checkbox in TaskFormModal; migration 081) | Done | Enhancement |
| Timesheet Approval Workflow (draft→submitted→approved/rejected status flow; week+project submission granularity; manager Approvals tab with TimesheetApprovalPanel; Approve/Reject with required reason; recall before review; status badges + lock icon on TimesheetGrid; 409 guard on edits to non-draft entries; notifications: timesheet_submitted/approved/rejected; role-gated to managers/owners; migration T019_timesheet_approval.sql) | Done | Enhancement |
| Gantt/Schedule Performance Sprint (memoized dependency arrow paths + minimap bars via useMemo; optimistic single-task cache patching via setQueryData; lazy-loaded scenario/baseline queries with enabled guards; Ctrl+D duplicate shortcut in Gantt+Table; dependency arrow hover tooltips with predecessor→successor/type/lag) | Done | Performance |
