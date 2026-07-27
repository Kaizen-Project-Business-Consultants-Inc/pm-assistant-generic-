# PM Assistant -- Product Manual

## Product Overview

PM Assistant is an enterprise-grade project management platform built with TypeScript, React, and Fastify. It combines traditional PM discipline (CPM, EVM, baselines) with AI-powered intelligence (auto-reschedule, natural language queries, predictive analytics) in a single SaaS application. The platform supports the full project lifecycle from intake through execution, monitoring, and closeout.

---

## 1. Project Management

### Projects

Full CRUD lifecycle for projects with the following attributes:

- **Status tracking**: planning, active, on_hold, completed, cancelled
- **Priority levels**: low, medium, high, urgent
- **Methodology**: waterfall (default), agile, or hybrid. Controls the presentation layer — tab ordering, readiness bar steps, context cards, and default view mode. Does not restrict feature access (e.g., waterfall projects can still use sprints).
- **Budget management**: allocated budget, spent budget, budget variance
- **Date management**: start date, end date, auto-calculated duration
- **Team assignment**: project members with role-based access (owner, manager, editor, viewer). Only members can access a project; non-members get 404. Creator is auto-added as owner. Admin/pmo bypass membership; executive gets read-only bypass.
- **Project Brief**: Inline-editable markdown description on the Overview tab. The brief card is part of the **reorderable card grid** — drag it to reposition alongside KPI, milestones, and other overview cards (rendered full-width via `col-span-full`). Supports headings, bold, italic, lists, links, and inline code via the **`marked` GFM parser** (not regex). Clicking a link in the rendered brief opens it in a new tab without entering edit mode. Click-to-edit with **save-on-blur** — text is saved when you click outside the editor or tab away, not while typing. A formatting toolbar (bold, italic, heading, list, link, code) appears in edit mode with Ctrl+B/I shortcuts; toolbar wraps on narrow screens. Collaborative editing indicators show when another user is editing the brief (amber pulsing dot with username via the shared `PresenceIndicator` component, `role="status"` and `aria-live="polite"` for screen readers, `motion-reduce:animate-none` for reduced motion). Empty projects show a placeholder prompting the user to add a brief. Read-only users see rendered markdown without edit controls. The edit button is always visible on touch devices (no hover required). Failed saves show a "Save failed" message with a Retry link. Content is sanitized client-side via DOMPurify on render. Description is limited to 50,000 characters. **Keyboard accessible:** view-mode and empty-state divs have `tabIndex`, `role="button"`, and keyboard handlers (Enter/Space to edit). **Escape cancels** editing and reverts draft to the pre-edit description — because nothing is saved mid-keystroke, Escape is an honest cancel. **Unmount recovery:** navigating away mid-edit persists the draft to sessionStorage and attempts to save; if the save fails, the draft is recovered on next visit. Closing the browser tab triggers a `beforeunload` warning if there are unsaved changes. **Optimistic locking:** each save sends the last-known `expectedUpdatedAt` timestamp; if another user saved in the meantime, the server returns 409 Conflict and the UI shows "Someone else saved — Refresh" instead of silently overwriting. **Reconnect resilience:** editing presence is re-sent after WebSocket reconnect so other users continue to see the editing indicator during network interruptions. **Notifications** are scoped per-user — WebSocket notification events are sent only to the target user, not broadcast to all clients.

### Schedules

Each project contains one or more schedules. A schedule groups tasks into a logical timeline and serves as the unit for critical path analysis, baselines, and Monte Carlo simulation.

### Tasks

Tasks are the atomic unit of work. Each task supports:

- Status: pending, in_progress, completed, cancelled
- Priority: low, medium, high, urgent
- Multiple predecessor dependencies (up to 20 per task) with type and lag per dependency
- Estimated duration (days) and work effort
- Assigned resource
- Parent-child hierarchy (subtasks)
- Risk and issue annotations
- Progress percentage tracking
- Recurring task support (daily, weekly, biweekly, monthly) with auto-generation

### Recurring Tasks

Tasks can be marked as recurring templates with an RRULE-style recurrence rule. Supported frequencies:

- **Daily** — generates a new task instance every day
- **Weekly / Biweekly** — with selectable days of the week (e.g., Mon/Wed/Fri)
- **Monthly** — on a specific day of the month

A daily cron job (02:00 UTC) scans for templates and generates instances within a 14-day horizon. Generated instances link back to their parent template via `recurrence_parent_id`. Template tasks appear in the Gantt chart with a repeat icon.

### Views

- **Gantt chart** -- interactive timeline with dependency arrows and critical path highlighting. **Five zoom levels** (Day, Week, Month, Quarter, Year) with a **two-tier timescale header** (e.g. months over weeks, years over months). Zoom selection persists per schedule via localStorage. A **draggable splitter** between the task table and timeline lets you resize the panels; width persists per schedule. The left panel shows 11 columns: row number (#), task name, predecessor (row-number format with health dot), start date, end date, duration, estimated days, progress %, priority, assigned to, and status. Drag the splitter to reveal or hide columns. **Resizable columns**: drag column borders in the header to resize; widths persist per schedule in localStorage. **Column picker**: Columns button in toolbar toggles column visibility; # and Task Name always visible; persists per schedule. **Row expand/collapse**: parent tasks have a chevron toggle to collapse/expand children; persists in localStorage. **Collapse All / Expand All** buttons in toolbar toggle all parent tasks at once. **Inline grid editing**: click any cell (except row #) to edit directly — text inputs for name/assignee, date pickers for start/end, number inputs for est days/%, select dropdowns for priority/status, and MS Project notation for predecessors. Tab/Shift+Tab navigates across fields and rows. Duration edits auto-compute end date. Enter saves, Escape cancels, blur auto-saves, green flash confirms. **Row drag reorder**: hover over the # column for a drag grip; drag rows up/down within the same parent level. **Multi-select bulk edit**: checkbox selection with Shift+click range select; sticky toolbar for bulk status/priority/assignee changes and delete. Delete key triggers bulk delete with confirmation. **Undo/Redo**: Ctrl+Z/Ctrl+Y (up to 50 actions) for inline edits, bar drags, reorders, and bulk updates; undo/redo buttons in toolbar with tooltips. **Keyboard navigation**: Arrow keys move between cells, Enter/F2 to edit, Escape to clear focus. Supports drag-and-drop rescheduling: drag a bar to move a task, drag the right edge to resize; timeline auto-scrolls when dragging near viewport edges. Date changes cascade through dependencies automatically. Dependency arrows are colour-coded by predecessor health: green (completed), yellow (in progress), red (overdue/at risk). Hover over a bar to see predecessor details including row number, task name, and health status. **Column header sort**: click any column header to cycle through ascending/descending/none; sort indicator (▲/▼) shown in header; sorts within sibling groups to preserve hierarchy; row drag reorder disabled while sort is active. **Copy/Paste cells**: Ctrl+C copies the focused cell value to clipboard; Ctrl+V pastes into the focused cell (same field type only); green flash confirms. **Baseline bar refinement**: ghost bars are rendered only when a task's baseline dates differ from its current dates, eliminating visual noise for on-schedule tasks. **Indent/Outdent**: Tab indents the focused task (makes it a child of the task above); Shift+Tab outdents (promotes to parent's parent); both operations go through onTaskUpdate and are undoable. **Bar progress drag**: drag the progress fill edge in a task bar to set completion percentage; visible handle appears on hover; change is undoable via Ctrl+Z. **Row action icons**: each row shows three action icons on hover — edit (pencil, opens task editor), insert below (+ icon, opens add form to create a sibling/child task after this row), and delete (trash, deletes with confirmation dialog). Icons fade in with opacity transition on row hover.
- **Kanban board** -- drag-and-drop cards grouped by status. **Subtask and dependency badges**: each card shows a count badge for subtasks (child tasks) and dependencies, derived from the loaded task list without additional API calls. **Inline quick-add**: a "+" button at the bottom of each status column reveals an inline text input — type a task name and press Add to create a task directly in that column without opening a modal. **Swimlane mode**: a dropdown in the Kanban header lets you group cards by Assignee or Priority in addition to the default flat status layout. Each swimlane row shows a label column and mini status columns per lane. Swimlane selection persists in localStorage.
- **Calendar view** -- tasks plotted on a calendar grid with three display modes. **Month view** (default): tasks shown as dots and short labels per day cell; supports drag-to-reschedule by dragging a task from one day to another (task duration is preserved — start and end dates shift together). **Week view**: 7-column layout with large day headers and full task lists per day, showing priority, assignee, and date range. **Day view**: single-day detail view with rich task cards showing priority badge, assignee, date range, and progress bar. Toggle between Month / Week / Day using buttons in the calendar header. Navigation arrows and a Today button move through time periods in any mode.
- **Table view** -- sortable, filterable spreadsheet-style listing with a customizable column picker. Choose from 22 columns across four groups (Standard, Scheduling/CPM, Baseline, Other). The **# (row number)** column is always visible and shows sequential numbering. The **Predecessor** column displays dependencies in compact MS Project-style row-number format (e.g. "3", "7SS+2d") with colour-coded health badges: green dot (predecessor completed), yellow dot (in progress), red dot (overdue). Predecessors are **inline-editable** — click and type a row number with optional type and lag. Column selections persist per schedule. Scheduling columns automatically trigger CPM computation. Baseline columns show variance data when a baseline comparison is active. **Saved Views** let you name and store column+sort configurations; load, update, or delete them from the Views dropdown. **Group-by**: a dropdown in the header lets you group rows by Status, Priority, or Assignee. Each group has a collapsible header row showing the group name and task count. Collapsed groups persist in localStorage. **Inline quick-add**: a "+" row at the bottom of the table provides an inline text input for creating new tasks without opening a modal.

### Schedule Filter Bar & CSV Export

A cross-view **filter bar** appears above all schedule views (Gantt, Kanban, Calendar, Table). It provides:

- **Search** — real-time text search filtering tasks by name (case-insensitive substring match).
- **Filter toggle** — a button with an active filter count badge that reveals dropdown filters for Status, Priority, and Assignee. Dropdowns are populated dynamically from the current task list.
- **Clear all** — resets all active filters in one click.
- **Task count** — displays "X of Y tasks" to show how many tasks match the current filters.
- **CSV Export** — a download button exports the currently filtered task list as a CSV file. The filename includes the schedule name.

All filters apply to whichever view is active — the same `filteredTasks` array is passed to Gantt, Kanban, Calendar, and Table views.

### Bulk Operations

Bulk create, update, and status-change endpoints allow operating on multiple tasks or projects in a single request.

### Search

Full-text search across 9 entity types: projects, tasks, RAID items (risks/issues/actions/decisions), goals, lessons learned, resources, change requests, sprints, and task comments. All queries execute in parallel and return a unified result set; any entity type that fails is silently omitted so a partial outage does not block the entire search.

**Enriched results** include contextual fields beyond just name/description/status:
- **Tasks**: priority, assigned_to, progress_percentage, start_date, end_date
- **RAID items**: severity, record_id, category, type (risk/issue/action/decision)
- **Goals**: progress, goal_type, owner_id
- **Resources**: role, skills, is_active
- **Sprints**: goal, start_date, end_date
- **Comments**: text (truncated to 120 chars), task_name

**Optional query parameters:**
- `type` — comma-separated entity types to search (e.g., `?q=budget&type=task,risk`)
- `project` — scope results to a specific project ID (e.g., `?q=deploy&project=abc-123`)
- `status` — filter by status value (e.g., `?q=deploy&status=in_progress`)

**Response shape:** `{ results: [...], total: number, queryMs: number }`

---

## 2. Critical Path and Baselines

### Critical Path Method (CPM)

The `CriticalPathService` performs a full forward and backward pass across the task dependency graph to compute:

- **Early Start (ES)** and **Early Finish (EF)** for every task
- **Late Start (LS)** and **Late Finish (LF)**
- **Total float** and **free float**
- **Critical path identification** -- tasks with zero total float
- **Project duration** -- the minimum schedule span

Results feed into Gantt chart highlighting, Monte Carlo simulation, and resource leveling.

### Baselines

The `BaselineService` captures point-in-time snapshots of a schedule. Each baseline records every task's start date, end date, estimated days, progress, and status. Baselines are immutable once created.

### Variance Tracking

Comparing a baseline against current schedule state produces per-task variance metrics:

- Start variance (days slipped)
- End variance (days slipped)
- Duration variance (longer or shorter than planned)
- Progress variance (percentage points ahead or behind)
- Status change detection

---

## 3. Earned Value Management (EVM)

### S-Curve Data

The `SCurveService` computes cumulative Planned Value (PV), Earned Value (EV), and Actual Cost (AC) data points over time, derived from task durations, progress percentages, and project budgets. These data points render as the classic S-curve chart.

### EVM Metrics

Standard earned value indicators computed from S-curve data:

| Metric | Formula | Meaning |
|--------|---------|---------|
| CPI | EV / AC | Cost Performance Index |
| SPI | EV / PV | Schedule Performance Index |
| CV | EV - AC | Cost Variance |
| SV | EV - PV | Schedule Variance |
| EAC | BAC / CPI | Estimate at Completion |
| ETC | EAC - AC | Estimate to Complete |
| VAC | BAC - EAC | Variance at Completion |

### EVM Forecasting

The `EVMForecastService` extends basic EVM with AI-powered forecasting:

- Predicted CPI and SPI for the next 4 weeks based on trend momentum
- AI-adjusted EAC with confidence range (low/high)
- Trend direction assessment: improving, stable, or deteriorating
- Cost overrun probability (0-100%)
- Corrective action recommendations with effort, priority, and estimated impact
- Narrative summary in plain language

### Early Warnings

Proactive alerts fire when CPI or SPI drop below configurable thresholds, enabling intervention before projects go off-track.

### Budget Tab (Project Detail)

The Budget tab within a project provides expense tracking and budget overview:

- **Overview sub-tab**:
  - **Four summary cards**: Budget Allocated, Total Spent, Remaining (green/red), Budget Health Gauge (semi-circle SVG with color zones: green < 80%, amber 80-100%, red > 100%).
  - **Category donut chart**: SVG donut showing cost breakdown by category (10 categories: labor, materials, software, hardware, travel, contractors, training, consulting, licenses, other) with color legend.
  - **Monthly spend trend**: Bar chart with cumulative spend line overlay (amber). Legend shows monthly bars vs cumulative line.
- **Expenses sub-tab**:
  - **Search bar** to filter by vendor, description, or category name.
  - **Category dropdown filter** to show only a specific expense category.
  - **Sortable columns**: Click Date, Category, Amount, or Vendor headers to sort ascending/descending.
  - **CSV export**: Download filtered expenses as CSV file.
  - **Add Expense form**: Inline form with date, amount, category, vendor, description fields.
  - **Mobile card layout**: Responsive cards on small screens instead of the table.

### EVM Dashboard Page (`/evm`)

A dedicated analytics page for earned value management, accessible from the sidebar under the **Analyze** section. Full dark mode support. Features:

- **Project selector** dropdown to choose which project to analyze.
- **Six KPI cards**: CPI, SPI, EV, PV, AC, BAC with color-coded values (green when healthy, red when critical).
- **Four forecast cards**: EAC, ETC, VAC, TCPI with red warning borders when thresholds are exceeded.
- **CPI/SPI Trend chart**: SVG line chart with blue CPI line, green SPI line, 1.0 baseline reference, and labeled axes. Dark mode uses class-based SVG fills for proper contrast.
- **Early Warnings panel**: color-coded alert cards (critical = red, warning = amber, info = blue) with dark mode variants.
- **Forecast Comparison table**: multiple forecasting methods with EAC values and BAC variance.
- **AI Predictions section** (when `AI_ENABLED=true`): AI-adjusted EAC with confidence range, overrun probability, trend direction, narrative summary, and corrective actions with priority badges.

**Trial user behavior:** Trial users who navigate to `/evm` see a sample EVM dashboard populated with realistic demo data (CPI: 0.93, SPI: 1.07, 7-week trend, 3 early warnings, 3 forecast comparison methods) instead of a 403 error. An amber banner at the top of the page reads: "Sample EVM Dashboard — This is a sample dashboard with demo data. Upgrade to a paid plan to see EVM metrics calculated from your actual project budgets, costs, and schedule performance." The AI Predictions section (`/:projectId/ai`) remains gated to paid tiers. No tokens or database queries are consumed for the sample. This follows the same pattern as the sample status report feature.

Uses the existing `getEVMForecast()` API.

---

## 4. Resource Management

### Resource Pool

The `ResourceService` maintains a central resource registry. Each resource has:

- Name, email, role
- Capacity (hours per week, default 40)
- Skill tags
- Active/inactive status
- Cost rate ($/hour, optional) — used in portfolio cost projections

The `GET /api/v1/resources` endpoint supports pagination via `?limit=` and `?offset=` query parameters (default limit 50, max 200). The response includes a `total` count for client-side pagination controls.

All major list endpoints use a shared pagination schema (`paginationSchema.ts`) with consistent defaults (limit 1–200, default 50; offset ≥ 0). Paginated endpoints return a `PaginatedResponse<T>` containing `data`, `total`, `page`, `pageSize`, and `totalPages`. The following endpoints support pagination:

- `GET /api/v1/projects` — user's projects
- `GET /api/v1/resources` — resource pool
- `GET /api/v1/schedules/:id/tasks` — tasks within a schedule
- `GET /api/v1/sprints/project/:projectId` — sprints for a project
- `GET /api/v1/templates` — project templates

### Workload Heatmap

The resource workload endpoint aggregates task assignments across projects to produce a per-resource, per-day demand profile. Over-allocated days are flagged.

### Resource Histogram

The `ResourceLevelingService` generates daily demand histograms showing hours demanded vs. capacity for each resource. Over-allocations are returned as structured data for visualization.

### Resource Leveling

When over-allocations are detected, the leveling algorithm shifts non-critical tasks within their float to smooth demand below capacity. The result includes:

- Original vs. leveled demand profiles
- List of adjusted tasks with original and new dates
- Remaining over-allocations (if any cannot be resolved within float)
- **Reassignment suggestions** — for tasks that remain over-allocated after delay adjustments, the system suggests alternative resources based on skill matching. Each suggestion includes the current and suggested resource, a match score, and a one-click "Reassign" button

### Resource Optimization

The `ResourceOptimizerService` uses AI to analyze resource utilization patterns and recommend:

- Reallocation of underutilized resources
- Load balancing across team members
- Skill-based assignment optimization

### Resource Availability Calendar

Each resource has an availability calendar accessible from the Team tab. Managers can define blocks of time when a resource is unavailable or has reduced hours:

| Type | Effect |
|------|--------|
| **Vacation** | Resource fully unavailable for the date range |
| **Holiday** | Resource fully unavailable (company-wide) |
| **Unavailable** | Generic unavailability |
| **Reduced Hours** | Resource available for fewer hours/day |

The calendar displays a color-coded month grid (red=vacation, blue=holiday, gray=unavailable, amber=reduced). Workload heatmap calculations automatically account for availability blocks — when a resource has vacation during a week, their effective capacity is reduced proportionally.

**API endpoints:**
- `GET /api/v1/resources/:resourceId/availability?from=&to=`
- `POST /api/v1/resources/:resourceId/availability`
- `PUT /api/v1/resources/availability/:id`
- `DELETE /api/v1/resources/availability/:id`

### Resource Management Page (`/resources`)

A dedicated page accessible from the sidebar under the **Analyze** section. Features:

- **Project selector** dropdown to choose which project to view.
- **Summary cards**: Total Resources, Over-allocated count, Average Utilization.
- **Four tabs**:
  - **Team** — Full table of all resources with create, edit, and delete capabilities. Managers can add new resources, update roles/capacity/cost rates, and remove resources directly from this tab.
  - **Workload Heatmap** — Table showing all resources with weekly utilization percentages as colored cells (green < 80%, blue 80–100%, amber 100–120%, red > 120%). Displays resource name, role, average utilization, and per-week cells.
  - **Resource Histogram** — SVG bar chart per resource showing daily demand hours with an 8-hour capacity line. Red bars for over-allocated days. Includes an over-allocation summary with count and details.
  - **Capacity Forecast** — 8-week bottleneck predictions table (resource, week, demand, capacity, severity) and AI-generated recommendations.

Uses existing APIs: `getResourceWorkload()`, `getResourceHistogram()`, `getResourceForecast()`.

---

## 5. Workflow Automation (DAG Engine)

### Overview

The `DagWorkflowService` implements a directed acyclic graph (DAG) execution engine. Workflows are composed of nodes connected by edges, with optional condition expressions on edges for branching.

### Node Types

| Node Type | Purpose |
|-----------|---------|
| **Trigger** | Entry point -- fires on entity events (e.g., task status change, priority escalation, task creation) |
| **Condition** | Evaluates a boolean expression against execution context |
| **Action** | Executes a side effect (update task, send notification, invoke agent, log activity) |
| **Approval** | Pauses execution until an authorized user approves or rejects |
| **Delay** | Pauses execution for a configurable duration |
| **Agent** | Invokes a registered AI agent capability with retry logic and configurable backoff |

### Trigger Types

| Trigger | Fires When | Optional Filters |
|---------|-----------|-----------------|
| `status_change` | Task status changes | `fromStatus`, `toStatus` |
| `progress_threshold` | Progress crosses a threshold | `progressThreshold`, `progressDirection` |
| `date_passed` | Task end date is in the past | -- |
| `task_created` | New task is created (oldTask is null) | `statusFilter` |
| `priority_change` | Task priority changes | `toPriority` |
| `assignment_change` | Task assignee changes | `toAssignee` |
| `dependency_change` | Task dependency changes | -- |
| `budget_threshold` | Project budget utilization crosses threshold | `thresholdPercent` |
| `project_status_change` | Project status changes | `fromStatus`, `toStatus` |
| `manual` | Triggered via API | -- |

### Action Types

| Action | Effect |
|--------|--------|
| `update_field` | Updates a task field to a specified value |
| `log_activity` | Logs an activity entry on the task |
| `send_notification` | Creates a real notification via NotificationService (notifies the project manager) |
| `invoke_agent` | Invokes a registered agent capability inline (e.g., auto-reschedule) |

### Event-Driven Execution

Workflows are triggered automatically by task and project lifecycle events:

- **Task events:** `ScheduleService.createTask()` and `updateTask()` call `evaluateTaskChange()` (fire-and-forget)
- **Project events:** `ProjectService.update()` calls `evaluateProjectChange()` on budget or status changes
- **Overdue scanner:** A 15-minute cron in `AgentSchedulerService` detects newly-overdue tasks and fires `date_passed` triggers

All event-driven calls are non-blocking -- they use `.catch()` so workflow failures never break task or project operations.

### Natural Language Workflow Builder

Users can generate workflow definitions from plain English descriptions:

1. Navigate to **Workflows** in the sidebar.
2. In the **Generate with AI** section, type a description of the desired automation (10-500 characters).
3. Click **Generate** — the AI analyzes available triggers, actions, and conditions and returns a complete workflow definition.
4. The generated workflow populates the editor form for review. Users can edit nodes, add/remove steps, and adjust configuration before saving.
5. Click **Create Workflow** to save.

**API:** `POST /api/v1/workflows/generate` with `{ description: string, projectId?: string }`. Requires `write` scope.

The system prompt enumerates all available trigger types, action types, condition operators, and node types so the AI produces valid, executable workflows.

### Execution Model

- Each workflow definition is versioned and can be project-scoped or global
- Edges support condition expressions and sort ordering for deterministic branching
- Execution state is persisted per-node with statuses: pending, running, completed, failed, skipped, waiting
- Full execution history is retained with start/end timestamps and error messages
- Executions can be running, completed, failed, cancelled, or waiting (paused at an approval or delay node)
- All workflow actions are recorded in the audit ledger

---

## 6. Approval and Change Management

### Approval Workflows

The `ApprovalWorkflowService` defines multi-step approval chains scoped to a project and entity type. Each step specifies an approver role and execution order.

### Change Requests

Change requests capture proposed modifications with:

- Title, description, category, and priority
- Impact summary
- Status progression through workflow steps
- Link to an approval workflow (optional)
- Full action history with comments per step

### Approval Actions

Each step in a change request records: who acted, what action they took (approve/reject), optional comment, and timestamp. All actions are written to the audit ledger.

---

## 7. Sprint / Agile

### Sprint Tab Header

The Sprint tab header shows at-a-glance status for the active sprint:

- **Progress bar** — Colored bar showing task completion percentage (amber < 50%, blue 50-99%, green 100%).
- **Day progress indicator** — "Day X of Y" label with a mini progress bar showing elapsed time within the sprint timebox.
- **View switcher** — Toggle between List, Planning, Board, Burndown, Flow, and Capacity views when a sprint is selected.

### Sprint List

All sprints displayed as cards with status badges, date ranges, task progress bars, and velocity data. Features:

- **Sorting** — Cycle between status-first (active → planning → completed → cancelled), date, and name sorting via the sort toggle button.
- **Velocity sparkline** — Mini SVG chart in the header showing velocity trend across the last 6 completed sprints.
- **AI Retrospective** — Completed sprints show a book icon to generate an AI-powered retrospective summary.

### Sprint Planning

The Sprint Planning Panel shows a two-column layout:

- **Backlog** (left) — Tasks not yet assigned to a sprint, with search bar and priority filter dropdown to narrow results. Shows total backlog count in header.
- **Sprint backlog** (right) — Tasks added to the current sprint with running point total.
- **Story point totals** — Running count vs. velocity commitment displayed in sprint header.

Use the add/remove buttons on each task card. Each card shows name, status badge, priority badge, assignee, and story points.

### Sprint Board

A Kanban-style board scoped to a single sprint with three columns (Todo, In Progress, Done). Features:

- **Drag-and-drop** — Drag cards between columns to update task status (optimistic UI update).
- **WIP limits** — Click the gear icon on any column header to set a work-in-progress limit. Column highlights amber when at or over limit.
- **Swimlanes** — Toggle the Swimlane button to group tasks by assignee, with avatar headers for each group.
- **Deterministic avatars** — Assignee avatars use a consistent color from an 8-color palette based on name hash.
- **Story points** — Per-column and total point counts shown in headers.

### Burndown Charts

The `BurndownService` computes daily remaining work for a sprint, producing the classic burndown line. Features:

- **Ideal vs actual** — Dashed ideal line alongside solid actual burndown line.
- **Summary stats** — Four metric tiles: Total, Completed, Remaining (points), Days Left.
- **Today marker** — Vertical dashed amber line at the current date.
- **Interactive tooltips** — Hover data points to see date, remaining points, and ideal comparison.

### Velocity Tracking

Historical sprint velocity (story points or task count completed per sprint) is tracked across sprints to support future capacity planning.

### Dark Mode & Mobile

All sprint components support full dark mode with appropriate contrast for cards, badges, charts, and SVG elements. Mobile responsive layouts use flex-wrap, condensed button labels, and adjusted column widths for small screens.

---

## 8. Time Tracking

### Time Entries

The `TimeEntryService` records individual time logs:

- Associated task and project
- Hours worked, date, description
- Billable flag
- Created-by user

### Timesheets

Aggregated time entry views per user per week, suitable for approval workflows and payroll integration. The Timesheet page includes a **"Log Time"** button that opens an inline form with project, schedule, and task dropdowns plus date, hours, and description fields, allowing time entries to be created directly from the timesheet without navigating away. Mobile week navigation icons are also displayed correctly on small screens.

### Actual vs. Estimated

Compare logged hours against task estimated effort to identify underestimation patterns and improve future planning accuracy.

---

## 9. Custom Fields

### Per-Project Field Definitions

The `CustomFieldService` allows each project to define additional metadata fields:

| Field Type | Description |
|------------|-------------|
| **text** | Free-form string |
| **number** | Numeric value |
| **date** | Date picker |
| **dropdown** | Single-select from predefined options |
| **checkbox** | Boolean toggle |

Custom field values are stored per-entity (task, project) and included in search, filtering, and report outputs.

---

## 10. File Attachments

### Upload and Storage

The `FileAttachmentService` handles file uploads with:

- Configurable storage backend
- File size and type validation
- Unique file naming to prevent collisions

### Versioning

Multiple versions of a file can be uploaded to the same attachment slot. Previous versions are retained.

### Entity Linking

Attachments can be linked to any entity type (project, task, change request) via entity_type and entity_id references.

---

## 11. Monte Carlo Simulation

### Probabilistic Schedule Analysis

The `MonteCarloService` runs configurable simulations (default: 10,000 iterations) over the task dependency graph using PERT or triangular distributions derived from optimistic, most-likely, and pessimistic duration estimates.

### Outputs

- **Confidence levels**: P50, P80, P90 (or any custom percentiles) for project completion duration
- **Histogram**: distribution of simulated project durations in configurable bin widths
- **Sensitivity analysis**: which tasks contribute most to overall schedule variance
- **Criticality index**: percentage of iterations in which each task appears on the critical path
- **Tornado diagram data**: ranked sensitivity items for visualization

**Trial user behavior:** Trial users who click "Run Simulation" see a sample Monte Carlo result populated with realistic demo data instead of a 403 error. The sample includes duration forecast cards (P50: 142 days, P80: 158 days, P90: 168 days), a 10-bin histogram, sensitivity analysis for 5 sample tasks ranked by correlation, a criticality index for 5 sample tasks, and a cost forecast (P50: $485K, P80: $538K, P90: $572K). A simulation metadata footer shows 10,000 iterations using the PERT model. An amber banner reads: "Sample Simulation — This is a sample simulation with demo data. Upgrade to a paid plan to run Monte Carlo simulations on your actual project schedules." No computation or database queries are performed for the sample. This follows the same pattern as the sample status report and EVM features.

---

## 12. Network Diagrams

### PERT / Precedence Visualization

The `NetworkDiagramService` computes a layout of the task dependency graph suitable for rendering as a precedence diagram (Activity-on-Node). Each node includes:

- Task name, duration, ES, EF, LS, LF, total float
- Critical path flag
- X/Y position coordinates for rendering

Edges connect predecessor to successor nodes with critical-path highlighting.

---

## 13. AI Features

All AI features use the Anthropic Claude SDK and are gated behind the `AI_ENABLED` environment variable. When disabled, the system operates as a fully functional non-AI PM tool.

### Auto-Reschedule

The `AutoRescheduleService` detects delayed tasks and generates reschedule proposals:

1. Identifies tasks that have slipped past their planned dates
2. Analyzes downstream impact through the dependency graph
3. Uses AI to generate proposed date changes with rationale
4. Proposals are stored for review -- users accept, reject, or provide feedback

### Natural Language Queries

The `NLQueryService` implements a multi-step AI pipeline:

1. **Tool-loop phase**: Claude gathers real data using read-only tools (list projects, get EVM metrics, get critical path, get resource workload, etc.)
2. **Structuring phase**: raw answer is formatted into structured JSON with narrative, data tables, suggested charts, and follow-up questions

Users ask questions like "Which projects are over budget?" or "Show me the critical path for Project Alpha" and receive data-backed answers.

**Trial User Experience:** Trial users who submit a query on the Ask AI page are not blocked with a 403. Instead, `POST /api/v1/nl-query` returns a **sample NL query response** with demo data: a short narrative answer, a sample bar chart (task status breakdown across demo projects), and 3 suggested follow-up questions. An amber upgrade banner reads: "Sample Query — This is a sample response with demo data. Upgrade to a paid plan to query your real project data." No AI tokens are consumed for the sample. This follows the same pattern as Status Reports, EVM, and Monte Carlo.

### Meeting Intelligence

The `MeetingIntelligenceService` processes meeting transcripts or notes to extract:

- Action items with assignees and due dates
- Key decisions made
- Risk items identified
- Follow-up topics

**Trial User Experience:** Trial users who submit a transcript on the Meeting Minutes page are not blocked with a 403. Instead, `POST /api/v1/meeting-intelligence/analyze` returns a **sample meeting analysis** populated with realistic demo data: a brief executive summary, 3 sample action items (with assignees and due dates), 2 sample decisions, 1 sample risk, and 1 task update suggestion. An amber upgrade banner reads: "Sample Meeting Analysis — This is a sample analysis with demo data. Upgrade to a paid plan to process your real meeting transcripts." The **Apply Changes** button (to convert action items into tasks) and the meeting **History** list remain gated — they are hidden or disabled for trial users. No AI tokens are consumed for the sample. This follows the same pattern as Status Reports, EVM, and Monte Carlo.

### Lessons Learned

The `LessonsLearnedService` captures and retrieves project retrospective insights, categorized and searchable, to improve future project execution. Lessons can be edited and deleted directly from the Lessons Learned page: the edit action opens the same lesson modal pre-filled with existing values; the delete action presents a styled `ConfirmModal` before removing the record. The page supports **"Load More" pagination** so large lesson databases load incrementally rather than all at once.

### Task Prioritization

The `TaskPrioritizationService` uses AI to rank tasks based on:

- Dependency criticality
- Resource availability
- Deadline proximity
- Business impact

### Predictive Intelligence

The `predictiveIntelligence` module provides AI-driven assessments:

- **Project health scoring**: overall health grade with contributing factors
- **Risk assessment**: identified risks with probability, impact, and mitigation strategies
- **Budget forecasting**: AI-adjusted budget projections considering trends and project context
- **Dashboard predictions**: aggregated portfolio-level predictions

### Task Slip Prediction

The `predictTaskSlips()` method analyzes individual tasks to predict which are likely to slip, using deterministic scoring:

- **Overdue factor** (40%): Days past due relative to task duration
- **Progress gap** (30%): Actual vs expected progress based on elapsed time
- **Dependency factor** (20%): Incomplete predecessor count
- **Duration factor** (10%): Longer tasks carry higher inherent risk

Returns the top 20 at-risk tasks with slip probability, severity, reasons, and suggested actions. Available at `GET /api/v1/predictions/project/:projectId/task-slips`.

### Scope Creep Detector

Deterministic analysis comparing current project state against baselines:

- **Task count delta**: New tasks added since baseline
- **Estimate growth**: Cumulative duration increase across tasks
- **Change request count**: Open change requests
- **Schedule health**: Percentage of tasks on track or ahead

Severity thresholds: critical (10+ new tasks or 20+ days growth), high (5+/10+), medium (3+/5+ or 2+ change requests). Available at `GET /api/v1/predictions/project/:projectId/scope-creep`.

### AI Status Report Generator (RAG Traffic Light)

AI-powered executive status report with a Red/Amber/Green (RAG) traffic light dashboard. Claude analyzes project data and produces a structured JSON response that is rendered as styled HTML for both the UI modal and email delivery.

**Report Format:**
1. **Executive Summary** — AI-generated paragraph summarizing overall project health, key concerns, and outlook
2. **Traffic Light Dashboard** — Table with 6 areas (Schedule, Budget, Resources, Risks, Scope, Quality), each showing:
   - Previous status (from last stored report)
   - Current RAG status (🟢 Green / 🟡 Amber / 🔴 Red)
   - Trend arrow (↑ Improving / → Stable / ↓ Declining)
   - Comments explaining the assessment
3. **Actions for Management** — Numbered list of recommended management actions

**RAG Thresholds (configurable):**
- Schedule: Green = <5% tasks overdue, Amber = 5–15%, Red = >15%
- Budget: Green = <90% spent vs progress, Amber = 90–100%, Red = >100%
- Resources: Green = 0 overallocated, Amber = 1–2, Red = 3+
- Risks: Green = 0 high/critical, Amber = 1–2 high, Red = 3+ or any critical
- Scope: Green = 0 change requests, Amber = 1–2 pending, Red = 3+ or unapproved growth
- Quality: Green = <5% tasks missing data, Amber = 5–15%, Red = >15%

**Trend Computation:** Compares current RAG status against the previous report (stored in `ai_conversations` with `context_type = 'status-report'`). If current is better than previous → improving (↑), same → stable (→), worse → declining (↓).

**API Endpoints:**
- `POST /api/v1/status-reports/generate` — Generate a status report for a project, optionally email it to recipients
- `POST /api/v1/status-reports/schedule` — Create a recurring schedule (daily/weekly/monthly) with recipient list
- `GET /api/v1/status-reports/schedules/:projectId` — List active schedules for a project
- `DELETE /api/v1/status-reports/schedule/:id` — Delete a schedule (owner or admin only)

**MCP Tool:** `generate-status-report` — Available to project_manager, scrum_master, pmo, ba, and admin roles.

**Trial User Experience:** Trial users are not blocked with a 403. Instead, the endpoint returns a **sample status report** populated with realistic demo data (green/amber RAG statuses, trend arrows, and example management actions). An amber upgrade banner appears above the report reading "This is a sample report with demo data. Upgrade to a paid plan to generate AI-powered status reports…". The report is rendered at reduced opacity (80%). The Email, Schedule, and Download tabs/buttons are locked with a lock icon. No AI tokens are consumed for the sample report. Paid tier users are unaffected — full AI-powered reports are generated as normal.

**Feature Gating:** Full AI report generation requires a paid tier (consultant/sme/enterprise). AI generation requires `AI_ENABLED=true`; falls back to all-amber template when disabled. Email delivery requires `RESEND_API_KEY`.

### Anomaly Detection

The `anomalyDetectionService` identifies unusual patterns in project data such as sudden progress drops, budget spikes, or resource utilization anomalies.

### What-If Scenarios

The `whatIfScenarioService` allows users to model hypothetical changes (adding resources, extending deadlines, changing scope) and see projected impacts before committing.

### Cross-Project Intelligence

The `crossProjectIntelligenceService` analyzes patterns across the entire portfolio to surface systemic risks, resource conflicts, and optimization opportunities.

**Trial User Experience:** Trial users who access Portfolio Intelligence or Anomaly Detection are not blocked with a 403. The Portfolio Intelligence endpoint (`GET /api/v1/intelligence/portfolio`) and Anomaly Detection endpoint (`GET /api/v1/intelligence/anomalies`) each return **sample data** with realistic demo results: sample risk summaries, resource conflicts, and anomaly flags drawn from fictitious projects. An amber upgrade banner reads: "Sample Intelligence — This is a sample analysis with demo data. Upgrade to a paid plan to run cross-project intelligence on your real portfolio." The **What-If Scenarios** endpoint (`POST /api/v1/intelligence/scenarios`) remains fully gated — trial users who attempt to submit a scenario see a standard upgrade prompt without sample data. The Scenario Modeling page shows the same amber sample banner when loaded. No AI tokens are consumed for the sample portfolio and anomaly responses.

### Mjuzi Chat

**Mjuzi** is the AI project assistant, available as a slide-out chat panel on every page. The `aiChatService` provides a conversational interface where users can ask open-ended questions about their projects and receive AI-generated responses grounded in actual project data.

All Mjuzi-related surfaces are grouped under a **”Mjuzi AI”** section in the sidebar:
- **AI Query** (previously “Ask AI”) — natural language query interface at `/nl-query`
- **AI Proposals** (previously “Agent”) — agentic proposal review at `/agent`
- The chat panel header reads **”Mjuzi AI Chat”** (previously “AI Assistant — Powered by Claude”)

**Key features:**
- **Persistent conversations** — chat history is stored in the database (`chat_conversations` + `chat_messages` tables) and survives server restarts. Users can browse, switch between, and resume past conversations from the history panel.
- **Agent memory integration** — Mjuzi injects recent agent scan findings (via `InterAgentQueryService`), prior conversation context, and its own project-specific memories into the system prompt, enabling more informed and contextual responses.
- **Action memory** — when Mjuzi executes tools (create task, update project, etc.), it stores a memory of the action via `AgentMemoryService` for future reference.
- **Voice input** (browser Speech Recognition): users can click the mic, speak their message, and the transcript is sent as a normal chat message. Optional **text-to-speech** (“Speak replies”) reads the assistant’s replies aloud when enabled.
- **Conversation history UI** — History button and New Conversation button in the chat panel header. Click any past conversation to reload it.

### AI Reports

The `aiReportService` generates narrative project reports using AI, summarizing status, risks, and recommendations in natural language.

### Proactive Alerts

The `proactiveAlertService` continuously monitors project metrics and generates alerts when thresholds are breached (schedule slip, budget overrun, resource over-allocation).

### Agent Proposals UI

The `/agent` page (`AgentProposalsPage`) lets managers and admins review, approve/reject, execute, rollback, and rate agentic proposals. The page uses **"Load More" pagination** so only an initial batch of proposals is rendered at startup; clicking "Load More" appends the next batch, keeping the page responsive for teams with a large proposal history.

---

## 14. Reporting

### Custom Report Builder

The `ReportBuilderService` provides a configurable report engine:

- **Report templates**: saved configurations with named sections, sharable across users
- **Section types**: KPI cards, tables, bar charts, line charts, pie charts
- **Data sources**: projects, tasks, time entries, budgets
- **Filters**: date range, project, status
- **Group-by**: aggregate data by any dimension; the `groupBy` parameter is validated against an allowlist to prevent SQL injection

**Recent fixes:**
- KPI, chart, and table sections now receive correctly shaped data objects, resolving blank section renders in the report preview.
- Regular users can delete their own report templates (previously required admin role).
- The Report Designer correctly persists all configured sections when updating an existing template.

**Trial User Experience:** Trial users who navigate to the Report Builder are not blocked with a 403. Instead, `GET /api/v1/report-builder/templates` returns **3 sample report templates** (Weekly Status, Budget Overview, Time Tracking) so the page renders meaningfully. The **New Report**, **Edit**, **Generate**, and **Delete** buttons are hidden or replaced with an "Upgrade to use" label — trial users cannot create, modify, generate, or delete templates. An amber upgrade banner at the top of the page reads: "Sample Templates — You are viewing sample report templates. Upgrade to a paid plan to build and generate custom reports." No database writes are performed for trial users on this page.

### AI-Generated Reports

The AI report endpoint generates narrative compliance and status reports using Claude, grounded in real project data.

### Portfolio Analytics

The `AnalyticsSummaryService` computes portfolio-level KPIs:

- Total projects by status
- Budget utilization across portfolio
- Resource allocation summary
- Schedule performance overview
- **On Track percentage** — displayed on the dashboard; calculated using actual schedule variance (SPI) and budget variance (CPI/budget ratio) rather than a progress threshold heuristic, so the metric accurately reflects project health

### Portfolio Dashboard

The `/api/v1/reporting/portfolio` endpoint performs server-side aggregation and returns per-project enrichment data alongside the standard project fields:

- `budgetAllocated` / `budgetSpent` — drawn from the project's budget fields
- `progressPercentage` — weighted average of task progress across all project tasks
- `totalTasks` / `completedTasks` — task count summary
- Full task detail array for client-side drill-down

The Portfolio page UI consumes this endpoint and renders a full dashboard:

- **6 KPI cards** at the top: Total Projects, Active, On Track, At Risk, Budget Allocated, Budget Spent
- **Status filter pills** — click to filter the project card grid by status (All, Active, On Hold, Planning, Completed)
- **Portfolio budget progress bar** — aggregate allocated vs. spent across all visible projects
- **Project cards** — each card shows name, status badge, health indicator, progress bar, task completion ratio, budget utilization bar, and a link to the project detail page
- **Dashboard / Timeline / Resources toggle** — switch between the KPI dashboard view, Portfolio Gantt timeline, and portfolio-wide resource view; selection persists within the session

### Portfolio Analytics Panels

The `/api/v1/reporting/portfolio/analytics` endpoint aggregates EVM metrics, burndown data, and health history across all active/planning projects. It uses `generateMetricsOnly()` (no AI call) for speed, processes projects with bounded concurrency (5), and caches results in Redis for 5 minutes per user.

Returns per-project: CPI, SPI, last-8-week CPI/SPI trend arrays, burndown sparkline data (sampled to ~12 points), percent complete, health score + trend direction, budget utilization, and schedule variance.

The Portfolio page renders three analytics sections between the budget overview bar and Health Trends widget:

- **CPI/SPI Comparison Table** — rows per active project with color-coded CPI/SPI values (green ≥1.0, amber 0.85–0.99, red <0.85), SVG sparkline trend lines, and sortable columns
- **Burndown Trends** — mini burndown sparklines per project (ideal gray dashed + actual blue solid), completion percentage, and schedule variance badge (green positive / red negative)
- **Project Comparison Matrix** — fully sortable table comparing Health (colored dot + score), CPI, SPI, Budget %, Progress (with mini bar), Tasks (completed/total), and Status badge. Click any row to navigate to the project detail page

Projects without EVM or schedule data show graceful "—" fallbacks in all panels.

### Portfolio Resources View

The `/api/v1/reporting/portfolio/resources` endpoint aggregates resource utilization across all active projects:

- **KPI cards**: Total Resources, Over-Allocated Count, Avg Utilization, Weekly Cost
- **Cross-project contention table**: resources assigned to 2+ projects with combined utilization > 100%, showing each project and its utilization share
- **Resource utilization table**: all resources sorted by utilization (descending), showing role, cost rate, project count, combined utilization, and project names

---

## 15. Notifications

### In-App Alerts

The `NotificationService` delivers notifications to users with:

- **Severity levels**: critical, high, medium, low
- **Type classification**: task_assigned, task_completed, deadline_approaching, task_comment, member_added, agent_proposal, raid_item, system_alert, mention, and more
- **Entity linking**: link to specific project, schedule, or entity
- **Read/unread tracking**
- **WebSocket delivery**: real-time push via the `WebSocketService`
- **Bulk mark-as-read**

### Notifications Center Page

A full-page notification center is available at `/notifications`, accessible from the sidebar ("Notifications" under Workspace) and from the "View all alerts" link in the notification bell dropdown. The page provides:

- **Severity summary cards** at the top: clickable cards showing counts for Critical, High, Medium, and Low notifications. Clicking a card filters the list to that severity.
- **Filter panel**: filter by notification type (Risk, Budget, Schedule, Resource, etc.) and severity level.
- **Full notification list**: each entry shows a severity color bar, type icon, title, message, relative time ("2 hours ago"), type label, and project name.
- **Mark as read**: mark individual notifications as read (calls `apiService.markNotificationRead` so read state persists across page refreshes), or click "Mark all read" to clear all unread indicators at once.
- **Load More pagination**: a "Load More" button at the bottom of the list fetches the next page of notifications, avoiding unbounded list rendering on accounts with many notifications.
- **Data sources**: fetches both proactive alerts and persisted database notifications into a unified list.
- Uses the same severity colors and type icons as the existing notification bell dropdown for visual consistency.

### Real-Time Presence

When multiple users view the same project, avatar circles appear in the project header showing who else is currently viewing. Presence is ephemeral (in-memory on the server) and updates instantly via WebSocket. Avatars show user initials with a tooltip displaying the full username. The current user is filtered out. Up to 5 avatars are shown, with a "+N" overflow indicator for larger teams.

### Email Notifications & Digests

Critical and high-severity notifications are automatically sent via email (Resend) to users with `emailNotificationsEnabled = true` and a verified email. Users can configure a **digest frequency** (none, daily, weekly) in Settings > Notifications. The `DigestService` runs daily at 7 AM via cron and sends a summary containing:

- **Overdue tasks** assigned to the user
- **Upcoming deadlines** (next 3 days)
- **Unread notification count**

Preferences are stored in the database (`users.email_notifications_enabled`, `users.digest_frequency`, `users.digest_last_sent_at`, `users.notification_type_preferences`) and managed via `PUT /api/v1/users/me/notification-preferences`.

#### Per-Category Notification Preferences

Users can control which categories of notifications they receive, with independent toggles for in-app and email delivery:

| Category | Notification types covered |
|----------|---------------------------|
| Agent & Proposals | agent_proposal, agent_low_confidence, agent_execution_complete/failed, agent_notification, agent_rollback |
| Risks & Issues | raid_item, reschedule_proposal |
| Budget & Finance | budget_alert, ai_budget_warning, monte_carlo_alert |
| Meetings & Followups | meeting_followup |
| System Alerts | system_alert, workflow_action (always ON for admins) |
| Tasks | task_assigned, task_completed, task_comment |
| Collaboration | member_added |
| Deadlines & Overdue | deadline_approaching |

#### PM Workflow Notifications

Common project management events now generate notifications automatically:

| Event | Type | Severity | Recipient |
|-------|------|----------|-----------|
| Task created with assignee | `task_assigned` | medium | Assignee (if different from creator) |
| Task reassigned | `task_assigned` | medium | New assignee (if different from updater) |
| Task completed | `task_completed` | low | Task creator (if different from updater) |
| Deadline within 2 days | `deadline_approaching` | high | Assignee (or creator if unassigned) |
| Comment on task | `task_comment` | low | Assignee (if not the commenter and not @mentioned) |
| Added to project | `member_added` | low | Added user |

Deadline notifications run daily at 8:00 AM via cron (`deadline-check` job). Redis deduplication prevents the same task from generating repeat notifications on the same day.

When a category's in-app toggle is off, notifications of that type are not inserted into the database or broadcast via WebSocket. When the email toggle is off, emails are suppressed even for critical/high severity. System alerts are never suppressed for admin users. New users (NULL preferences) default to all categories ON.

### Scheduled Report Delivery

Report templates from the Report Builder can be scheduled for automatic email delivery. Configuration is stored in the `report_schedules` table with:

- **Frequency**: daily, weekly (pick day of week), or monthly (pick day of month)
- **Time of day**: configurable delivery time
- **Recipients**: comma-separated email list
- **Format**: CSV attachment via Resend

The `ReportScheduleService` executes due schedules every 15 minutes via cron. Each execution generates the report, exports to CSV, and emails to all recipients. API endpoints at `/api/v1/report-schedules` provide full CRUD. The schedule modal is accessible via the clock icon on each report template card in the Report Builder.

---

## 16. Stakeholder Portal

### Token-Based Access

The `PortalService` generates shareable portal links with:

- Unique token per link
- Configurable permissions (read-only by default)
- Optional expiration date
- Active/inactive toggle
- Label for identification

### Public Views

Portal token holders can access without authentication:

- **Project overview and status** — name, description, status badge, and computed progress percentage (completed tasks / total tasks)
- **Budget summary** — allocated, spent, remaining, and budget usage bar (requires `canViewBudget` permission; hidden when budget is zero)
- **Timeline** — project start/end dates with days-remaining indicator (falls back to task date range when project dates are null)
- **Milestone timeline** — vertical timeline of tasks marked as milestones, color-coded by status: green (completed), blue (in-progress), gray (not started). Controlled by `canViewGantt` permission.
- **Recent activity** — last 10 completed tasks with relative timestamps (e.g., "2h ago", "3d ago"). Controlled by `canViewReports` permission.
- **Task statistics** — total, not started, in-progress, and completed counts

### Stakeholder Comments

External stakeholders can submit comments on project entities through the portal, identified by author name rather than system user account. Comments are displayed in reverse chronological order with the commenter's name and timestamp. The comment form includes name and message fields with dark mode support. Comments are scoped per portal link — two links to the same project maintain separate comment threads.

### Portal Security

**Server-side permission enforcement:** The backend filters the API response based on the token's permissions. When a permission is denied, the data is never queried or returned — not just hidden on the client:

- `canViewBudget: false` → `budgetAllocated` and `budgetSpent` return as 0
- `canViewGantt: false` → `milestones` array is empty (query skipped)
- `canViewReports: false` → `recentActivity` array is empty (query skipped)
- `canComment: false` → `comments` array is empty; `POST /view/:token/comment` returns HTTP 403

**Input sanitization:** Comment `authorName` and `content` are stripped of HTML tags before storage to prevent stored XSS.

**Project-level access control:** All authenticated portal management routes (`POST /links`, `GET /links`, `PUT /links/:id`, `DELETE /links/:id`, `GET /comments`) enforce project membership via `requireProjectAccess`. Admin and PMO roles bypass this check; executives get read-only access.

**Comment pagination:** `findComments()` defaults to a limit of 100 results to prevent unbounded queries.

---

## 17. Intake Forms

### Dynamic Form Builder

The `IntakeFormService` supports creating intake forms with configurable fields:

- Field types: text, number, date, select, checkbox, textarea
- Required/optional validation
- Dropdown option lists
- Active/inactive form status

### Submission Tracking

Submissions flow through a review pipeline:

- Submitted -> Under Review -> Approved / Rejected
- Reviewer assignment and notes
- Conversion to project: approved submissions can be automatically converted into new projects

---

## 18. Templates

### Project Templates

The `TemplateService` allows saving a project's structure as a reusable template:

- Template name, description, category
- Serialized project configuration (tasks, phases, dependencies, custom fields)
- Shared or private visibility
- Apply a template to create a new project with pre-populated structure

---

## 19. Integrations

### Supported Providers

| Provider | Adapter | Capabilities |
|----------|---------|-------------|
| **Jira** | `JiraAdapter` | Bi-directional task sync, status mapping |
| **GitHub** | `GitHubAdapter` | Issue sync, PR status tracking |
| **Slack** | `SlackAdapter` | Event notifications, `/kovarti status` slash command, interactive proposal buttons |
| **Trello** | `TrelloAdapter` | Card sync, board mapping |

### Slack Integration

The Slack integration provides three capabilities:

1. **Event Notifications** — Automatic Slack messages when key events occur:
   - Task completed
   - Risk/issue/action/decision created
   - Sprint started or completed
   - Project status changed
   - Agent proposal created (with interactive Approve/Reject buttons)

2. **Slash Command** (`/kovarti status <project name>`) — Returns an ephemeral Block Kit message with the project's status, priority, methodology, and dates.

3. **Interactive Buttons** — Agent proposals sent to Slack include Approve/Reject buttons. Clicking them records a review with the Slack username in the audit trail.

**Configuration:**
- Set `SLACK_SIGNING_SECRET` and `SLACK_BOT_TOKEN` environment variables
- Create a Slack integration per project with the incoming webhook URL
- Optionally configure `notifyEvents` array in the integration config to filter which events trigger notifications

**Security:** All inbound requests (`/api/v1/slack/commands`, `/api/v1/slack/interactivity`) are verified using HMAC-SHA256 with the Slack signing secret. Timestamps older than 5 minutes are rejected.

### Webhooks

The `WebhookService` allows registering outbound webhook endpoints that fire on configurable events (task created, status changed, project updated, etc.). Each delivery is logged with status and retry support.

### Integration Management

- Per-project or global integration configuration
- Credential storage in encrypted config blobs
- Sync logging with direction (inbound/outbound), item counts, and error tracking
- Last-sync timestamp for monitoring
- Destructive actions (delete integration, delete webhook, revoke API key, delete change request, delete intake form, delete report template, delete goal) use a reusable `ConfirmModal` component instead of the browser's native `window.confirm()`, providing a consistent, styled confirmation dialog that respects the application's dark mode and design system

---

## 20. Security

### Authentication

- **JWT tokens**: issued on login, stored in HttpOnly cookies with configurable expiration
- **Password hashing**: bcrypt with configurable salt rounds
- **Registration**: username, email, password, full name
- **Password reset**: token-based email flow via `EmailService`
- **Session management**: refresh token rotation
- **OAuth 2.1**: PKCE-based authorization for MCP HTTP transport (per-user access from Claude Desktop/Web)

### Roles

Six user roles with hierarchical permissions:

| Role | Scopes | Description |
|------|--------|-------------|
| `admin` | read, write, admin | Full system access |
| `executive` | read | Portfolio oversight + approval authority |
| `project_manager` | read, write | Full project lifecycle management |
| `scrum_master` | read, write | Sprint and task management |
| `team_member` | read | Task work + time logging |
| `finance_officer` | read | Budget and financial visibility |

MCP tools are filtered by role — agents only see tools their role permits (see `mcp-server/src/permissions.ts`).

### API Keys

The `ApiKeyService` issues scoped API keys for programmatic access:

- Scope-based permissions (read, write, admin)
- **Role resolution**: API key auth resolves the user's actual database role (not inferred from scopes)
- Key hashing (only prefix stored in plaintext for identification)
- Expiration support
- Revocation

### Audit Ledger (Hash-Chain)

The `AuditLedgerService` maintains a tamper-evident append-only log:

- Every entry references the previous entry's SHA-256 hash, forming a hash chain
- Entries record: actor (user/api_key/system), action, entity type/ID, project, payload, source (web/mcp/api/system), IP address, session
- Chain integrity can be verified at any time
- Filterable by project, entity, actor, action, date range

### Policy Engine

The `PolicyEngineService` enforces configurable governance rules:

- **Action patterns**: match against specific operations (e.g., `task.delete`, `budget.update`)
- **Condition expressions**: field-based conditions with operators (>, <, ==, !=, in, contains, etc.)
- **Enforcement levels**: log_only, require_approval, block
- **Evaluation logging**: every policy evaluation is recorded with context snapshot
- Project-scoped or global policies

### AI Token Budget

The `AIBudgetService` enforces per-user monthly AI token limits with tier-aware budget resolution:

- **Per-tier defaults**: Trial — 25,000 tokens/mo; Consultant — 500,000; SME — 1,500,000; Enterprise — 5,000,000. Configurable via `AI_TIER_BUDGET_TRIAL`, `AI_TIER_BUDGET_CONSULTANT`, `AI_TIER_BUDGET_SME`, `AI_TIER_BUDGET_ENTERPRISE` env vars.
- **Budget resolution chain**: per-user override (`users.ai_monthly_token_budget`) → subscription tier default → global fallback (`AI_MONTHLY_TOKEN_BUDGET`)
- **Token top-ups**: Users can purchase additional token packs ($5 per 500K tokens) via Stripe one-time payment. Top-up tokens are added instantly, do not expire, and are consumed only after the monthly tier allowance is exhausted. FIFO consumption (oldest packs first). Managed by `TokenTopUpRepository`.
- Tracks all AI usage in the `ai_usage_log` table (input/output tokens, cost, latency, feature, model)
- Budget checked before every AI call in `claudeService` — throws `AIBudgetExceededError` (HTTP 429) with `code: 'AI_BUDGET_EXCEEDED'`, `resetDate`, `used`, and `budget` fields when exceeded
- **Graceful degradation**: When the budget is exhausted, AI features are blocked but all non-AI features (scheduling, task management, reporting, collaboration) remain fully operational. The Mjuzi chat displays an actionable message with the reset date and a link to purchase more tokens.
- **80% threshold warning**: When usage reaches 80%, a daily-deduped `ai_budget_warning` notification is automatically created (severity: high) informing the user of tokens remaining and days left in the month
- **Circuit breaker**: After 5 consecutive transient failures (rate limit, timeout, API overload), the AI circuit breaker opens and returns HTTP 503 immediately for 60 seconds instead of making doomed API calls. Recovers automatically after cooldown.
- `GET /api/v1/ai/budget` returns current month's usage summary: `totalInputTokens`, `totalOutputTokens`, `totalTokens`, `totalCost`, `requestCount`, `budget`, `remaining`, `percentUsed`
- **Admin override**: Admins can set per-user custom budgets via `PATCH /api/v1/admin/users/:id/budget`. The Admin Users page shows an inline-editable "AI Budget" column — set a custom value or clear to use tier default.

### Prompt Injection Mitigation

Defense-in-depth protection against prompt injection in AI-powered features. User-supplied data (project names, descriptions, task names, meeting notes) is sanitized before interpolation into system prompts:

- **Input sanitization** (`sanitizeForPrompt()`): Strips template markers (`{{`, `}}`), common injection phrases (`SYSTEM:`, `ignore previous instructions`, `Human:`/`Assistant:`, etc.), and truncates excessively long inputs (default 50,000 chars)
- **Structural delimiters**: `PromptTemplate.render()` wraps all interpolated values in `<user-data field="...">` XML tags, establishing a clear boundary between instructions and data
- **Defense preamble**: `buildSystemPrompt()` prepends an instruction telling the model to treat `<user-data>` content strictly as data to analyze, never as instructions to follow
- **Coverage**: Applied to all template-rendered prompts (task breakdown, risk assessment, project insights, reports, meeting notes, conversational), context builder output (project names, descriptions), and quality agent prompts (scope, hygiene, lessons)
- **Chat messages**: User chat input is sent as the Anthropic `user` role message (not interpolated into system prompts), which is the architecturally correct position for untrusted input

### Security Middleware

- Content Security Policy (CSP) via Helmet
- Rate limiting per endpoint
- CORS protection with environment-aware origins
- Input validation via Zod schemas on all routes (24 route files validated)
- Scope-based route protection via `requireScope` middleware

---

## 21. MCP Server

### Overview

A standalone Model Context Protocol (MCP) server (`mcp-server/server.ts`) enables Claude Desktop and Claude Web to interact with PM Assistant directly. It communicates over stdio transport and authenticates via API key.

### Available Tools

| Tool | Description |
|------|-------------|
| `list-projects` | List all projects |
| `get-project` | Get project details by ID |
| `get-schedules` | Get all schedules for a project |
| `get-tasks` | Get all tasks in a schedule |
| `get-project-health` | AI health score for a project |
| `get-project-risks` | AI risk assessment for a project |
| `get-project-budget` | AI budget forecast for a project |
| `get-spend-to-date` | Cumulative project spending with earned value and variance |
| `get-burn-rate` | Daily/monthly spending rate with EVM cost metrics |
| `get-analytics` | Portfolio-level analytics summary |
| `get-alerts` | Proactive alerts across all projects |
| `search` | Search projects and tasks by keyword |
| `get-portfolio` | Full portfolio overview |
| `suggest-risk-mitigations` | AI risk mitigation suggestions from historical lessons |
| `get-meeting-summary` | Extract summary, actions, and decisions from meeting transcript |

### MCP Proxy

The main application also exposes an `/mcp` reverse proxy route for HTTP-based MCP transport, allowing browser-based Claude integrations to connect through the production domain.

---

## 22. Billing

### Stripe Integration

The `StripeService` manages subscription billing:

- **Customer creation**: linked to user accounts
- **Multi-tier checkout**: Consultant ($19/mo or $190/yr), SME ($39/mo or $390/yr), Enterprise ($79/mo or $790/yr). Price IDs configured via `STRIPE_CONSULTANT_MONTHLY_PRICE_ID`, `STRIPE_SME_MONTHLY_PRICE_ID`, `STRIPE_ENTERPRISE_MONTHLY_PRICE_ID` (and annual variants).
- **Token top-up checkout**: One-time payment for 500K token packs ($5 each, 1-20 packs per purchase). Price ID via `STRIPE_TOPUP_PRICE_ID`. Webhook prevents double-processing via `findByStripeSession()`.
- **Billing portal**: self-service subscription management via Stripe's portal
- **Webhook handling**: processes Stripe events for subscription lifecycle (created, updated, cancelled, payment succeeded/failed) and top-up completion. Every event is written to the `subscription_events` table and logged to the audit ledger.
- **Tier resolution**: `resolveTierFromPriceId()` maps Stripe price IDs to app tiers (trial, consultant, sme, enterprise) with legacy fallback support
- **Revenue capture**: `amount_cents`, `currency`, and `billing_interval` are extracted from Stripe webhook payloads and stored on the `subscriptions` row so revenue figures are always queryable without a Stripe API call.

### Subscription Events

Every subscription lifecycle change is persisted to the `subscription_events` table:

- **Event types**: `tier_change`, `cancellation`, `renewal`, `payment_failure`, `topup_purchase`, `trial_started`, `trial_converted`
- **Revenue data**: `amount_cents` and `currency` recorded for all payment events
- **Deduplication**: `stripe_event_id` prevents double-writes on webhook retries
- Powers the Admin Revenue Dashboard and the per-user subscription event history modal

### Account Billing Page

The `AccountBillingPage` (`/account/billing`) shows:

- **Plan name**: dynamically resolved from the user's actual subscription tier — never hardcoded. Trial tier shows "Trial Plan", paid tiers show "Consultant Plan", "SME Plan", or "Enterprise Plan" accordingly.
- **Top-up balance**: remaining purchased token balance with a **Buy More** button linking to the token top-up Stripe checkout.
- **AI usage meter**: progress bar showing current-month token consumption vs the effective budget (tier allowance + top-up balance), color-coded green/amber/red.

### Viewer Invite Flow

Paid subscribers (Consultant, SME, and Enterprise tiers) can invite external client stakeholders as **viewer accounts** — free, read-only users who do not consume a paid seat.

**Invite limits by tier:**

| Tier | Viewer Invites |
|------|---------------|
| Trial | 0 (not available) |
| Consultant | 5 |
| SME | 20 |
| Enterprise | Unlimited |

**What viewers can do:**
- View any project they have been explicitly invited to (project name, status, progress, milestones, budget summary)
- Update RAID items where they are listed as the owner (status transitions only — the `viewer` user role restricts write access to owned RAID items exclusively)

**What viewers cannot do:**
- Create or delete projects, tasks, or any other entities
- Access projects they have not been invited to
- Access administrative settings, reports, API keys, or billing

**Invite flow:**
1. A paid user navigates to **Settings → Viewer Invites** (or the project's Members tab).
2. They enter the invitee's email address and select one or more projects to share.
3. The system checks the inviting user's remaining invite quota. If the quota is exhausted, the invite is blocked with a clear upgrade prompt.
4. An invitation email is sent to the invitee. If the email does not match an existing account, a viewer account is auto-provisioned on first acceptance.
5. The invitee clicks the link, completes registration (password only — no billing), and lands on a read-only project view.
6. The inviting user can revoke access at any time from their invite management panel.

**Role:** Invited viewers receive the `viewer` system role. This role has read scope only, plus the ability to update RAID items they own (see Section 45 for RAID role-based permissions).

### Trial Reminder Emails

The `EmailService` sends automated reminder emails to users approaching the end of their 14-day free trial:

| Days Before Expiry | Email Sent |
|--------------------|------------|
| 3 days | "Your trial ends in 3 days" reminder |
| 1 day | "Your trial ends tomorrow" reminder |
| 0 days (expiry day) | "Your trial has expired" notice |

A daily cron job runs at **09:00** to scan for trials expiring within the relevant windows and dispatch the appropriate email. Redis-backed deduplication prevents the same reminder from being sent more than once per user per trigger window — if the cron runs multiple times or a user is picked up on consecutive days for the same window, only one email is delivered.

### Pricing Page

The Pricing page (`/pricing`) presents three paid tiers (Consultant, SME, Enterprise) with monthly/annual billing toggle and a 17%-save badge on annual plans. Each plan card shows:

- Price and billing period
- AI token allowance with **practical usage equivalents** (e.g., "~100 AI chats, 50 risk scans, or 25 reports/mo") so users understand what their token budget means in real terms
- Feature list with checkmarks
- Subscribe / Switch Plan / Current Plan button (context-aware based on auth state and current tier)

Below the plan cards, a **Feature Comparison Matrix** provides a side-by-side table across all 4 tiers (Trial, Consultant, SME, Enterprise). Features are marked with checkmarks (included), X marks (excluded), or text values (e.g., "3", "1GB", "Unlimited"). The table covers projects, AI tokens, exports, API access, EVM, Monte Carlo, resource management, workflows, portal, intelligence features, meeting tools, MCP, storage, and top-ups.

| Feature | Trial | Consultant | SME | Enterprise |
|---------|-------|------------|-----|------------|
| Projects | 3 | Unlimited | Unlimited | Unlimited |
| AI Tokens/mo | 25K | 500K | 1.5M | 5M |
| Storage | 100MB | 1GB | 5GB | 10GB |
| Viewer Invites | 0 | 5 | 20 | Unlimited |
| Exports | ✗ | ✓ | ✓ | ✓ |
| API Keys | ✗ | ✓ | ✓ | ✓ |
| EVM | ✗ | ✓ | ✓ | ✓ |
| Monte Carlo | ✗ | ✓ | ✓ | ✓ |
| Auto-Reschedule | ✗ | ✓ | ✓ | ✓ |
| Resource Management | ✗ | ✓ | ✓ | ✓ |
| Custom Reports | ✗ | ✓ | ✓ | ✓ |
| DAG Workflows | ✗ | ✓ | ✓ | ✓ |
| Portal Management | ✗ | ✓ | ✓ | ✓ |
| Meeting Intelligence | ✗ | ✓ | ✓ | ✓ |
| NL Query | ✗ | ✓ | ✓ | ✓ |
| Cross-Project Intelligence | ✗ | ✓ | ✓ | ✓ |
| Token Top-Ups | ✗ | ✓ | ✓ | ✓ |
| Price (monthly) | Free | $19/mo | $39/mo | $79/mo |
| Price (annual) | Free | $190/yr | $390/yr | $790/yr |

A **Token Top-Up CTA** below the comparison table lets users purchase additional token packs ($5 per 500K).

**Checkout Error Display:** When a Stripe Checkout session fails to initialize (network error, invalid price ID, Stripe API error), the Pricing page displays an **inline error banner** in a styled red alert box.

### Feature Gating

Trial users have access to core project management features only. The following features are restricted to paid tiers (Consultant, SME, Enterprise):

| Restricted Feature | Trial | Paid Tiers |
|--------------------|-------|------------|
| Exports (CSV, PDF, XML) | ✗ | ✓ |
| API Keys | ✗ | ✓ |
| Earned Value Management (EVM) | ✗ | ✓ |
| Monte Carlo Simulation | ✗ | ✓ |
| Auto-Reschedule | ✗ | ✓ |
| Resource Management | ✗ | ✓ |
| Custom Report Builder | ✗ | ✓ |
| DAG Workflow Automation | ✗ | ✓ |
| Stakeholder Portal Management | ✗ | ✓ |
| Meeting Intelligence | ✗ | ✓ |
| Natural Language Query | ✗ | ✓ |
| Cross-Project Intelligence | ✗ | ✓ |
| Token Top-Ups | ✗ | ✓ |
| Viewer Invites | ✗ | ✓ |

When a trial user attempts to access a gated feature, the behavior depends on the feature:

- **Sample data pattern** — For the following 13 features, trial users receive realistic **sample/demo data** with an amber upgrade banner instead of a 403 error. No AI tokens are consumed, and no real project data is read or written:
  - Status Reports (`POST /api/v1/status-reports/generate`)
  - EVM Dashboard (`GET /evm` — sample KPI and forecast data)
  - Monte Carlo Simulation (`POST /api/v1/monte-carlo`)
  - Report Builder (`GET /api/v1/report-builder/templates` — 3 sample templates; create/edit/generate/delete locked)
  - Exports (CSV, XML, JSON/PDF — sample project with 5 tasks across 2 phases)
  - Cross-Project Intelligence (portfolio and anomaly detection endpoints — sample portfolio data; What-If Scenarios POST remains hard-gated)
  - Natural Language Query (`POST /api/v1/nl-query` — sample response with demo chart and follow-ups)
  - Meeting Intelligence (`POST /api/v1/meeting-intelligence/analyze` — sample analysis; Apply Changes and History remain gated)
  - Stakeholder Portal (`GET /api/v1/links/:projectId` — 2 sample portal links: Stakeholder Review Portal, Executive Dashboard; Create Link button hidden)
  - Workflow Automation (`GET /api/v1/workflows` — 3 sample workflow definitions: Task Status Notification, Overdue Escalation, Budget Alert; New Workflow and AI Generate section hidden)
  - Resource Management (`GET /api/v1/resources` — 4 sample resources: PM, Developer, QA, Designer with skills and rates; Add Resource button hidden)
  - Auto-Reschedule (`GET /api/v1/delays` — 3 sample delays; `GET /api/v1/proposals` — 1 sample proposal; Generate Proposal button disabled)
  - API Keys (`GET /api/v1/api-keys` — 2 sample keys: CI/CD Pipeline, Dashboard Read-Only; Create Key button hidden)

- **Hard gate (403)** — All remaining gated features (What-If Scenarios, Token Top-Ups, Viewer Invites) return HTTP 403 with `code: 'FEATURE_GATED'` and an upgrade prompt linking to the Pricing page.

Client-side gating provides an early upgrade prompt but is not the security boundary — enforcement is always server-side.

**Implementation notes:**

- A global `requireActiveSubscription` hook in `plugins.ts` blocks all POST/PUT/DELETE requests for expired trial users. POST-based sample endpoints (`/api/v1/nl-query`, `/api/v1/meeting-intelligence/analyze`) are added to the `SUBSCRIPTION_EXEMPT_PREFIXES` list so the in-handler trial check can return sample data instead of 403.
- For Portal Links, the trial check runs as a preHandler **before** `requireProjectAccess` — this avoids a 404 when the trial user's project ID doesn't exist in the database.
- For Meeting Intelligence, the trial check runs **before** Zod schema validation — this avoids a 400 when the trial user submits without required fields (projectId, scheduleId).
- Write/mutate endpoints for all 13 features remain hard-gated with `requireFeature()` — sample data is read-only.

---

## 23. Dashboard

All users see a single dashboard (`DashboardPM` via `DashboardRouter`) instead of the previous role-based dashboards. The dashboard is customizable per-user via a **Customize** dropdown that toggles widget sections on/off, with selections persisted in `localStorage`.

### Scope Toggle

When a user's own projects are a subset of the full portfolio (e.g., a `team_member` vs an `admin`), a **My Projects / All Projects** toggle appears in the header. Switching scope updates KPI tiles, the projects table, issues trend chart, milestones, and budget watch. The selected scope persists in `localStorage`.

### Widget Sections

| Widget | Description |
|---|---|
| **KPI Tiles** | 6 tiles: Portfolio Health, Overdue Tasks, Open Risks, At-Risk Projects, Budget Variance, Budget Utilization. Health and Overdue tiles show 7-day trend arrows (improving/declining/stable) computed from `AnalyticsSummaryService.trendIndicators`. |
| **Portfolio Intelligence** | AI-generated health score, risk summary, budget status, key insights, and optional AI narrative |
| **Projects Table** | Sortable table with health score column (colored dot + numeric), status, priority, progress, budget, end date |
| **Issues Trend** | SVG line chart showing issues created vs resolved per week (8-week window), with net change badge |
| **Milestones** | Upcoming milestones with project name, date, and days-until badge (green/red) |
| **Budget Watch** | Portfolio summary row (total allocated/spent, utilization %, over-budget count badge), top 5 projects by spend % with burn-rate-vs-progress indicator (red up arrow if burn exceeds progress, green down if under budget), progress marker on spend bar, and dollar amounts |
| **Recent Activity** | Latest notifications feed with filter pills (All / Agent / Risk / Budget / Meeting / System) and date grouping (Today / Yesterday / Earlier). Click any notification to navigate to the linked entity and mark it as read. "View All" link navigates to the full notifications page. |
| **Health Trends** | Sparkline health history per project |
| **Sprint Velocity** | Per-project velocity sparklines with average badge, trend arrow, sprint-over-sprint delta percentage, and commitment ratio (delivered vs committed). Portfolio aggregate row when multiple agile projects exist. Only shown for agile/hybrid projects. |
| **Sprint Snapshot** | Active sprints across projects with day progress, task completion bar, and velocity trend (default: off) |
| **Goals** | Objectives sorted by urgency with progress bars, status badges, and due dates. "View All" links to the Goals page (default: off) |
| **Team Workload** | Summary stats row (active resource count, overallocated count), per-resource task counts with horizontal bars, overload indicator (15+ tasks), multi-project overallocation warning (3+ projects, red octagon icon), capacity hours display, and color-coded avatar rings for flagged resources (default: off) |

### Backend Endpoints

Three new endpoints under `GET /api/v1/dashboard/`:
- **`/overdue-tasks`** — Tasks past due date, ordered by overdue days (limit 50)
- **`/issues-trend`** — Created vs resolved task counts per week bucket (fills empty weeks with zeros)
- **`/milestones`** — Upcoming milestones within 7 days past to future

All three support `?scope=portfolio` to bypass user filtering. Global roles (`admin`, `executive`, `pmo`) see all projects by default.

Additionally, `GET /api/v1/projects` and `GET /api/v1/analytics/summary` now accept `?scope=portfolio` to return unfiltered results regardless of user role.

---

## 24. Mobile-Optimized Views

The application includes mobile-optimized layouts that activate automatically on screens narrower than 768px (the `useBreakpoint()` hook, shared across all pages).

### Landing Page Mobile Navigation

On the public landing page, the horizontal navigation link row is replaced by a **hamburger menu** on mobile viewports (below 768px). Tapping the hamburger icon opens a vertical nav overlay with the same links. This prevents the nav from wrapping or overflowing on small screens.

### Bottom Navigation Bar

A fixed bottom navigation bar (`BottomNav`) replaces the sidebar on mobile, providing quick access to:
- Dashboard, Projects, Timesheet, Notifications, and More (opens sidebar overlay)

The main content area receives bottom padding (`pb-20`) to prevent overlap with the bottom nav.

### Mobile Task Cards

The `TaskCardMobile` component displays tasks in a touch-friendly card format with:
- Task name, status pill, priority badge, assignee, and due date
- Quick status cycle button (tap to advance: pending -> in_progress -> completed)
- Comfortable tap targets (min 56px height)

The `TaskListMobile` component wraps multiple cards with filter chips (status filter, "My Tasks" toggle).

### Mobile Schedule View

On mobile, the project Schedule tab renders a dedicated mobile experience with a **view switcher** offering three modes:

- **List view** — scrollable card-based task list using `TaskCardMobile` components with touch-optimized interactions.
- **Kanban view** — mobile-friendly Kanban board with horizontal scrolling columns.
- **Calendar view** — responsive calendar with Month/Week/Day modes.

The view toggle persists the selected mode. Each `TaskCardMobile` card supports:

- **Swipe-to-complete** — swipe right on a pending or in-progress task to reveal a green "Swipe to complete" background. Swipe past 80px and release to mark the task as completed. Completed and cancelled tasks cannot be swiped.
- **Status tap cycling** — tap the status badge to cycle through pending → in_progress → completed → pending. Cancelled tasks are excluded from cycling.
- **Touch-friendly layout** — 56px minimum height tap targets, priority badge, assignee, and due date displayed compactly.

### Mobile Timesheet

On mobile, the timesheet displays a card-per-day layout instead of the grid table. Each card shows the date, total hours, and a compact entry list. Week navigation is preserved.

### Responsive Layout Improvements (UI Improvement Sprint)

Several pages received targeted responsive fixes to avoid overflow and cramped layouts on small screens:

- **Notifications Page** — Severity summary cards use `grid-cols-2 sm:grid-cols-4`, stacking into two columns on mobile instead of forcing a fixed four-column layout.
- **Agent Proposals Page** — Proposal history stat cards use the same `grid-cols-2 sm:grid-cols-4` pattern.
- **Goals Page** — The new/edit goal modal form grid changes from a fixed `grid-cols-3` to `grid-cols-1 sm:grid-cols-3`, stacking fields vertically on mobile.
- **Resource Management Page** — The tab bar uses `overflow-x-auto` with `min-w-max` tabs for horizontal scroll instead of wrapping; tab labels display shortened names on mobile; the resource table container switches from `overflow-hidden` to `overflow-x-auto` so wide tables scroll cleanly.
- **Project Detail Page** — Action buttons condense on mobile (Status Report label hidden, Save as Template button hidden on small screens); tab navigation changes from `flex-wrap` to `overflow-x-auto` horizontal scroll with `min-w-max` tab items.
- **Portfolio Page** — Project Comparison, CPI/SPI, and Resource Utilization tables get `min-w-[600–700px]` so wide data tables scroll horizontally instead of compressing columns.

### Mobile-Responsive Gantt (Touch Gestures)

Touch support is added to all Gantt chart drag interactions, enabling full use on tablets and touch-enabled laptops:

- **Bar drag (move/resize)**: `touchstart` on a task bar initiates the drag, `touchmove` updates the bar position in real time, and `touchend` commits the date change. Works for both moving (whole bar) and resizing (right edge).
- **Progress drag**: touch-drag the progress handle within a task bar to adjust the completion percentage.
- **Drag-to-create**: touch-drag on an empty timeline area to create a new task with pre-filled dates, mirroring the mouse-based drag-to-create behavior.
- Touch events use `touch.clientX` / `touch.clientY` to mirror existing mouse handler logic.
- `preventDefault` is called on `touchmove` to prevent page scrolling while a drag operation is in progress.
- Only single-finger gestures are recognized; multi-touch is ignored.

---

## 25. Dark Mode

A global dark theme is available throughout the application. The user toggles it via the **dark mode button** in the TopBar. The selected theme is persisted in `themeStore` (localStorage) and applied immediately by adding the `dark` class to the root `<html>` element. All UI components and pages use Tailwind `dark:` variant classes so colours, borders, and backgrounds switch automatically.

**Full coverage:** Every page in the application has `dark:` companion classes — including all auth pages (Login, Register, Forgot/Reset Password, Verify Email), public pages (Landing, Pricing, Privacy, Terms), dashboard pages (Executive, Portfolio, Analytics), tool pages (Report Builder, Workflow, Monte Carlo, Scenario Modeling), admin pages, and all shared components (report designer/preview, lessons cards, task form modal, notification bell, time tracking, custom fields, attachments, templates, timesheet grid, etc.).

**Settings page (all 8 tabs):** Profile, Team, Notifications, Display, Accessibility, API Keys, Webhooks, and Danger Zone all have full dark mode coverage. Toggle tracks, form panels, badges, code blocks, and the danger zone destructive section each have dedicated `dark:` variants.

**Admin page:** Role badges, stat card icon colors, tier badges, reset-token banner, and the header icon all have dark variants. The user search bar and AI Usage tab sortable columns also render correctly in dark mode.

**Command Palette:** Modal background, search input, ESC badge, status/severity/priority badge colors, quick action items, search result items, and the empty state all support dark mode.

**Badge & status polish (9 pages):** All severity, status, and category badges across the following pages have `dark:bg-*-900/30` / `dark:text-*-400` dark variants — ensuring no washed-out or invisible badges in dark theme:
- **ProjectDetailPage** — context card icon wells (purple/blue/green/red/orange), progress bar tracks (`dark:bg-gray-700`), presence avatar border rings.
- **NotificationsPage** — critical/high/medium/low severity badges; active filter card.
- **PortfolioPage** — STATUS_COLORS map (active/planning/on_hold/cancelled).
- **WorkflowPage** — node type colors (trigger/condition/action/approval/delay); execution status badges (completed/failed/waiting/running); header icon well.
- **LessonsLearnedPage** — amber recommendation box; positive/negative impact badges.
- **ReportsPage** — report type badges (weekly-status/risk/budget/resource) in both REPORT_TYPES and badgeColorMap.
- **IntakeFormsPage** — status badges (submitted/under_review/approved/rejected/converted); submissions table made horizontally scrollable.
- **AIInsightsTab** — risk level, impact level, and severity badges across all levels.
- **AccountBillingPage** — subscription status badges (trialing/active/past_due/canceling).

**Auth & Remaining Dark Mode (10 items):** Auth page error banners (Login, Register, Onboarding, ForgotPassword, ResetPassword) and success state icons (Register, ResetPassword) now have proper dark mode styling. Fixed all 16 non-standard `gray-750` class occurrences across 13 files (gray-750 does not exist in Tailwind v3, replaced with `gray-700`). AgentProposalsPage received comprehensive dark mode coverage — triage section, modal interior, table/tab bar, autonomy/eligibility cards, status filter pills, and page title. TimesheetPage active tab contrast fixed (`dark:bg-gray-700` instead of invisible `dark:bg-gray-800`). AgentActivityTab result badges, row backgrounds, and pagination styled for dark mode.

**Components Dark Mode (56+ items, fully polished):** WorkloadHeatmap (heatmap container, header, thead, rows, heat colors, legend, resource pool skills badges, capacity/email text), QuickActions (border, text, hover variants), TaskPrioritizationPanel (priority/impact colors, AI badge, summary cards, task rows, score bar track, expand toggle, explanation box, error/success banners), QueryInput (input bg/border/text, search icon), ChangeRequestDetail (6 status colors, 5 category colors, priority colors, approval timeline, actions section, workflow selector, meta/description text, current step indicator), ChangeRequestList (hover state), ChangeRequestForm (modal bg/border, header, labels, inputs, cancel button, error text), CustomizeDropdown (trigger button, dropdown panel, group labels, menu items, dividers, reset button), ErrorBoundary (page bg, card, icon, text, error message bg, report button), CustomFieldEditorModal (add option button hover), IntakeFormDesigner (field type badge colors with `dark:bg-*-900/30` / `dark:text-*-400` for all 6 types, back button hover, form metadata card bg/border, labels, inputs), IntegrationConfigModal (modal bg, header border, title text, close button hover, field labels, input hints), SyncLogPanel (status badge colors for success/partial/failed with `dark:bg-*-900/30` variants, panel bg, header border/text, sync button, log entry cards), ReportScheduleModal (inactive toggle track `dark:bg-gray-600`), ResourceLevelingPanel (header card, before/after toggle, adjustment/reassignment tables, error/success banners, reassign button), IntakeReviewPanel (5 status badge colors, submission info cards, review action buttons, review notes textarea, convert-to-project confirmation, success banner), MeetingResultPanel (priority/severity/type badge colors, tab bar, action items/decisions/risks/task updates tables and cards), ResourceForecastPanel (summary KPI cards, bottleneck callout cards with task chips, burnout risk badges, skeleton loading, empty state), AvailabilityCalendar (type color badges, container, calendar grid, form inputs/labels, entries list, legend), WorkflowNodeEditor (all labels, selects, inputs across 5 node types), WorkflowEditor (modal bg, header, form labels/inputs, approval steps with bg/border, action select, cancel button, error text), IntakeSubmissionForm (header, form container, dynamic input classes, labels, checkbox text, cancel button, error text), CapacityChart (container, header, legend text, empty state), ExecutionDetail (5 status color maps with dark variants, timeline line, node type/status badges, output data bg, error text, resume button), RebalanceSuggestions (4 type badge colors, container/cards, confidence bar track, description/impact text, apply button, empty state), NetworkDiagramView (zoom controls, legend, diagram container, error/empty state), MonteCarloHistogram (legend text, empty state), ResourceHistogram (container, header, select dropdown, legend text, empty states), SCurveChart (legend text, empty state), BurndownMiniWidget (card container, progress bars, skeleton, project names, percentages), ResourceUtilizationWidget (card container, avatar badges, resource names/roles, capacity text, skeleton, empty state), CriticalityIndex (legend text, empty state), PieChart (legend text, empty state), BurndownChart (legend text, empty state), ForecastComparisonChart (legend text, empty state), TornadoDiagram (legend text, empty state), VelocityChart (legend text, hover tooltip, empty state), WidgetGrid (empty state card, grip icon), LineChart (empty state), DynamicChart (container card bg/border, heading text, empty state), AIChatContext (5 context badge color entries with dark variants), BarChart (empty state), PortalLinkManager (full component — cards, inputs, labels, status badges, action buttons, empty/error states), TaskActivityPanel (border, comment badge, input, heading text, comment/activity text), TaskCardMobile (statusStyles and priorityStyles color maps with dark variants, fallback badges), TemplatePicker (5 category color entries with dark variants, import label, drop zone border), ColumnPickerDropdown (trigger button bg/text, checkbox borders), TemplateCustomizeForm (task list inner border, hover state, checkbox border), TimeTrackingTab (inactive tab text/hover, checkbox border), TaskFormModal (milestone checkbox border), ViewerInvitePanel (4 status badge colors with dark variants), TimeLogForm (checkbox border), CustomFieldsSection (checkbox border), ResourcesTab (inactive tab text/hover), RAIDDetailPanel (fallback status badge), and SaveAsTemplateModal (tag input border/bg). A final polish pass fixed 79 remaining gaps across 37 files: progress bar tracks (`bg-gray-200` → `dark:bg-gray-700`), table header/cell text colors, checkbox input borders, color map fallback strings, inactive tab hover states, close/action button hover colors, spinner borders, and the App.tsx loading screen background.

**Dark mode & accessibility polish (11 items, July 2026):** ReportScheduleModal form inputs (all selects, time input, textarea) now have `dark:bg-gray-900 dark:text-white`; the active toggle gained `role="switch"` and `aria-checked` for screen reader accessibility. ChangeRequestsPage "New Workflow" button changed from invisible `bg-gray-900` to `dark:bg-gray-600` in dark mode. Ten chart tooltip overlays (BurndownChart, SCurveChart, ActualVsEstimatedChart, MonteCarloHistogram, LineChart, PieChart, CapacityChart, ResourceHistogram, NetworkDiagramView, GanttChart) gained `dark:bg-gray-700` so they remain visible against the dark background. IntegrationConfigModal and SyncLogPanel close buttons gained `aria-label="Close"`. An invalid Tailwind class `bg-gray-150` in TableView was corrected to `bg-gray-200`. The dead "Apply" button in RebalanceSuggestions (disabled with "Coming soon" tooltip) was removed. PrelaunchLandingPage was moved from eager to lazy loading (only used on kovarti.com hostname, saves bundle size for all other users). A pervasive `hover:bg-gray-50 dark:bg-gray-900` pattern across 16 files (which applied a permanent dark background instead of hover-only) was fixed by removing the rogue `dark:bg-gray-900` class, leaving only `dark:hover:bg-gray-700`. Duplicate `react-router-dom` imports in GoalsWidget and RecentActivityWidget were consolidated. Split React imports in ResourcesTab, TimeTrackingTab, and MonteCarloPage were consolidated into single import statements.

**Dark mode & UI polish batch 2 (40 files, July 2026):** Fixed a pervasive unconditional `dark:bg-gray-800` hover pattern (should be `dark:hover:bg-gray-700`) across ReportScheduleModal, ReportPreview, ReportDesigner, IntakeFormsPage, LessonsLearnedPage, PortfolioPage, and ReportsPage. Fixed unconditional `dark:bg-primary-900/*` hover patterns across QueryPage, ReportBuilderPage, WorkflowPage, IntegrationsPage, ProjectDetailPage, ScheduleTab, TeamTab, and LessonsLearnedPage. Added `dark:border-gray-700` to light-only borders in TermsPage, PrivacyPage, UserGuidePublicPage, AnalyticsPage, and SavedViewsDropdown. Added dark mode styling to admin action buttons in AdminPage, AdminTenantsPage, and AdminPricingPage. Added `overflow-x-auto` to table wrappers in BacklogView, PerformancePanel, AdminRevenuePage, and SettingsPage. Fixed responsive grid breakpoints (`grid-cols-3` → `grid-cols-1 sm:grid-cols-3`) in AdminUsersPage, AdminAiUsagePage, AdminOperationsPage, IntakeReviewPanel, and RiskFormModal. Fixed z-index layering — AI chat panel and floating button reduced from z-40 to z-20 (below TopBar z-30). Fixed RAIDDetailPanel fixed width on mobile (`w-[520px]` → `w-full sm:w-[520px] max-w-full`). Added KanbanBoard swimlane header `overflow-x-auto`. Added TimesheetPage border dark variant. Added VerifyEmailPage icon container dark backgrounds. Added `aria-label` attributes to icon-only buttons in NotificationsPage, ChangeRequestDetail, ReportBuilderPage, AISummaryBanner, and StandupSummaryWidget.

**UI Audit Sprint 1 (10 findings, July 2026):** Nine shipped features (Monte Carlo, Scenarios, Workflows, Report Builder, Intake Forms, Integrations, Agent Proposals) now have sidebar navigation entries — previously reachable only by typing URLs. The breadcrumb system has a complete label map for all 44 routes, eliminating the bug where short segments like "goals" and "query" were incorrectly uppercased to "GOALS" and "QUERY". KPI tiles on the dashboard are now rendered as `<Link>` elements instead of `<div onClick>`, making them keyboard-navigable and screen-reader accessible with focus-visible rings. The "Read-only monitoring" chip was removed from the dashboard header. The "Last refreshed" footer timestamp now uses react-query's `dataUpdatedAt` with relative time formatting ("updated 4 min ago") instead of `new Date()` which showed the render time. "PM Assistant v1.0" in the footer was changed to "Kovarti PM". The PWA `theme-color` was changed from indigo (#6366f1) to teal (#0d9488) to match the app's actual brand. Dashboard default widgets were reduced from 13 to 4 (KPI tiles, Projects table, Morning Briefing, Action Center) — remaining widgets are opt-in via the Customize dropdown. Bottom nav label "Alerts" was renamed to "Notifications" for consistency with the sidebar. The sidebar's active indicator bar now positions correctly (added `relative` to the containing Link). A global `:focus-visible` ring (primary-500, 2px offset) was added to `index.css` for keyboard navigation across the entire application. Dark mode links now show an underline on hover for discoverability. Bottom nav labels were raised from 10px to 12px for readability.

**UI Audit Sprint 2 — Visual System Unification (6 findings, July 2026):** The Tailwind config now aliases `gray` to the warm stone ramp, eliminating the two-temperature neutral issue where sidebar (stone) and app chrome (cool gray) had visibly different tones in dark mode. All hardcoded `teal-*` classes across 12 component files were replaced with `primary-*`, ensuring the brand token system is actually used and any future brand change propagates automatically. The landing page's blue→cyan gradients were restyled to primary→cyan (teal) to match the app's identity. Feature card accents, shadows, and icon backgrounds all use `primary-*` tokens. The trust line ("No credit card · 14-day trial · Setup in minutes") contrast was raised from `text-slate-500` to `text-slate-300` and the footer from `text-slate-600` to `text-slate-400` for WCAG AA compliance on the dark background. The onboarding page's purple-pink gradient was replaced with `bg-gray-900` (consistent with login) and the green check icon was replaced with the "K" brand mark.

**UI Audit Sprint 6 — Accessibility, Branding & Onboarding (5 findings, July 2026):** Landing page feature cards now have full keyboard and tap support: `tabIndex={0}`, `onFocus`/`onBlur` handlers, `onClick` toggle for expanded detail, and `aria-expanded` on the card element, making them operable without a mouse. The hero SVG mockup (previously `hidden lg:block`) is now visible on mobile to give all users a preview of the product. A `useReducedMotion()` hook reads the `prefers-reduced-motion: reduce` media query; all six SVG mockup components on the landing page accept a `static` prop and suppress all SMIL `<animate>` / `<animateTransform>` elements when the user has requested reduced motion. System-level high-contrast CSS overrides were added to `index.css` using `prefers-contrast: more` media query and attribute selectors (to avoid Tailwind PostCSS conflicts), boosting muted text (gray-400/500 → gray-700 / gray-300), borders (gray-200/300 → gray-500; gray-600/700 → gray-400), and placeholder text to WCAG AA levels. All Mjuzi AI surfaces in the sidebar were unified under a "Mjuzi AI" nav section: "Ask AI" was renamed to "AI Query", the Agent Proposals page was renamed to "AI Proposals", and the chat panel header was changed from "AI Assistant — Powered by Claude" to "Mjuzi AI Chat"; the QueryPage and AgentProposalsPage titles and cross-references were updated; i18n keys updated in en/fr/es. A new "See it in action" section was added to the landing page between features and pricing, featuring three alternating content rows with static SVG mockups; the hero's secondary CTA was changed from "View Pricing" to "See how it works" (anchoring to `#see-it-work`); the refund policy was wrapped in a `details`/`summary` accordion; and tier names in the comparison table got parenthetical descriptors. The onboarding flow was rewritten as a 3-step wizard: Step 1 collects full name, role (dropdown), and methodology preference; Step 2 offers an optional first project from a template; Step 3 is a completion screen with navigation links. The backend `updateProfile` endpoint now accepts a `role` parameter that is applied only when `fullName` is null (first-time profile save). The `apiService.updateProfile()` helper was extended with the optional `role` parameter.

**UI Audit Sprint 5 — Copy, Performance & Navigation (4 findings, July 2026):** The sidebar token meter was redesigned: it now only appears when AI usage reaches ≥70%, showing a warning label ("AI usage high" at ≥70%, "AI usage critical" at ≥90%) with amber/red colours and a link to the Account page for details — below 70% the indicator is hidden entirely. All loading/empty-state microcopy was standardised: three-dot ellipsis (`...`) was replaced with the typographic ellipsis character (`…`) across 67 component files, and generic "Loading…" text was replaced with contextual messages ("Loading API keys…", "Loading agent activity…", etc.). The Projects page search was upgraded with a 200ms debounce and memoised filtering via `useMemo` for smoother performance on large project lists. Schedule deep-linking was added: the Project Detail page now reads a `?tab=` URL search parameter (e.g. `/project/:id?tab=schedule`) to open directly on any tab. Pinned projects in the sidebar gained a calendar icon shortcut (visible on hover) that deep-links to the project's schedule tab.

**UI Audit Sprint 4 — Density & Disclosure (4 findings, July 2026):** KPI tiles on the dashboard were reduced from six to four by merging the overlapping pairs: "Budget Variance" and "Budget Utilization" are now a single "Budget" tile showing variance as the main value and utilization as a subtitle; "Open Risks" now includes an "X projects at risk" subtitle, replacing the separate "At-Risk Projects" tile. The grid changed from 6 columns to 4. The Projects page gained a table/card toggle (persisted in localStorage) — table mode shows sortable columns (name, status, health, progress, methodology, end date) with click-to-sort headers, progress bars, and health labels. The AI assistant panel now defaults to closed instead of permanently reserving 380px on every route; the floating toggle button remains visible for users who want it open. The My/All Projects scope toggle on the dashboard is now always visible; when the user can already see all projects, the "All Projects" button is disabled with a tooltip instead of disappearing.

**UI Audit Sprint 3 — Command Palette & Navigation (4 findings, July 2026):** The command palette (Ctrl+K / Cmd+K) was rewritten into a true command center. On open it now shows Recent commands (persisted in localStorage), Actions (New Project, Log Time, Ask AI, Build Report), and Navigate commands ("Go to Dashboard", "Go to Projects", etc.) for all 24 app routes. Typing a single character filters the command list; typing 2+ characters switches to the existing entity search (projects, tasks, risks, etc.). The palette now uses the `useModal` hook for proper focus trapping, Escape-to-close, and focus restoration — the duplicate Cmd+K listener inside CommandPalette was removed (TopBar's listener is the single source of truth). A keyboard shortcut cheat sheet overlay opens with the `?` key, listing all available shortcuts. Two-key `g+d`, `g+p`, `g+n`, `g+s` chord shortcuts navigate to Dashboard, Projects, Notifications, and Settings respectively. The Settings page was removed from role-gated access in the sidebar — all roles can now access personal preferences, not just admin/project_manager/pmo.

---

## 26. Project Milestones

Any task can be marked as a milestone by setting `is_milestone = true`. Milestone tasks render as **diamonds** on the Gantt chart (zero-width diamond icon centred on the task date) rather than as horizontal bars. Milestones are still full tasks — they carry status, assignee, and dependency information — but conventionally have zero estimated duration.

---

## 27. Multi-Dependency Support

Each task supports up to **20 predecessors**. Dependencies are stored in a `task_dependencies` junction table (with `ON DELETE CASCADE`) rather than columns on the task row, allowing any number of predecessors per task.

### Dependency Types and Lag

Each individual predecessor relationship carries its own type and optional lag:

| Type | Meaning |
|------|---------|
| **FS** (Finish-to-Start) | Successor starts after predecessor finishes (default) |
| **FF** (Finish-to-Finish) | Successor finishes no earlier than predecessor finishes |
| **SS** (Start-to-Start) | Successor starts no earlier than predecessor starts |
| **SF** (Start-to-Finish) | Successor finishes after predecessor starts |

An optional **lag** (positive integer, days) can be added to any individual dependency to introduce a waiting period. Negative lag (lead time) is also supported. CPM forward/backward pass calculations respect all four types and lag values across all predecessors, taking the maximum constraint when a task has multiple predecessors.

### API Payload

On task create and update, pass a `dependencies` array. Each entry has:

```json
{ "dependencyId": "<taskId>", "dependencyType": "FS", "lagDays": 0 }
```

Omitting `dependencies` leaves existing dependencies unchanged. Passing an empty array `[]` clears all predecessors.

### Predecessor Display Format

Multiple predecessors are displayed as a comma-separated list in compact **row-number notation** matching MS Project conventions:

| Display | Meaning |
|---------|---------|
| `3` | Finish-to-Start dependency on row 3 (FS is default, omitted for brevity) |
| `7SS` | Start-to-Start dependency on row 7 |
| `3FS+2d` | Finish-to-Start on row 3 with 2-day lag |
| `12FF-1d` | Finish-to-Finish on row 12 with 1-day negative lag (lead) |
| `3FS+2d,5SS,7` | Three predecessors on rows 3, 5, and 7 |

This format is also used in CSV export, matching MS Project's export convention.

### Dependency Health Badges

Each predecessor in the list displays a colour-coded health dot indicating that predecessor's status:

| Colour | Meaning |
|--------|---------|
| Green | Predecessor is **completed** — dependency satisfied |
| Yellow | Predecessor is **in progress** — being worked on |
| Red | Predecessor is **overdue** — not completed and past its end date |

Health badges appear in the Table view Predecessor column, the Gantt left panel Pred column, and Gantt bar tooltips. Dependency arrows on the Gantt chart are drawn for each predecessor and colour-coded by health status (green, yellow, or red).

### Interactive Dependency Drawing (Gantt)

In the Gantt chart, dependencies can be created visually by dragging between task bars — matching the MS Project interaction model:

1. **Hover over a task bar** to reveal two small connector dots at the left (start) and right (finish) edges.
2. **Click and drag** from a connector dot toward another task bar. A dashed blue preview line follows the cursor.
3. **Release** over the target task bar. The target edge (start or finish) is determined by which half of the bar the cursor lands on (left half = start, right half = finish).
4. The dependency type is inferred from the source and target edges: finish→start = FS, start→start = SS, finish→finish = FF, start→finish = SF.

Validation rules apply: no self-references, no duplicates, max 20 predecessors, and parent/summary tasks are excluded. The target row highlights in blue while dragging over it.

### Inline Predecessor Editing

In Table view, the Predecessor column is inline-editable. Click a predecessor cell and type one or more predecessor entries separated by commas (e.g. `3`, `5SS`, `7FS+2d`, `3FS+2d,5SS,7`). The input is validated: invalid row numbers, self-references, duplicate entries, and malformed formats display a red error border with a message. Clearing the field removes all dependencies.

### Task Form Modal

The task form modal shows a multi-predecessor UI: a list of dependency rows, each with a predecessor selector, dependency type dropdown (FS/SS/FF/SF), and lag-days field. Use the **Add Predecessor** button to append a new row (up to the 20-predecessor limit) and the remove button on each row to delete it.

### Server-Side Dependency Validation

All dependency writes — API, UI, and AI tools — go through `validateDependency()` on the server for each dependency entry. The server is the single source of truth; no client-side pre-flight checks are needed. The following rules are enforced per dependency, returning HTTP 400 on violation:

| Rule | Error Message |
|------|---------------|
| **Self-reference** — a task cannot depend on itself | "A task cannot depend on itself" |
| **Nonexistent dependency** — the referenced task must exist | "Dependency task '{id}' not found" |
| **Cross-schedule** — both tasks must be in the same schedule | "Dependency must be in the same schedule" |
| **Circular dependency** — the dependency must not create a cycle (A→B→C→A) | "Circular dependency detected: the dependency task is already downstream of this task" |
| **Limit exceeded** — tasks may not have more than 20 predecessors | "A task cannot have more than 20 predecessors" |

**Orphan cleanup:** When a task is deleted, its row in `task_dependencies` is removed by `ON DELETE CASCADE` for both the predecessor and successor sides, so no dangling references remain.

---

## 28. Kanban WIP Limits

Each status column on the Kanban board can have a **Work-In-Progress (WIP) limit**. When a column's task count reaches the configured limit, the column header turns amber and further drops are visually flagged. WIP limits are set per-column from the Kanban toolbar and stored in `localStorage`. A limit of `0` means unlimited.

---

## 29. Comment @Mentions

When writing a task comment, typing `@` opens an autocomplete dropdown listing project members. Selecting a username inserts the mention token into the comment. When the comment is saved, the `NotificationService` creates an in-app notification for every mentioned user, linking back to the task.

---

## 30. Bulk Import (CSV / Excel)

Tasks can be imported in bulk from a CSV or Excel file via `POST /api/v1/schedules/:id/import`. The UI provides:

1. **Upload or paste** — drag-and-drop a `.csv`, `.xlsx`, or `.xls` file (max 5MB) or paste raw CSV text.
2. **Sheet selection** — for multi-sheet Excel files, a dropdown lets you choose which sheet to import.
3. **Column mapping** — map columns to task fields (name, start date, end date, estimated days, status, priority, assignee).
4. **Preview** — inspect the parsed rows before committing.
5. **Import** — valid rows are created as tasks via `scheduleService.createTask()` (with full dependency validation, audit logging, workflow triggers, sort order management, and WebSocket broadcasts); errors are reported per-row.

**Guardrails:**
- **Schedule validation** — the target schedule must exist (404 otherwise).
- **Duplicate detection** — rows with the same name + start date as an existing task (or earlier row in the same batch) are skipped.
- **File size limit** — 5MB enforced both client-side (before upload) and server-side (before parsing).
- **Row limit** — maximum 100 rows per import.
- **Encoding normalization** — `fixMojibake()` is applied client-side (in `csvCleaner.ts`, before CSV parsing) and server-side (in `import.ts`, before `csvParse()`) to correct Windows-1252 → UTF-8 double-encoding artifacts. Fixes 10 common patterns including em dash (`â€"` → `—`), en dash, smart quotes (left/right single and double), bullet, ellipsis, middle dot, and non-breaking space. This prevents garbled task names when importing Excel/CSV files saved in Windows-1252 encoding.

---

## 31. Gantt PDF Export

A **Print / Export PDF** button in the schedule toolbar calls `window.print()` with a print-optimised CSS stylesheet applied. The Gantt chart expands to show all tasks, hides navigation chrome, and formats page breaks appropriately. The result is a print-ready PDF when saved from the browser's print dialog.

---

## 32. Gantt Quick Search, Filter Panel & Saved Views

### Quick Search (Ctrl+F)

A **search bar** in the Gantt toolbar provides instant type-ahead filtering on task names. Press **Ctrl+F** to focus the search input. Typing filters the task list to show only tasks whose name contains the search term (case-insensitive substring match). Parent rows remain visible when any of their children match, preserving hierarchy context. A counter displays **"X / total tasks"** to indicate how many tasks match the current filter. Press **Escape** to clear the search and restore the full task list.

### Filter Panel

Click the **Filter** button (funnel icon) in the Gantt toolbar to open a collapsible filter panel. Available filters:

- **Status** — Multi-select checkboxes (Pending, In Progress, Completed, Cancelled).
- **Priority** — Multi-select checkboxes (Low, Medium, High, Critical).
- **Assignee** — Free-text search to filter by assignee name.
- **Date Range** — "Start After" and "Start Before" date pickers to narrow tasks by their start date.
- **Progress Range** — Min and Max percentage sliders/inputs to filter by completion percentage.

All active filters are combined with **AND** logic — a task must satisfy every filter to appear. Parent rows remain visible when any descendant matches, maintaining the hierarchy. An **active filter count badge** appears on the Filter button showing how many filters are currently applied. A **"Clear All"** button inside the panel resets every filter at once.

### Saved Views

The existing **SavedViewsDropdown** component is wired into the Gantt toolbar. It allows users to save and load named view configurations that capture:

- **Visible columns** — which left-panel columns are shown or hidden.
- **Sort field and direction** — the active column sort (ascending, descending, or none).
- **Zoom level** — the selected timescale (Day, Week, Month, Quarter, Year).

Saved views are stored in **localStorage** with a `gantt:` prefix to keep them separate from Table view configurations. Select a saved view from the dropdown to instantly restore its settings; create new views or delete existing ones from the same dropdown.

---

## 33. Gantt Row Striping, Resource Avatars & Drag-to-Create

Three visual and interaction enhancements to the Gantt chart:

### Row Striping

Alternating row backgrounds (every other row) in both the left task panel and the timeline provide visual separation for improved readability. The stripe uses a subtle `bg-gray-50/60` with `dark:bg-gray-800/30` for dark mode support. Active task highlights, hover states, and row drag indicators all override the stripe color.

### Resource Avatars

Task bars display a small 18px circle at the right edge showing the assignee's initials. The background colour is deterministic — each name hashes to one of 10 palette colours, so the same person always gets the same colour across all tasks. Avatars appear on non-parent, non-milestone bars wider than 40px. The bar label text automatically adds right padding when an avatar is present to prevent overlap. Hover over the avatar to see the full assignee name in a tooltip.

### Drag-to-Create

Click and drag on an empty area of the Gantt timeline to create a new task with pre-filled dates. While dragging, a dashed blue preview rectangle shows the selected date range. On mouse-up, the Add Task form opens with start/end dates computed from the drag span. Parent task detection is automatic:

- Dragging on a **parent task row** creates a child of that parent.
- Dragging on a **child task row** creates a sibling (same parent).
- Dragging on a **top-level task row** creates a new top-level task.

A minimum drag width of half a day (`0.5 × dayPx`) prevents accidental task creation. The crosshair cursor indicates that drag-to-create is available. Bar cursors (grab/grabbing) override the crosshair on hover.

---

## 34. Gantt Resource Overallocation Warnings

A toggle button labelled **"Overalloc"** (with a warning triangle icon) in the Gantt toolbar enables client-side detection of resource overallocation. When enabled:

- The system groups all tasks by their `assignedTo` field and identifies date overlaps — i.e., where the same person is assigned to two or more tasks whose date ranges overlap.
- Overallocated task bars receive an **amber highlight** — a 2px amber border with a glow effect — plus a small amber **"!" warning dot** on the bar.
- A **badge with count** appears on the toolbar button showing how many bars are currently flagged.
- The Gantt **legend** includes an entry showing an amber-bordered box labelled "Overallocated".

Detection is entirely client-side (no server API required). Toggle the button off to hide all overallocation highlights.

---

## 35. Gantt Minimap

A **200×80px overview panel** in the bottom-right corner of the Gantt timeline provides a bird's-eye view of the entire schedule. Toggle it with the **"Map"** button (map icon) in the toolbar. The minimap is enabled by default.

- Each task bar is represented as a small coloured rectangle matching its status colour (blue for in progress, green for completed, grey for pending).
- A **semi-transparent blue viewport rectangle** shows the currently visible portion of the timeline and tracks scroll position in real time.
- **Click** anywhere on the minimap to jump the timeline to that position.
- **Drag** the viewport rectangle to scroll the timeline proportionally.

Toggle the button off to hide the minimap panel.

---

## 36. MS Project XML Export (MSPDI)

PM Assistant can export a project as an **MSPDI XML file** compatible with Microsoft Project and ProjectLibre.

**Server endpoint:** `GET /api/v1/exports/projects/:id/export?format=xml`

The generated XML includes:

- **Project metadata** — project name, start date, and a standard calendar definition (weekdays Mon–Fri).
- **Tasks** — each task includes UID, Name, WBS, OutlineLevel, Start, Finish, Duration (formatted as `PT{days×8}H0M0S`), Milestone flag, Summary flag, PercentComplete, and PredecessorLink elements for each dependency.
- **Resources** — extracted from the `assignedTo` field of all tasks, deduplicated.
- **Assignments** — task-to-resource mappings linking each task to its assigned resource.

**Dependency mapping:** FS = type 1, FF = type 0, SS = type 2, SF = type 3. Lag is expressed in tenths-of-minutes.

**Client access:** The API client exposes `exportProjectXML(projectId)`. On the **Project Detail** page, an **"Export XML"** button appears in the same action row as Export CSV and Export PDF.

**Trial User Experience:** Trial users who trigger any project export (CSV via `GET /api/v1/exports/projects/:id/export?format=csv`, XML via `?format=xml`, or JSON/PDF via `?format=json`) are not blocked with a 403. Instead, all three export endpoints return **sample project data**: a fictitious project with 5 tasks across 2 phases (Planning and Execution), with realistic names, dates, statuses, and assignments. An amber upgrade banner is shown in the UI before the download: "Sample Export — This download contains sample data, not your real project. Upgrade to a paid plan to export your actual project data." The file downloads successfully in the requested format. No real project data is read from the database for trial export requests. This follows the same pattern as Status Reports, EVM, and Monte Carlo.

---

## 37. Goals / OKR Tracking

The Goals module provides Objectives and Key Results (OKR) tracking alongside traditional project scheduling.

- **Objectives** — High-level goals with a title, description, owner, and time period.
- **Key Results** — Measurable outcomes nested under an objective, each with a numeric target, current value, and unit.
- **Progress** — Automatically calculated from key result completion percentages.
- **Project linking** — OKRs can be associated with a project using a searchable project dropdown in the goal modal (replaces the previous free-text Project ID field), preventing invalid IDs and improving discoverability.

**API endpoints:** `GET/POST /api/v1/goals`, `GET/PUT/DELETE /api/v1/goals/:id`.

---

## 38. Time Zone Support

Each user can set a preferred timezone in **Settings → Preferences** (stored via `PUT /api/v1/users/me/preferences`). All date and time values rendered in the UI are converted to the user's timezone using the stored IANA timezone string (e.g., `America/Toronto`). Server timestamps remain in UTC; conversion happens client-side. When no preference is set the browser's local timezone is used as a fallback.

---

## 39. Multi-Language (i18n)

The frontend supports **English (en)**, **French (fr)**, and **Spanish (es)**. The active locale is managed by `localeStore` (Zustand, persisted in localStorage) and consumed via the `useTranslation()` hook. All user-facing strings are keyed through the translation map; switching locale applies immediately without a page reload. The locale can be changed from **Settings → Language**.

---

## 40. Accessibility + Adaptive UI

### Accessibility Preferences
Users can configure accessibility settings from **Settings → Accessibility**:
- **High Contrast**: Increases border widths and color contrast for improved readability
- **Font Size** (12–24px): Adjusts the base font size across the entire application via CSS custom property `--app-font-size`
- **Reduced Motion**: Disables all CSS animations and transitions
- **Text Simplification** (off/mild/strong): AI-powered simplification of narratives and reports
- **AI Narration**: Toggle dashboard narrative summaries on/off

Preferences are stored server-side in the `accessibility_preferences` JSON column (migration 034) and cached in localStorage. The `AccessibilityProvider` React context applies CSS classes (`high-contrast`, `reduce-motion`) to the document root.

### System-Level High-Contrast Mode

In addition to the user preference toggle, `index.css` includes CSS overrides that activate when the browser or OS reports `prefers-contrast: more`. These overrides use attribute selectors (to avoid Tailwind PostCSS conflicts) and boost:
- Muted text colors (Tailwind `gray-400`/`gray-500`) to `gray-700` in light mode and `gray-300` in dark mode
- Border colors (`gray-200`/`gray-300`) to `gray-500` in light mode; (`gray-600`/`gray-700`) to `gray-400` in dark mode
- Placeholder text to match the boosted muted-text levels

### Reduced Motion Hook

A `useReducedMotion()` React hook reads the `prefers-reduced-motion: reduce` media query and returns a boolean. All six SVG mockup components on the landing page accept a `static` prop; when `static={true}` (set automatically when `useReducedMotion()` returns true), all SMIL `<animate>` and `<animateTransform>` elements are suppressed, delivering a fully static illustration to users who have requested reduced motion.

### API Endpoints
- `GET /api/v1/users/me/accessibility` — get current preferences
- `PUT /api/v1/users/me/accessibility` — update preferences
- `POST /api/v1/accessibility/simplify` — simplify text (body: `{ text, level }`)
- `POST /api/v1/accessibility/reading-level` — analyze reading level (returns Flesch-Kincaid score, grade, and level)

### Reading Level Analysis
Pure algorithmic Flesch-Kincaid readability scoring (no LLM required). Returns:
- **score** (0–100): Higher = easier to read
- **grade**: Estimated US school grade level
- **level**: easy (60+), moderate (30–59), advanced (<30)

---

## 41. Dashboard

All user roles now see the same customizable dashboard. The previous role-based dashboards have been replaced.

The `DashboardRouter` component renders `DashboardPM` for all roles. Users who own fewer projects than the full portfolio see a **scope toggle** (My Projects / All Projects). Widget visibility, order, and scope are controlled via the **Customize** dropdown and **drag-and-drop reordering**, persisted server-side (migration 072: `dashboard_preferences` JSON column on `users`) with localStorage as an instant cache. The `useDashboardPreferences` hook handles localStorage-first loading with debounced server sync (500ms).

See [Section 23](#23-dashboard) for full widget and endpoint details.

---

## 42. Multi-Agent Collaboration

### Memory Context for Reasoning
ReasoningEngine generators (scope analysis, budget analysis) now inject historical context into Claude prompts:
- Past reflections from the same agent for the same project
- Cross-agent insights (what other agents found in recent scans)

This is provided by `getMemoryContext(agentId, projectId)` which queries the `agent_memory` table.

### Inter-Agent Query Service
Agents can query other agents' conclusions via `InterAgentQueryService`:
- `getLatestInsight(agentId, projectId)` — specific agent's latest finding
- `getInsightsByProject(projectId)` — all agents' findings for a project

### Scan Result Storage
The scan orchestrator stores each project's aggregate scan results in `agent_memory` (type='project', key='latest_scan', TTL=24h) after processing. Portfolio-level agents can then access per-project findings.

### Insight Assembly
`InsightAssemblyService` combines multiple agents' outputs into a unified health assessment:
- Overall health classification (healthy/warning/critical)
- Per-agent findings with severity levels
- Summary text for narratives

---

## 43. Intelligent Dashboard Narratives

### NarrativeService
Generates plain-language summaries tailored to the user's role:
- **finance_officer** focus: budget utilization, cost variances, financial risks
- **scrum_master** focus: sprint progress, velocity trends, blockers
- **executive** focus: high-level status, strategic risks, portfolio health
- **project_manager** focus: schedule adherence, task completion, immediate risks

### API Endpoints
- `GET /api/v1/narratives/project/:projectId` — project-level narrative (role from auth context)
- `GET /api/v1/narratives/portfolio` — portfolio-level summary

### Dashboard Integration
The `AISummaryBanner` component shows a narrative section (when enabled via accessibility preferences) with a refresh button. Falls back to static text when AI is unavailable.

---

## 44. Dashboard & Projects

The Dashboard and Projects pages provide a lean, action-oriented project management experience.

### Dashboard (`/dashboard`)

A monitoring cockpit with read-only scope toggle:

- **6 KPI Tiles** — Portfolio Health, Overdue Tasks, Open Risks, At-Risk Projects, Budget Variance, Budget Utilization. Each tile has a colored status dot, semantic color chip, hover lift animation, and click-through to drill-in pages (`/kpi/:type`). Health and Overdue tiles display 7-day trend arrows (green up = improving, red down = declining, gray dash = stable).
- **KPI Drill-In Pages** (`/kpi/:type`) — Clicking any KPI tile opens an enriched drill-in page with:
  - **Summary Cards** — 2–4 stat cards above the table (e.g., Avg Health / Healthy / At Risk / Critical for health; Total Overdue / Avg Days / Most Affected Project / Critical Priority for overdue; Total Elevated / Critical / High / Medium for risks; Over Budget / Avg Overrun / Worst Overrun for budget types).
  - **Trend Badge** — Health and Overdue pages show an "Improving", "Declining", or "Stable" badge next to the title, derived from `trendIndicators`.
  - **Distribution Bar** — Health page shows a horizontal stacked bar (green/amber/red by score bands); Risks page shows critical/high/medium breakdown with color legend.
  - **Health Table Enrichment** — The health drill-in adds Schedule, Budget, and Risk sub-score columns plus a 30-day trend sparkline (SVG polyline, color-coded by last score) for each project.
  - **Sortable Table** — All types retain the existing sortable table with click-through to project detail.
- **Portfolio Intelligence** — `AISummaryBanner` with circular health ring, risk summary chips, budget status, key insights, and AI narrative (when enabled). Full dark mode support.
- **Projects Table** — Sortable by 10 columns (name, health, status, priority, type, progress, budget, spent%, end date, days left). Rows navigate to `/project/:id`.
- **Action Center** — Two-column card: "Today's Priorities" (deadline-driven items from predictions) and "AI Next Best Actions" (proposals to approve with confidence % and risk level badges, critical/high notifications to investigate, at-risk projects to review with health score badges). This is the single source for AI-suggested next actions on the dashboard.
- **Issues Created vs Resolved** — Weekly trend chart with scope awareness.
- **3-Column Footer** — Milestones widget, Budget Watch widget, Activity Feed with filter pills (All/Agent/Risk/Budget/Meeting/System), date grouping (Today/Yesterday/Earlier), clickable rows, mark-as-read, and navigation.
- **Customize Dropdown** — Toggle any widget section on/off. "Reset to Default Layout" button restores defaults. Includes opt-in placeholders for Sprint Snapshot, Goals Progress, and Team Workload (disabled by default).
- **Drag-and-Drop Reordering** — Hover over any widget to reveal a grip handle; drag to reorder. The `WidgetGrid` component groups consecutive `third`-size widgets (Milestones, Budget Watch, Activity Feed) into 3-column rows. Order is persisted to the server.
- **Server Persistence** — `GET/PUT /api/v1/users/me/dashboard-preferences` stores `enabledWidgets`, `widgetOrder`, and `scope` as JSON. On load, localStorage is used instantly, then overwritten by server data if available.

### Projects (`/projects`)

- **Filter Bar** — Search by name, filter by health band (Healthy/Warning/Critical) and status (Active/Planning/On Hold/Completed).
- **Project Cards** — Grid layout with left border colored by health band, health pill, status/priority chips, progress meter, and "View Project" button. Clicking a card navigates to `/project/:id`.
- **New Project** — Template picker integration for creating projects from templates.

### Onboarding — 3-Step Wizard

New users see a **3-step onboarding wizard** on their first login after registration. The wizard replaces the old single-screen WelcomeModal with a guided setup flow:

| Step | Content |
|------|---------|
| **Step 1 — Profile** | Full name, role selector (dropdown: project_manager, team_member, executive, etc.), and preferred methodology (waterfall/agile/hybrid). Role is persisted to the backend only during onboarding (when `fullName` is null), preventing accidental role changes later. |
| **Step 2 — First Project** | Optional project creation from a template. Users can pick a template from the library or skip this step. |
| **Step 3 — Done** | Completion screen with navigation links to Dashboard, Projects, and Mjuzi AI Chat. |

First-login detection uses `sessionStorage` (set once per browser session after registration). Completing or dismissing the wizard persists a flag in `localStorage` so it does not reappear on subsequent logins.

The `apiService.updateProfile()` call in Step 1 accepts an optional `role` parameter, which is applied by the backend only when the user's `fullName` is currently null (i.e., this is their first profile save).

Component: `src/client/src/components/onboarding/WelcomeModal.tsx`

### Project Readiness Bar

A methodology-aware progress bar displayed above the tabs on the project detail page. It guides new project setup with 5 sequential steps that vary by methodology:

| Waterfall | Agile | Hybrid |
|-----------|-------|--------|
| Tasks | Backlog | Tasks |
| Dependencies | Sprint | Sprint |
| Resources | Team | Resources |
| Critical Path | Velocity | Critical Path |
| Simulation | Burndown | Velocity |

Data-driven steps (tasks, dependencies, resources, sprints) auto-detect completion from existing data. Click-driven steps (critical path, simulation, velocity, burndown) mark complete on first click and persist via `localStorage`. The bar can be dismissed per project.

Component: `src/client/src/components/onboarding/ProjectReadinessBar.tsx`
Step configurations: `src/client/src/utils/methodology.ts`

### Empty-State CTA

When a user has **zero projects**, the Projects Table on the dashboard renders a "New Project" button in place of the empty table body. Clicking it links to `/projects`, where the project creation flow can be started. This replaces the blank table that previously appeared for new accounts.

### Navigation

Accessible via the "Plan" section in the sidebar:
- Dashboard → `/dashboard`
- Projects → `/projects`

Old routes (`/dashboard-pm`, `/projects-pm`) redirect to the new paths for backwards compatibility.

### Design System

- **Font**: Plus Jakarta Sans (imported via Google Fonts)
- **Primary palette**: Teal (50–900)
- **Health bands**: ≥75 green, 50–74 amber, <50 red
- **Card radius**: `rounded-xl` (12px)
- **Hover lift**: `hover:-translate-y-0.5 hover:shadow-md`
- **KPI values**: 27px / font-weight 800
- **Dark mode**: Full coverage across all PM components

---

## 45. RAID Management

RAID (Risks, Actions, Issues, Decisions) is a structured project control framework that gives project managers a single, auditable register for every threat, action item, live problem, and key decision on a project. The implementation is inspired by enterprise ITSM tooling (BMC Remedy / Helix) and enforces no-delete semantics, global sequential record IDs, and a full activity timeline on every record.

### Framework Overview

Each project has one RAID log containing records of four types:

| Type | Purpose |
|------|---------|
| **Risk** | A potential future problem that may or may not materialise |
| **Action** | A task or follow-up that must be completed by a specific owner and due date |
| **Issue** | A problem that has already materialised and is actively impacting the project |
| **Decision** | A formal project decision with rationale, decision maker, and alternatives considered |

### Global Sequential Record IDs

Every RAID record is assigned a globally unique, type-prefixed sequential identifier at creation time:

- Risks: `R-001`, `R-002`, …
- Issues: `I-001`, `I-002`, …
- Actions: `A-001`, `A-002`, …
- Decisions: `D-001`, `D-002`, …

IDs are assigned atomically from a per-project counter and never recycled. A cancelled or reversed record retains its original ID permanently.

### Type-Specific Fields and Status Workflows

#### Risk

Fields: title, description, severity (low / medium / high / critical), probability (low / medium / high), impact, owner, mitigation plan, source (manual / ai_scan / agent / import).

Status workflow:
```
proposed → open → monitoring → mitigating → mitigated → closed
                                                       ↘ cancelled (requires reason)
```

#### Issue

Fields: title, description, severity, category, owner, root cause, impact assessment, workaround, resolution plan, target resolution date, source.

Issues are differentiated from risks — they represent problems that have already materialized. The form shows issue-specific fields (root cause, impact assessment, workaround, resolution plan) instead of risk fields (trigger condition, mitigation plan, response plan). Probability is not shown since the issue has already occurred.

Status workflow:
```
proposed → open → in_progress → resolved → closed
                                          ↘ cancelled (requires reason)
```

#### Action

Fields: title, description, owner, due_date, action_type (follow_up / decision_required / information_only / escalation), source.

Status workflow:
```
proposed → open → in_progress → completed → closed
                                           ↘ cancelled (requires reason)
                                           ↘ deferred
```

#### Decision

Fields: title, description, owner, rationale, decided_by, decision_date, alternatives_considered, source.

Status workflow:
```
proposed → pending_decision → decided → deferred
                                      ↘ reversed (admin only — requires reason)
```

### Triage Workflow

RAID items follow a triage workflow aligned with PMI/PRINCE2 governance best practice. **Any team member** can raise a risk, issue, action, or decision — open identification is encouraged.

- **Non-PM roles** (team_member, qa, tester, devops, ba): items are created with status `proposed` and require PM review before becoming active.
- **PM/admin roles** (admin, project_manager, scrum_master, risk_manager, pmo): items bypass triage and are created directly as `open`.

When a `proposed` item is created, all project managers and owners receive a notification: *"New [Type] requires triage: [Title]"*. The PM reviews the item and either promotes it to `open` (or the appropriate starting status) or cancels it with a reason.

This ensures broad visibility of project threats while keeping the active register curated by accountable roles.

### Cancel and Reverse Semantics

RAID records are never deleted. This preserves the audit trail and prevents gap-filling in the sequential ID sequence.

- **Cancel**: Available on any record in any status except `closed`. Requires a mandatory cancellation reason. Sets status to `cancelled`. Available to all roles that can edit the record type.
- **Reverse**: Available on Decision records only, when status is `decided`. Requires a mandatory reason. Sets status to `reversed`. Restricted to admin users.

### RAID Views

The RAID tab supports three view modes, toggled from the toolbar:

- **Table view** (default) — sortable grid with columns: checkbox, ID, Title, Type, Severity, Status, Owner, Score, Date. Click any column header to sort ascending/descending. Click a status badge to change status inline (dropdown appears). Checkboxes enable multi-select for bulk status and severity changes via a sticky bulk action bar. Due date warnings appear as overdue/due-soon badges next to action/issue titles. On mobile, the table automatically renders as a responsive card layout with compact task cards.
- **Board view** — Kanban-style columns grouped by status. Drag cards between columns to change status. Each card shows record ID, type indicator, severity badge, title, owner, and due warning. Only columns with items are shown.
- **Risk Matrix view** — 5×5 probability × impact heatmap grid. Cells are colour-coded from green (low) through amber (medium) to red (critical). Each cell shows the count of risks in that cell; click to view details. Only risk-type items with probability and impact values appear.

### Filter Bar

A collapsible filter panel with:

- **Search** — real-time text search by title.
- **Dropdowns** — Type, Status, Severity, Source filters. A badge on the Filter button shows how many filters are active.
- **Clear all** — resets all filters. Item count displayed.

### Severity Distribution

A horizontal stacked bar chart in the stats row showing the breakdown of critical/high/medium/low items across all RAID records, with colour-coded legend.

### Tab Badge

The RAID tab header shows a count badge with the total number of open items (open risks + open issues + open actions + pending decisions) to provide at-a-glance visibility.

### Slide-Out Detail Panel

Clicking any row in the RAID log opens a slide-out panel from the right side of the screen. The panel shows:

- Full record header (ID, type badge, status pill, severity chip)
- All type-specific fields (editable inline for permitted roles)
- **Activity timeline** — a chronological log of every state change and comment, with actor name, timestamp, and change description

### Activity Logging

Every change to a RAID record is automatically logged to the activity timeline:

- Status transitions (e.g., `open → in_progress`, `decided → reversed`)
- Field edits (title, description, owner, due date, rationale, etc.)
- Cancel and reverse actions (with the mandatory reason recorded)
- AI Scan findings imported as new records
- Agent writes via `importFromAgent` or `importFromAIScan`

Users can also add manual comments to any record via the comment box at the bottom of the detail panel. Manual comments appear in the timeline interleaved with auto-logged changes.

### AI Agent Partnership

The RAID log integrates with the platform's AI agent layer in two ways:

**AI Scan** — A project-scoped scan that reads the current schedule, task statuses, overdue items, and budget data to surface new risks and issues. Results are presented as a preview; the user selects which findings to import. Imported records are tagged with `source: ai_scan`.

**Agent writes** — Background agents (e.g., the Risk Agent, Budget Agent) can write directly to the RAID log using the `importFromAgent` pathway. These records are tagged with `source: agent` and appear in the log alongside manually created entries. Agent-written records go through the same activity logging as manual records.

The `suggest-mitigation` MCP tool surfaces historical lessons-learned data to suggest mitigation strategies for open risks, callable by AI assistants operating on behalf of risk managers or project managers.

### Role-Based Permissions

| Role | Create Risk | Create Issue | Create Action | Create Decision | Cancel | Reverse |
|------|-------------|--------------|---------------|-----------------|--------|---------|
| `admin` | Yes | Yes | Yes | Yes | Yes | Yes |
| `project_manager` | Yes | Yes | Yes | Yes | Yes | No |
| `scrum_master` | Yes | Yes | Yes | Yes | Yes | No |
| `pmo` | Yes | Yes | Yes | Yes | Yes | No |
| `ba` | Yes | Yes | Yes | Yes | Yes | No |
| `risk_manager` | Yes | Yes | No | No | Yes | No |
| `team_member` | No | Yes | Yes | No | Own only | No |
| `finance_officer` | No | No | No | No | No | No |
| `executive` | No | No | No | No | No | No |
| `qa` / `tester` / `devops` / `claude_sme` | No | No | No | No | No | No |

Reverse (decision reversal) is restricted to `admin` only regardless of project membership role.

---

## Technical Architecture

### Backend

- **Runtime**: Node.js 22 with TypeScript
- **Framework**: Fastify (high-performance HTTP server)
- **Database**: MySQL (MariaDB compatible) with connection pool timeouts (`connectTimeout: 5s`, `idleTimeout: 30s`, `queueLimit: 50` — env-configurable via `DB_CONNECT_TIMEOUT`, `DB_IDLE_TIMEOUT`, `DB_QUEUE_LIMIT`)
- **Transaction safety**: Multi-table writes use `databaseService.transaction()` with a `queryOn()` helper for ACID guarantees. Fire-and-forget side effects (audit logs, workflow triggers) run after commit.
- **Validation**: Zod schemas on all API inputs (shared `paginationSchema` for list endpoints)
- **AI**: Anthropic Claude SDK (gated by `AI_ENABLED` env var)
- **Real-time**: WebSocket service for live notifications
- **Email**: Configurable email service for password reset and notifications
- **Repository layer**: `BaseRepository` + entity-specific repositories (`ProjectRepository`, `UserRepository`, `ScheduleRepository`) centralize SQL queries and row mapping. Services delegate data access to repositories and keep business logic (audit logging, policy checks, workflow triggers).
- **Service layer**: Stateless services use module-level singletons to avoid redundant instantiation and preserve in-memory caches (e.g., EmbeddingService). Internal queries include safety `LIMIT 1000` on unbounded SELECTs; public list endpoints use proper pagination with `PaginatedResponse<T>`.
- **Structured metrics**: `MetricsService` collects in-memory request counts, latency percentiles (p50/p95/p99), error rates, AI token usage, and DB query counts. Admin endpoint: `GET /api/v1/metrics`.
- **Request context**: `AsyncLocalStorage`-based request ID propagation through all async operations. Winston logger automatically includes `requestId` in every log entry.
- **AI Budget**: Per-user monthly token budget enforcement via `AIBudgetService`

### Frontend

- **Framework**: React 18
- **Build tool**: Vite
- **State management**: Zustand
- **Server state**: React Query (TanStack Query)
- **Styling**: Tailwind CSS
- **PWA**: Service worker with offline caching, install prompts, push notifications
- **SEO**: Static `<noscript>` prerender fallback in `index.html` with feature list, heading, and navigation links for search engine crawlers; Open Graph and Twitter Card meta tags

### API Structure

All API routes are prefixed with `/api/v1/` and organized by domain:

```
/api/v1/auth              Authentication (login, register, reset password)
/api/v1/projects          Project CRUD
/api/v1/schedules         Schedule and task management
/api/v1/resources         Resource pool management (paginated)
/api/v1/sprints           Sprint lifecycle
/api/v1/time-entries      Time logging
/api/v1/custom-fields     Custom field definitions and values
/api/v1/attachments       File upload and management
/api/v1/notifications     In-app notifications
/api/v1/portal            Stakeholder portal (public + admin)
/api/v1/intake            Form builder and submissions
/api/v1/templates         Project templates
/api/v1/integrations      Third-party integration management
/api/v1/webhooks          Outbound webhook configuration
/api/v1/workflows         DAG workflow definitions and execution
/api/v1/approvals         Change request approval chains
/api/v1/report-builder    Custom report templates and generation
/api/v1/report-schedules  Scheduled report delivery CRUD
/api/v1/ai-reports        AI-generated narrative reports
/api/v1/stripe            Billing and subscription management
/api/v1/api-keys          API key management
/api/v1/audit             Audit ledger queries
/api/v1/policies          Policy engine rules
/api/v1/search            Full-text search (9 types, type/project/status filters)
/api/v1/bulk              Bulk operations
/api/v1/portfolio         Portfolio overview
/api/v1/analytics         Portfolio analytics summary
/api/v1/alerts            Proactive alert feed
/api/v1/predictions       AI health, risk, and budget predictions
/api/v1/intelligence      Cross-project intelligence and anomaly detection
/api/v1/evm-forecast      Earned value forecasting
/api/v1/monte-carlo       Monte Carlo simulation
/api/v1/network-diagram   Precedence diagram layout
/api/v1/burndown          Sprint burndown data
/api/v1/resource-leveling Resource histogram and leveling
/api/v1/resource-optimizer AI resource optimization
/api/v1/auto-reschedule   Auto-reschedule proposals
/api/v1/nl-query          Natural language queries
/api/v1/ai-scheduling     AI task breakdown and scheduling
/api/v1/ai-chat           Mjuzi conversational AI (persistent)
/api/v1/task-prioritization  AI task ranking
/api/v1/meeting-intelligence Meeting transcript analysis
/api/v1/lessons-learned   Retrospective knowledge base
/api/v1/learning          AI learning feedback
/api/v1/exports           Data export
/api/v1/agent             Agent scheduler (14 agents, parallel execution with concurrency 3)
/api/v1/agent-log         Agent activity log
/api/v1/agent/proposals   Agent proposal management
/api/v1/agent/autonomy    Tier 3 autonomy configuration
/api/v1/users             User management
/api/v1/project-members   Project membership
/api/v1/ai/budget         AI token budget usage (per-user)
/api/v1/rag               Semantic search (RAG)
/api/v1/metrics           Application metrics (admin-only)
/api/v1/ws                WebSocket connections
/mcp                      MCP HTTP transport proxy
```

### Environment Variables

| Variable | Purpose |
|----------|---------|
| `NODE_ENV` | production / development |
| `DATABASE_URL` | MySQL connection string |
| `JWT_SECRET` | Token signing secret |
| `COOKIE_SECRET` | Cookie signing secret |
| `CORS_ORIGIN` | Allowed origin for CORS |
| `AI_ENABLED` | Enable/disable AI features (true/false) |
| `ANTHROPIC_API_KEY` | Claude API key (required if AI_ENABLED) |
| `STRIPE_SECRET_KEY` | Stripe secret key (optional) |
| `STRIPE_WEBHOOK_SECRET` | Stripe webhook signing secret |
| `APP_URL` | Public application URL |
| `PM_API_KEY` | API key for MCP server |
| `PM_BASE_URL` | Base URL for MCP server API calls |
| `DB_CONNECT_TIMEOUT` | DB connection establishment timeout in ms (default: 5000) |
| `DB_IDLE_TIMEOUT` | Idle connection cleanup timeout in ms (default: 30000) |
| `DB_QUEUE_LIMIT` | Max queued connection requests (default: 50) |

---

## Legal Pages

### Terms of Service

The Terms of Service (`/terms`) has been updated to include the following provisions:

- **Trial conversion clause** — describes how the 14-day free trial converts to a paid subscription at the end of the trial period if a payment method is on file.
- **Refund policy** — monthly plan fees are non-refundable. Annual plan fees are pro-rated and refundable within 30 days of the billing date. Token top-ups are non-refundable.
- **AI Usage Limits (Section 5A)** — highlighted section covering per-tier monthly token allowances (Trial: 25K, Consultant: 500K, SME: 1.5M, Enterprise: 5M), budget exhaustion behavior (AI features blocked, non-AI features unaffected), token top-up terms (non-refundable, no expiry), no carry-over of unused monthly tokens, per-user overrides, and fair use policy.
- **Governing law** — disputes are governed by the laws of British Columbia, Canada.
- **Dispute resolution** — parties agree to attempt informal resolution before pursuing formal legal proceedings.

### Privacy Policy

The Privacy Policy (`/privacy`) has been updated to include:

- **Google Analytics GA4 disclosure** — the application uses Google Analytics 4. Cookies set by GA4 include `_ga` (2-year expiry, identifies unique visitors) and `_ga_*` (session tracking). Users may opt out via browser settings or the Google Analytics opt-out browser add-on.
- **International data transfer** — user data may be processed outside Canada by third-party service providers (e.g., Anthropic, Stripe, Resend, Google). Transfers are subject to standard contractual clauses or equivalent safeguards.
- **PIPEDA compliance** — the policy affirms compliance with Canada's Personal Information Protection and Electronic Documents Act (PIPEDA).
- **Google as a third-party processor** — Google is identified as a data processor for analytics purposes, governed by Google's own privacy and data processing terms.

---

## Getting Started

### Prerequisites

- Node.js 22+
- MySQL 8.0+ (or MariaDB 10.5+)
- npm

### Installation

```bash
git clone <repository-url>
cd pm-assistant-generic
npm install

# Copy and configure environment
cp env.example .env
# Edit .env with your database credentials and secrets

# Start development servers
npm run dev
```

### Access Points

| Endpoint | URL |
|----------|-----|
| Application | http://localhost:3000 |
| API | http://localhost:3001 |
| API Documentation | http://localhost:3001/documentation |
| Health Check | http://localhost:3001/health (returns DB status, memory usage, overall health — 200 OK or 503 DEGRADED) |

### Production Build

```bash
npm run build
```

The build produces a `dist/` directory with compiled server and optimized client assets. In production, static files are served by the web server (e.g., LiteSpeed, Nginx) and API requests are proxied to the Fastify process.

---

## 47. User Support & Admin Troubleshooting

### Support Contact Links

Contextual "Need help?" and "Report this issue" mailto links appear on pages where users are most likely to be stuck:

| Page | Link Text | Pre-filled Context |
|------|-----------|-------------------|
| **Login page** | "Need help? Contact support" | Subject: "Login Help", body includes page URL and timestamp |
| **404 page** | "Need help? Contact support" | Subject: "Help - Page Not Found", body includes attempted URL and timestamp |
| **ErrorBoundary** (full-page crash) | "Report this issue" | Subject includes error message, body includes error details, URL, and timestamp |
| **RouteErrorBoundary** (section crash) | "Report this issue" | Same as ErrorBoundary |

All links use `mailto:support@kpbc.ca`. No backend or database changes required — purely client-side mailto links.

### Admin Users Table

The **Admin > Users** page provides a comprehensive user management table with 12 columns, all sortable by clicking the column header (ascending/descending toggle with arrow indicators):

| Column | Description |
|--------|-------------|
| **User** | Full name, email, and username |
| **Role** | Color-coded role badge (admin, project_manager, executive, pmo, etc.) |
| **Tier** | Subscription tier badge: Trial (gray), Consultant (blue), SME (green), Enterprise (amber) |
| **Organization** | Organization name (multi-tenant), or "none" if unassigned |
| **Signed up** | Account creation date |
| **Login status** | Email/login state badge — Verified (green), Unverified (gray), Pending login (yellow), Expired token (red). Sortable by urgency (expired first). |
| **Last login** | Most recent login timestamp |
| **Projects** | Number of projects created by the user |
| **AI Usage** | Color-coded progress bar showing current month's token consumption vs budget (green <70%, amber 70-90%, red >90%), with used/total token counts |
| **AI Budget** | Per-user budget override (inline-editable) or "tier default" |
| **Subscription** | Subscription status badge (active, trialing, past_due, canceled, none) and current period end date |
| **Status** | Active/Inactive toggle. Sortable. |
| **Actions** | Reset PW button; Unlock button (shown when login token is pending/expired); subscription event history button |

**Filters:** Search by name/email/username/organization. Dropdown filters for Role, Tier, Status (active/inactive), and Subscription Status. Showing count updates in real time.

**User search bar:** A live search input at the top of the Users tab filters the visible rows by name, email, or role as you type. The search is client-side (no extra API calls) and combines with the existing Role/Tier/Status/Subscription dropdown filters.

**AI Usage column:** The backend query JOINs `ai_usage_log` (current month) and computes `ai_tokens_used` per user. The frontend calculates usage percentage against the effective budget (per-user override or tier default) and renders a mini progress bar. The **Calls**, **Tokens**, and **Cost** columns in the AI Usage tab are sortable — click a column header to toggle ascending/descending order; an arrow indicator shows the active sort direction.

**Organization column:** The backend query LEFT JOINs `organizations` on `users.organization_id` to display the org name.

**Subscription column:** Joined from the `subscriptions` control-plane table. Status badge is color-coded: active (green), trialing (blue), past_due (amber), canceled (red), none (gray).

**API endpoints:**
- `POST /api/v1/admin/users/:id/clear-login-token` — clears stuck login verification tokens
- `PATCH /api/v1/admin/users/:id/budget` — sets or clears per-user AI token budget override
- `PATCH /api/v1/admin/users/:id/status` — activates or deactivates a user account
- `POST /api/v1/admin/users/:id/reset-password` — generates a password reset token
- `GET /api/v1/admin/users/:id/subscription-events` — returns the subscription event history for a user (admin only)

---

## 48. WebSocket Reconnection with Exponential Backoff

The WebSocket connection in `useWebSocket.ts` uses exponential backoff with jitter for automatic reconnection. When the connection drops, it retries with increasing delays (1s base, doubling each attempt, max 30s, +/-30% jitter) up to 20 attempts. A `ConnectionStatus` indicator in the TopBar shows the current state:

- **Connected:** Tiny green dot, auto-fades after 3 seconds
- **Connecting:** Amber pulsing dot with "Reconnecting..." tooltip
- **Disconnected:** Red dot with a clickable "Reconnect" link that resets attempts and triggers immediate reconnection

Exported hooks: `useConnectionState()` returns the current `WsConnectionState` (`'connected' | 'connecting' | 'disconnected'`). `reconnectNow()` forces an immediate reconnect attempt.

**Server-side connection limits:** The WebSocket server enforces a global cap of 2,000 concurrent connections and a per-user limit of 5 connections. When a user exceeds their per-user limit, the oldest connection is closed automatically. Keepalive ping/pong heartbeats (30s interval, 10s timeout) detect and terminate stale connections.

---

## 49. Favourite / Pinned Projects

Users can favourite (star) projects for quick access. Favourited projects appear at the top of the Projects page and in a "Pinned" section in the sidebar (up to 5).

### Database

`user_favourite_projects` table with composite PK `(user_id, project_id)` and FK cascade on project delete (migration 058).

### API Endpoints

| Method | Path | Description |
|--------|------|-------------|
| `GET` | `/api/v1/projects/favourites` | Get user's favourite projects (full objects) |
| `POST` | `/api/v1/projects/:id/favourite` | Add project to favourites |
| `DELETE` | `/api/v1/projects/:id/favourite` | Remove project from favourites |

The `GET /api/v1/projects` response now includes an `isFavourite` boolean flag per project.

### UI

- **Project cards** show a star icon in the header — filled amber when favourited, outline when not. Click toggles the state.
- **Projects page** sorts favourited projects to the top of the grid.
- **Sidebar** shows a "Pinned" section below the main navigation (PM view only) with up to 5 favourite projects as direct links.

### AI Token Usage Indicator

The sidebar displays a real-time **AI Token Usage Indicator** above the user section:

- **Expanded sidebar**: Shows "AI Tokens" label, percentage used, a progress bar, and "{remaining} of {budget} remaining" text.
- **Collapsed sidebar**: Shows a compact SVG ring chart with a lightning bolt icon.
- **Color-coded**: Green (<70% used), amber (70-90%), red (>90%).
- Data is fetched from `GET /api/v1/ai/budget` with a 5-minute stale time (React Query). Only shown to authenticated users.
