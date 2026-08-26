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

#### Schedule Selector (Multi-Schedule Navigation)

When a project has more than one schedule, a **pill/tab strip** renders at the top of the Schedule tab. Only the selected schedule is rendered — no duplicate toolbars or simultaneous views. On mobile, the strip collapses to a native `<select>` dropdown for touch-friendly switching.

#### Schedule Toolbar

The Gantt toolbar is a compact single row:

```
[Search] [Filters] | [Columns] [Critical Path] | [⋯]
```

When **Critical Path** is enabled, a styled banner appears below the toolbar showing total project duration (days) and the number of critical tasks.

**Date formatting**: dates in the Gantt left panel show month and day (e.g. "Aug 19"). When a date falls in a different year than the current year, a 2-digit year is appended (e.g. "Jan 15, '27") for cross-year visibility.

The **⋯ overflow menu** exposes infrequently-used actions in grouped sections:

| Group | Actions |
|-------|---------|
| **Baseline** | Save baseline, Select baseline, Show variance |
| **Scenarios** | Create scenario, Select scenario, Compare |
| **Data** | Import (CSV / Excel / XML), Export CSV |
| **Automation** | AI Reschedule, Level Resources, % Mode |
| **Help** | Keyboard shortcuts |
| **Danger** | Delete schedule (red, destructive) |

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

A daily cron job (02:00 UTC) scans for templates and generates instances within a 14-day horizon. Additionally, when a user creates a recurring template via the task form, instances are immediately expanded up to 90 days ahead via the `POST /:scheduleId/tasks/:taskId/expand-recurrence` API. Generated instances link back to their parent template via `recurrence_parent_id`. Template tasks appear in the Gantt chart with a blue repeat icon; instances show a smaller repeat icon.

### Non-Working Day Shading

When viewing the Gantt chart at Day or Week zoom levels, non-working days (weekends, holidays, custom calendar exceptions) are shaded with a subtle grey overlay. The dates are fetched from the existing `GET /api/projects/:projectId/non-working-dates` endpoint and cached for 5 minutes. This helps project managers visually identify working vs non-working periods when scheduling tasks.

### Progress Mode (Duration vs Work)

Each schedule has a `progressMode` setting (default: `duration`) that controls how parent task completion percentages are calculated during rollup:

- **Duration mode** — parent progress is a weighted average of children by `estimatedDays` (traditional approach)
- **Work mode** — parent progress is a weighted average of children by `estimatedDurationHours` (effort-based approach)

The toggle is available in the Gantt toolbar under "% Mode". Changing the mode triggers a re-computation of all parent task rollup values.

### Resource Leveling (Quick Level)

A "Level Resources" button in the Gantt toolbar provides one-click resource leveling. Clicking it calls the existing resource leveling API, which analyzes task resource assignments and detects over-allocations. If adjustments are needed, a modal displays the proposed date changes with reasons. Users can review and click "Apply All" to reschedule the affected tasks, or cancel.

### MSPDI XML Import

The import modal now accepts Microsoft Project XML files (.xml) in MSPDI format, in addition to CSV and Excel. The client-side parser (`mspdiParser.ts`) extracts tasks with:
- Task names, WBS codes, outline levels (hierarchy)
- Start/finish dates and durations (PT format → days)
- Percent complete
- Predecessor links with dependency types (FS/FF/SS/SF) and lag

Parsed tasks are sent to the `POST /:scheduleId/import-structured` endpoint, which creates tasks in order, assigns parent-child relationships based on outline levels, and creates dependency links.

### What-If Scenarios

Schedules support clone-based what-if scenario analysis:

1. **Create Scenario** — clones the entire schedule (tasks, dependencies, hierarchy) into a new "scenario" schedule. Tasks in the scenario retain `original_task_id` links to the base schedule for comparison.
2. **Edit independently** — the scenario schedule appears in the schedule list and can be edited like any normal schedule.
3. **Compare** — select a scenario from the dropdown and click "Compare" to see a task-by-task diff showing date shifts, duration changes, and added/removed tasks. Summary cards show totals.
4. **Promote to Base** — replaces the base schedule's task dates/durations with the scenario's values and deletes the scenario.

API endpoints:
- `POST /:scheduleId/clone` — create scenario
- `GET /:scheduleId/scenarios` — list scenarios
- `GET /:scheduleId/compare/:scenarioId` — compare base vs scenario
- `POST /:scheduleId/scenarios/:scenarioId/promote` — promote scenario

### Views

- **Gantt chart** -- interactive timeline with dependency arrows and critical path highlighting. **Five zoom levels** (Day, Week, Month, Quarter, Year) with a **two-tier timescale header** (e.g. months over weeks, years over months). Zoom selection persists per schedule via localStorage. A **draggable splitter** between the task table and timeline lets you resize the panels; width persists per schedule. The left panel shows 13 columns: row number (#), task name, predecessor (row-number format with health dot), successor (Succ — read-only, derived from predecessor relationships), start date, end date, duration, estimated days, work (effort hours), progress %, priority, assigned to, and status. **Default visible columns** are the 6 essentials (Pred, Start, End, Duration, %, Status) plus # and Task Name which are always visible; the remaining columns (Succ, Est Days, Work, Priority, Assigned) are hidden by default to ensure the Task Name column has sufficient width. The left panel uses horizontal scrolling (overflow-x: auto) so all columns remain accessible without squeezing the task name. **Resizable columns**: drag column borders in the header to resize; the Task Name column has a 250px default width and is now fully resizable (not just flex-width); all resize handles show a visible dot indicator; double-click a handle to auto-fit that column to its content; widths persist per schedule in localStorage. **Column picker**: Columns button in toolbar toggles column visibility; # and Task Name always visible; persists per schedule. **Row expand/collapse**: parent tasks have a chevron toggle to collapse/expand children; persists in localStorage. **Collapse All / Expand All** buttons in toolbar toggle all parent tasks at once. **Click-to-select, click-to-edit**: first click on a task row selects it (highlights with a primary ring); clicking again on the selected row enters inline edit mode for that cell. This matches MS Project behavior and enables selection-dependent actions like Tab indent before editing. **Inline grid editing**: once selected, click any cell (except row #) to edit directly — text inputs for name/assignee, date pickers for start/end, number inputs for est days/work hours/%, select dropdowns for priority/status, and MS Project notation for predecessors. Tab/Shift+Tab navigates across fields and rows. Duration edits auto-compute end date. Enter saves, Escape cancels, blur auto-saves, green flash confirms. **Row drag reorder (cross-parent)**: hover over the # column for a drag grip; drag rows to any position — tasks can be moved across parent levels (MSP-style free drag). Dropping on a summary task makes the dragged task its first child; dropping between tasks makes it a sibling of the drop target. Summary tasks move with all their descendants. Cycle prevention blocks dropping a parent onto its own child. Both sort order and parent assignment are persisted and undoable. **Multi-select bulk edit**: Ctrl+click (Cmd+click on Mac) to add/remove individual tasks from selection, Shift+click for range select, or use checkboxes in the # column. Sticky toolbar for bulk status/priority/assignee changes and delete. Delete key triggers a confirmation modal showing the exact task count ("Delete N tasks?"). Right-clicking a task when multiple tasks are selected shows "Delete N Tasks" in the context menu, and the confirmation modal covers all selected tasks plus the right-clicked task. Both paths use the same ConfirmModal (not the browser's native `window.confirm()`). **Undo/Redo**: Ctrl+Z/Ctrl+Y or Ctrl+Shift+Z (up to 50 actions per session) for inline edits, bar drags, reorders, bulk updates, and delete operations (single or bulk). Task data is captured before deletion so undo can fully recreate tasks via the API. Creating new tasks is not undoable. Stack resets on navigation or page refresh. Undo/redo buttons in toolbar with tooltips. **Keyboard navigation**: Arrow keys move between cells, Enter/F2 to edit, Escape to clear focus. Supports drag-and-drop rescheduling: drag a bar to move a task, drag the right edge to resize; timeline auto-scrolls when dragging near viewport edges. Date changes cascade through dependencies automatically. Dependency arrows are colour-coded by predecessor health: green (completed), yellow (in progress), red (overdue/at risk). Hover over a bar to see predecessor details including row number, task name, and health status. **Column header sort**: click any column header to cycle through ascending/descending/none; sort indicator (▲/▼) shown in header; sorts within sibling groups to preserve hierarchy; row drag reorder disabled while sort is active. **Copy/Paste cells**: Ctrl+C copies the focused cell value to clipboard; Ctrl+V pastes into the focused cell (same field type only); green flash confirms. **Copy/Paste rows**: When no cell is focused, Ctrl+C copies the selected/active task(s) and Ctrl+V pastes them as duplicates with a "(copy)" suffix. **Column auto-fit**: Double-click a column's resize handle (right border of a column header) to auto-fit the width to its content via canvas text measurement, capped at 400px. **Baseline bar refinement**: ghost bars are rendered only when a task's baseline dates differ from its current dates, eliminating visual noise for on-schedule tasks. **Indent/Outdent**: Tab indents the selected or focused task (makes it a child of the task above); Shift+Tab outdents (promotes to parent's parent). Works both when a task is simply selected (clicked) and when a cell is focused (via arrow keys). **Multi-select indent**: select multiple tasks via checkboxes, then press Tab to indent them all or Shift+Tab to outdent; selected tasks won't indent under each other. Both operations go through onTaskUpdate and are undoable. **Bar progress drag**: drag the progress fill edge in a task bar to set completion percentage; visible handle appears on hover; change is undoable via Ctrl+Z. **Row action icons**: each row shows three action icons on hover — edit (pencil, opens task editor), insert below (+ icon, opens an inline input row directly below where you type a task name and press Enter to create — no modal), and delete (trash, opens a confirmation modal; if multiple tasks are selected the trash icon deletes the entire selection). Icons fade in with opacity transition on row hover. **Inline task insert**: the + button and right-click → Insert After both use inline insert — a green-tinted blank row appears below the target task with an auto-focused input. Enter creates the task at the correct sort position, Tab creates and opens another blank row for continuous entry (MS Project style), Escape cancels. The new task inherits the parent of the target row. Insert Before still uses the full task form modal. **MPP-style inline task entry**: 3-6 persistent empty rows appear below existing tasks in the left panel (MS Project style) with continuation row numbers. Click into the Task Name cell and type a name, press Enter to create the task instantly without a modal. The first empty row shows a "Type a task name…" placeholder. When the schedule has no tasks, the empty rows are the primary way to start adding tasks (an Add Task button is also shown).
- **Kanban board** -- drag-and-drop cards grouped by status. **Subtask and dependency badges**: each card shows a count badge for subtasks (child tasks) and dependencies, derived from the loaded task list without additional API calls. **Inline quick-add**: a "+" button at the bottom of each status column reveals an inline text input — type a task name and press Add to create a task directly in that column without opening a modal. **Swimlane mode**: a dropdown in the Kanban header lets you group cards by Assignee or Priority in addition to the default flat status layout. Each swimlane row shows a label column and mini status columns per lane. Swimlane selection persists in localStorage.
- **Calendar view** -- tasks plotted on a calendar grid with three display modes. **Month view** (default): tasks shown as dots and short labels per day cell; supports drag-to-reschedule by dragging a task from one day to another (task duration is preserved — start and end dates shift together). **Week view**: 7-column layout with large day headers and full task lists per day, showing priority, assignee, and date range. **Day view**: single-day detail view with rich task cards showing priority badge, assignee, date range, and progress bar. Toggle between Month / Week / Day using buttons in the calendar header. Navigation arrows and a Today button move through time periods in any mode.
- **Table view** -- sortable, filterable spreadsheet-style listing with a customizable column picker. Full feature parity with the Gantt chart. Choose from 22 columns across four groups (Standard, Scheduling/CPM, Baseline, Other). The **# (row number)** column is always visible and shows sequential numbering. The **Predecessor** column displays dependencies in compact MS Project-style row-number format (e.g. "3", "7SS+2d") with colour-coded health badges: green dot (predecessor completed), yellow dot (in progress), red dot (overdue). Predecessors are **inline-editable** — click and type a row number with optional type and lag. Column selections persist per schedule. Scheduling columns automatically trigger CPM computation. Baseline columns show variance data when a baseline comparison is active. **Right-click context menu**: right-click any task row to open a menu with Insert Before, Insert After, Edit Task, Indent, Outdent, and Delete. Insert After uses inline insert (blank row appears below for quick name entry). When multiple tasks are selected, Delete shows the count and removes all selected plus the right-clicked task. **Row action icons**: each row shows three action icons on hover — edit (pencil), insert below (+ icon, inline insert), and delete (trash). **Inline task insert**: the + button and right-click → Insert After both show a green-tinted blank row below the target task. Enter creates, Tab creates + continues, Escape cancels. Same behavior as the Gantt chart. **Tab indent / Shift+Tab outdent**: select a task (or multi-select) and press Tab to indent under the task above, or Shift+Tab to outdent. Works identically to the Gantt chart. **Delete key**: press Delete to remove the active task or all selected tasks via a confirmation modal. **Undo/Redo**: Ctrl+Z/Ctrl+Y (up to 50 actions per session) for edits, bulk updates, and deletions. Undo/redo buttons in the toolbar with tooltips. **Bulk operations with undo**: multi-select via checkboxes, use the bulk toolbar for status/priority/assignee changes — all tracked in the undo history. **Saved Views** let you name and store column+sort configurations; load, update, or delete them from the Views dropdown. **Group-by**: a dropdown in the header lets you group rows by Status, Priority, or Assignee. Each group has a collapsible header row showing the group name and task count. Collapsed groups persist in localStorage. **MPP-style empty rows**: 5-8 persistent empty rows appear at the bottom of the table (MS Project style). Each row shows a continuation row number and an editable Task Name cell — click and start typing, press Enter to create the task. The input clears and new empty rows remain available for the next entry. The first empty row shows a "Type a task name…" placeholder. **Arrow key navigation**: Use Arrow keys to move between cells (focused cell gets a blue ring). Press Enter or F2 to enter edit mode; Escape to clear the focus. First click selects the row; second click on a selected row enters edit mode (matching Gantt behavior). **Cell-level copy/paste**: When a cell is focused, Ctrl+C copies its value to the clipboard and Ctrl+V pastes from the clipboard into the same field type; a green flash confirms. **Copy/Paste rows**: When no cell is focused, Ctrl+C copies the selected/active task(s) and Ctrl+V pastes them as duplicates with a "(copy)" suffix appended to the task name. **Resource column**: The Resource column (inline chip assignment via `ResourceQuickAssign`) is available in the Table View column picker — the same quick-assign functionality previously available only in the Gantt chart. **Column auto-fit**: Double-click any column's resize handle (the right border of a column header) to auto-fit the column width to its content. Width is measured via canvas text measurement and capped at 400px.

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

### Task Constraints (CPM)

Tasks support 8 constraint types that influence the CPM forward/backward pass:

| Constraint | Description |
|---|---|
| ASAP | As Soon As Possible (default) |
| ALAP | As Late As Possible — ES shifted to LS after backward pass |
| SNET | Start No Earlier Than — ES = max(ES, constraint date) |
| SNLT | Start No Later Than — ES = min(ES, constraint date) |
| FNET | Finish No Earlier Than — shifts ES forward so EF meets constraint |
| FNLT | Finish No Later Than — shifts ES back so EF doesn't exceed constraint |
| MSO | Must Start On — ES = constraint date |
| MFO | Must Finish On — EF = constraint date, ES = EF - duration |

Constraints are stored as `constraint_type` (VARCHAR 4) and `constraint_date` (DATE) on the tasks table. Set via the Task Form modal or inline in the Table view's Scheduling column group.

### Task-Level Budget

Each task tracks `budget_allocated` (planned budget) and `actual_cost` (spent to date), both DECIMAL(12,2). The Table view's **Cost** column group shows:

- **Budget** — formatted as currency, inline editable
- **Actual Cost** — formatted as currency, inline editable
- **Cost Variance** — computed (budget - actual), color-coded green/red

Budget fields are also available in the Task Form modal. For summary tasks, budget rolls up automatically from children.

### Summary Task Auto-Rollup

When a task has children (via `parent_task_id`), it becomes a **summary task** (`is_summary = 1`). Summary task fields are automatically recomputed from children on every create/update/delete:

- **Start Date** = earliest child start
- **End Date** = latest child end
- **Progress** = weighted average by estimatedDays
- **Status** = all completed → completed, any in-progress → in_progress, else pending
- **Budget/Cost** = sum of children
- **Estimated Days** = sum of children

Summary fields are **read-only** in the UI — greyed out in inline editing and disabled in the Task Form modal. The Gantt chart renders summary tasks with diamond endpoint markers.

### Custom Calendars (Working Days)

Each project can have one or more calendars (`project_calendars` table) defining:

- **Working days** — array of weekday numbers (0=Sun through 6=Sat), default Mon-Fri
- **Hours per day** — default 8.0
- **Holiday exceptions** — specific dates marked as non-working (`calendar_exceptions` table)
- **Working exceptions** — specific non-working days overridden as working

API endpoints under `/api/projects/:projectId/calendars` provide CRUD for calendars and exceptions. The `/api/projects/:projectId/non-working-dates` endpoint returns non-working dates for a date range (used by the Gantt for shading).

### Multi-Resource Assignment

Tasks can have multiple resource assignments (`task_assignments` table):

- **Resource ID** — person or team assigned
- **Allocation %** — 1-100, how much of the resource's time is dedicated
- **Role on task** — optional role label
- **Hours planned** — optional planned hours

The primary assignee is denormalized to `tasks.assigned_to` for backward compatibility. Assignments are bulk-loaded alongside dependencies for efficient queries. The Task Form modal provides a multi-resource editor with add/remove rows, allocation percentage, and role fields.

### Baselines

The `BaselineService` captures point-in-time snapshots of a schedule. Each baseline records every task's start date, end date, estimated days, progress, and status. Baselines are immutable once created and are persisted to the database (`schedule_baselines` and `baseline_tasks` tables), so they survive server restarts. The `BaselineRepository` handles all CRUD operations.

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

The `SCurveService` computes cumulative Planned Value (PV), Earned Value (EV), and Actual Cost (AC) data points over time. For **Waterfall/Hybrid** projects, values are derived from task durations, progress percentages, and project budgets. For **Agile** projects, the service uses sprint story points instead — PV is based on cumulative committed points per sprint, and EV on cumulative completed points, both converted to dollars via `budgetPerPoint = BAC / totalBacklogPoints`. If an Agile project has no sprint data, it falls back to the duration-based calculation. These data points render as the classic S-curve chart regardless of methodology.

**Per-task Actual Cost (AC):** When tasks have `actualCost` values recorded, the S-curve AC series is computed by summing each task's actual cost and distributing it proportionally to the task's elapsed time within each period. This makes the AC curve (and therefore CPI and all cost-derived metrics) reflect real per-task spend data. If no per-task costs exist, the service falls back to the previous method: distributing the project-level `budgetSpent` linearly over the project timeline.

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
- **Eight KPI cards** (top row, 8-card grid): CPI, SPI, CV, SV, EV, PV, AC, BAC with color-coded values (green when healthy, red when critical).
  - **CV (Cost Variance)** card: EV − AC, colored green when positive (under budget) and red when negative (over budget). Hover tooltip includes plain-English definition, formula with live values, health bands, and guidance.
  - **SV (Schedule Variance)** card: EV − PV, colored green when positive (ahead of schedule) and red when negative (behind schedule). Same four-section tooltip format.
  - **CPI and SPI cards** also display a **period-over-period delta** — the change from the previous week's value shown inline next to the main figure (e.g., "+0.03" in green or "−0.05" in red), so teams can immediately see whether performance is improving or declining week over week.
- **Narrative summary panel**: a plain-English paragraph at the top of the dashboard covering both cost and schedule performance — "The project is X% complete with Y% of budget spent. It is [schedule status] and [cost status]. [Forecast sentence including predicted outcome]." The narrative explicitly addresses % complete vs planned progress, budget performance (CPI), and the projected project outcome. Accompanied by an **On Track / Needs Attention / At Risk** status badge and a **% Complete vs % Spent comparison bar** (blue bar for % complete; green or red bar for % spent, turning red when spend exceeds completion). Prompt version 1.3.0. **Verified facts:** the server pre-computes key figures (percentComplete = EV/BAC, percentPlanned = PV/BAC, scheduleStatus, budgetStatus, percentBudgetSpent = AC/BAC, schedule outlook, forecast outcome) and injects them into the AI prompt as "VERIFIED FACTS — use these exact numbers." The AI writes prose around these pre-computed values rather than deriving them independently, guaranteeing that every percentage and status label in the narrative matches the actual EVM metrics on the dashboard.
- **Four forecast cards**: EAC, ETC, VAC, TCPI with red warning borders when thresholds are exceeded.
- **Metric hover tooltips**: hovering any KPI or forecast card opens a rich tooltip with four sections — what the metric measures (plain English), the formula with calculated values from live project data, color-coded health bands (green/amber/red thresholds), and dynamic guidance that adapts based on whether the metric is healthy, warning, or critical. Implemented in `EVMMetricTooltip.tsx`; also applied to the CPI, SPI, and TCPI cards on the Project Detail EVM panel.
- **CPI/SPI Trend chart**: SVG line chart with blue CPI line, green SPI line, 1.0 baseline reference, and labeled axes. Dark mode uses class-based SVG fills for proper contrast. Enhancements:
  - **Trend Annotations**: crossover markers (small triangles) appear at points where CPI or SPI crosses the 1.0 baseline. Green triangle = crossed above 1.0 (improving); red triangle = crossed below 1.0 (deteriorating). Native browser tooltips on hover show the metric name and date.
  - **Period | Cumulative toggle**: a toggle button in the trend chart header switches between "Period" (existing weekly CPI/SPI values) and "Cumulative" (running CPI = EV/AC and SPI = EV/PV computed from S-curve data, showing the project-to-date efficiency trajectory). Useful for distinguishing weekly volatility from overall trend.
  - **Configurable threshold lines**: a gear icon (⚙) in the trend chart header opens an inline config panel with four editable threshold values — CPI Amber (default 0.95), CPI Red (default 0.85), SPI Amber (default 0.95), SPI Red (default 0.85). These render as dashed horizontal reference lines on the chart. Values persist in localStorage across sessions.
- **Early Warnings panel**: color-coded alert cards (critical = red, warning = amber, info = blue) with dark mode variants.
- **Forecast Comparison table**: multiple forecasting methods with EAC values and BAC variance. Enhancement:
  - **Management Reserve (MR) tracking**: an MR input field in the Forecast Comparison section header. When a value is entered, a purple "BAC+MR" dashed reference line appears on the forecast bar chart alongside the existing BAC line. The forecast table gains a Management Reserve summary row showing the MR amount and whether the worst-case forecast stays within the reserve. The MR value is stored in localStorage per project.
- **AI Predictions section** (when `AI_ENABLED=true`): AI-adjusted EAC with confidence range, overrun probability, trend direction, narrative summary, and corrective actions with priority badges. Corrective actions are schedule-aware — the AI receives task-level cost variances, behind-schedule tasks, high burn-rate tasks, blocked tasks (resolved to task names), and overdue tasks, then produces specific actions that reference actual task names and budget figures rather than generic advice.
- **CPI/SPI Gauge Visualization**: semicircular gauge dials on the CPI and SPI cards with a needle indicator and colored bands — red (0–0.9), amber (0.9–1.0), green (1.0+). Scale runs from 0 to 2.0. Provides an instant visual read on cost and schedule health.
- **Forecast Comparison Bar Chart**: horizontal bar chart displayed above the existing Forecast Comparison table. Each EAC forecasting method renders as a bar, with a dashed vertical line marking the BAC reference. Bars that exceed BAC are red; bars under BAC are green.
- **S-Curve Chart**: the cumulative PV/EV/AC S-Curve chart (previously only on the Project Detail page) is now also shown on the EVM Dashboard. Uses the existing `SCurveChart` component. The server API includes `sCurveData` in the EVM forecast response.
- **EVM PDF Export**: "Export PDF" button in the dashboard header. Captures the entire EVM dashboard (narrative, KPIs with gauges, S-curve, trend chart, warnings, forecast comparison, and AI predictions) as an A3 landscape PDF via `html2pdf.js`.
- **What-If Scenario Simulator**: collapsible section with two interactive sliders — Target CPI (0.5–1.5) and Budget Adjustment (±30–50% of BAC). Recalculates EAC, ETC, VAC, and TCPI in real-time, showing current vs simulated values with color-coded deltas. "Reset to actuals" button restores original values. Purely exploratory — no data is saved.
- **Variance Breakdown (Pareto)**: new `GET /evm-forecast/:projectId/task-variances` endpoint returns per-task CV (EV−AC) and SV (EV−PV). Dashboard shows a horizontal bar chart of the top 10 tasks by absolute cost variance (green = under budget, red = over budget, centered on zero). Below the chart, a compact table lists task name, budget, actual, CV, SV, and progress %. Uses task-level `budgetAllocated` and `actualCost` fields.
- **Earned Schedule (ES) Metrics**: computed client-side from S-curve data. Displays four values — ES (earned schedule in weeks), AT (actual time elapsed), SV(t) = ES − AT (schedule variance in time), SPI(t) = ES / AT (schedule performance index in time). Includes plain-English interpretation. Unlike SV($) which converges to zero near project end, SV(t) remains meaningful throughout.
- **TCPI Dual Target Analysis**: side-by-side comparison of TCPI targeting BAC (original budget) vs TCPI targeting EAC (current forecast). Color-coded: green (<1.05), amber (1.05–1.2), red (>1.2). When BAC-based TCPI is unrealistic but EAC-based is achievable, an amber callout suggests rebaselining.
- **Agile EVM Section**: displayed only for projects with `methodology = 'agile'`. Shows sprint-based EVM context including:
  - **Sprint context stats**: average velocity (pts/sprint), total backlog points, completed points with percentage, and sprint count.
  - **Velocity Trend chart**: reuses existing `VelocityChart` component showing completed story points per sprint with average velocity reference line.
  - **Sprint Burndown chart**: reuses existing `SprintBurndownChart` component for the active sprint (shows "No active sprint" message when none is in progress).
  - All EVM metrics (CPI, SPI, EAC, etc.) still work identically — the Agile branch only changes how PV/EV are computed (from story points instead of task duration). The AI prompt includes methodology context and sprint velocity data for Agile-specific corrective actions.

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
- Cost rate ($/hour, optional) — used in workload cost rollup and portfolio cost projections

The `GET /api/v1/resources` endpoint supports pagination via `?limit=` and `?offset=` query parameters (default limit 50, max 200). The response includes a `total` count for client-side pagination controls.

All major list endpoints use a shared pagination schema (`paginationSchema.ts`) with consistent defaults (limit 1–200, default 50; offset ≥ 0). Paginated endpoints return a `PaginatedResponse<T>` containing `data`, `total`, `page`, `pageSize`, and `totalPages`. The following endpoints support pagination:

- `GET /api/v1/projects` — user's projects
- `GET /api/v1/resources` — resource pool
- `GET /api/v1/schedules/:id/tasks` — tasks within a schedule
- `GET /api/v1/sprints/project/:projectId` — sprints for a project
- `GET /api/v1/templates` — project templates

### Workload Heatmap & Cost Rollup

The resource workload endpoint aggregates task assignments across projects to produce a per-resource, per-week demand profile. Over-allocated weeks are flagged.

**Cost rollup:** For each resource with a `costRateHourly` rate, the workload computation multiplies allocated hours × rate per week to produce per-resource and per-project cost totals. The `GET /api/v1/resources/workload/:projectId` response includes:
- `costRateHourly` and `totalCost` per resource
- `cost` per weekly entry
- `costSummary.totalProjectCost` — aggregate across all resources

The Workload Heatmap UI displays a **Cost** column per resource and an **Estimated Cost** summary card. Weekly cell tooltips include the cost for that week.

### Assignment Conflict Detection

When creating a resource assignment via `POST /api/v1/resources/assignments`, the system checks for over-allocation before inserting. It queries all existing assignments for the resource that overlap the requested date range, sums their `hoursPerWeek` with the new assignment, and compares against the resource's `capacityHoursPerWeek`. If the total exceeds capacity, a warning is returned in the response (the assignment is still created — warnings are advisory, not blocking):

```json
{
  "assignment": { ... },
  "warnings": ["Resource 'Jane Smith' would be allocated 56h/week against 40h capacity (140% utilization) during 2026-01-06 to 2026-03-31"]
}
```

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
- **Summary cards**: Total Resources, Over-allocated count, Average Utilization, Estimated Cost (shown when resources have cost rates).
- **Four tabs**:
  - **Team** — Full table of all resources with create, edit, and delete capabilities. Managers can add new resources, update roles/capacity/cost rates, and remove resources directly from this tab. Delete requires confirmation via modal dialog. CSV import includes keyboard-accessible drop zone with file size validation and read-error handling.
  - **Workload Heatmap** — Table showing all resources with weekly utilization percentages as colored cells (green < 80%, blue 80–100%, amber 100–120%, red > 120%). Displays resource name, role, average utilization, cost per resource, and per-week cells with cost tooltips.
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
| `send_notification` | Creates a real notification via NotificationService (notifies the project manager). Notifications may include `suggestedActions` — one-click action buttons rendered inline via `AlertActionButton` (e.g., "Reschedule", "Escalate"). |
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

The `ApprovalWorkflowService` defines multi-step approval chains scoped to a project and entity type. Each step specifies an approver role and execution order. Workflows cannot be deleted while active (pending/in-review) change requests reference them — the delete endpoint returns HTTP 409.

### Change Requests

Change requests capture proposed modifications with:

- Title, description, category (enum: scope/schedule/budget/resource/other), and priority (enum: low/medium/high/urgent)
- Impact summary (free text, max 2000 chars)
- Status lifecycle: `draft` → `pending` → `in_review` → `approved` | `rejected` | `withdrawn`
- Link to an approval workflow (required at submission)
- Full action history with comments per step, enriched with user names and workflow step metadata
- Rejected CRs can be edited and re-submitted (status returns to `pending` on re-submission)

**User name enrichment**: All CR queries JOIN the users table to return `requestedByName` and `actedByName` alongside raw UUIDs.

**Filtering**: The list endpoint accepts `status`, `priority`, `sortBy` (created_at/priority/status/title), and `sortDir` (asc/desc) query parameters.

### Approval Actions

Each step in a change request records: who acted (with resolved user name), what action they took (approve/reject/return), optional comment, and timestamp. All actions are written to the audit ledger.

**Action normalization**: The API accepts both present-tense (`approve`, `reject`, `return`) and past-tense (`approved`, `rejected`, `returned`) action values — they are normalized to past tense before processing.

**Notification**: When an approval action is taken, the CR requester receives an in-app notification with the action, step name, and any comment. Severity is `high` for rejections, `medium` for approvals/returns.

**Email notification**: In addition to the in-app notification, the CR requester receives an email when a change request is approved, rejected, or returned. The email includes the CR title, action taken, workflow step name, reviewer comment (if any), and a call-to-action link to view the CR. Email notifications are fire-and-forget (non-blocking) and only sent if the user has email notifications enabled in their settings.

**Withdrawal**: Withdrawing a CR validates that it is in `pending` or `in_review` status, logs an audit entry, and dispatches a `change_request.withdrawn` webhook event.

### Authorization

- CR creation and listing require project access (`editor` for write, `viewer` for read)
- Detail, submit, action, and withdraw endpoints verify project membership by resolving the CR's `projectId` and checking via `projectMemberService`
- Role enforcement on approval steps: each step's `approverRole` is validated against the acting user's role (admins bypass)
- Global roles (admin, PMO) have full access; executives have read-only access

### Status Report Integration

Change requests appear in the **Change Control** section of status reports. The query filters to active/recent CRs: excludes `withdrawn` status and limits to the last 90 days to prevent report bloat.

---

## 7. Sprint / Agile

### Sprint Tab Header

The Sprint tab header shows at-a-glance status for the active sprint:

- **Progress bar** — Colored bar showing task completion percentage (amber < 50%, blue 50-99%, green 100%).
- **Day progress indicator** — "Day X of Y" label with a mini progress bar showing elapsed time within the sprint timebox.
- **View switcher** — Toggle between List, Planning, Board, Burndown, Burnup, Flow, Metrics, Capacity, Standup, Retro, and Definitions views when a sprint is selected.

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

Aggregated time entry views per user per week, suitable for approval workflows and payroll integration. The Timesheet page includes a **"Log Time"** button that opens an inline form with project, schedule, and task dropdowns plus date, hours, and description fields, allowing time entries to be created directly from the timesheet without navigating away. Mobile week navigation icons are also displayed correctly on small screens. The weekly grid displays project and task **names** (not raw IDs), and the approval panel shows submitter and project names in the expanded detail view. All destructive actions (delete entries, deactivate users) require confirmation via a modal dialog.

### Actual vs. Estimated

Compare logged hours against task estimated effort to identify underestimation patterns and improve future planning accuracy.

### Timesheet Approval Workflow

Time entries follow a formal approval lifecycle before they are considered finalized:

**Status flow:** `draft` → `submitted` → `approved` or `rejected`. Rejected entries revert to `draft` so the user can correct and resubmit.

**Submission granularity:** All entries for a given user within a specific week and project are submitted together as a single submission. Users cannot submit individual lines in isolation.

**API endpoints:**

| Method | Endpoint | Description |
|--------|----------|-------------|
| POST | `/time-entries/submit` | Submit a week+project timesheet |
| POST | `/time-entries/recall/:submissionId` | Recall a submitted (unreviewed) timesheet |
| GET | `/time-entries/submissions` | User's own submission history |
| GET | `/time-entries/pending-approvals` | Manager's queue of pending submissions |
| POST | `/time-entries/approve/:submissionId` | Approve a submission |
| POST | `/time-entries/reject/:submissionId` | Reject a submission (reason required) |
| GET | `/time-entries/timesheet-status` | Weekly view enriched with submission status |

**Mutation guard:** `PUT` and `DELETE` on individual time entries return `409 Conflict` if the entry status is `submitted` or `approved`. Draft and rejected entries remain editable — rejected entries can be corrected and resubmitted without needing a recall.

**Authorization:** Only project managers and owners can approve or reject submissions. Users may only recall their own submissions.

**Notifications:** Submission triggers a `timesheet_submitted` notification to project managers. Approval sends `timesheet_approved` to the user. Rejection sends `timesheet_rejected` (high severity) with the rejection reason.

**Database:** Migration `T019_timesheet_approval.sql` adds `status`, `approved_by`, and `approved_at` columns to `time_entries` and creates the `timesheet_submissions` table.

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

### Custom Field Manager (Project Overview)

On the **Overview** tab of a project, editors see a **Custom Field Manager** section below the custom field values. This component (`CustomFieldManager`) allows defining new custom field schemas directly from the project page — add fields, set types, configure dropdown options — without navigating to Settings. Changes apply to all entities in the project.

### Custom Field Manager in Project Overview

On the project **Overview** tab, editors see a **Custom Field Manager** section below the existing custom field values. This inline panel (powered by the `CustomFieldManager` component) lets project editors define and manage custom field schemas directly from the project page — add new fields, set types and options, or remove fields — without navigating to Settings.

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

**Chart rendering:** Query results with suggested charts are rendered using the extracted `DynamicChart` component — a shared SVG-based charting system supporting bar, line, pie, and horizontal-bar types. The QueryPage converts the AI's Chart.js-style schema (datasets with data arrays) into the flat `ChartDatum[]` format via an adapter function, supporting multi-dataset grouping and automatic color assignment.

**Chart rendering:** AI-suggested charts (bar, line, pie) are rendered using the extracted `DynamicChart` component — lightweight SVG-based charts with automatic axis scaling, color coding, and responsive sizing. The QueryPage converts the AI's Chart.js-style response schema (datasets with label arrays) into the `DynamicChart` flat data format via an adapter function.

**Trial User Experience:** Trial users who submit a query on the Ask AI page are not blocked with a 403. Instead, `POST /api/v1/nl-query` returns a **sample NL query response** with demo data: a short narrative answer, a sample bar chart (task status breakdown across demo projects), and 3 suggested follow-up questions. An amber upgrade banner reads: "Sample Query — This is a sample response with demo data. Upgrade to a paid plan to query your real project data." No AI tokens are consumed for the sample. This follows the same pattern as Status Reports, EVM, and Monte Carlo.

### Meeting Intelligence

The `MeetingIntelligenceService` processes meeting transcripts or notes to extract:

- Action items with assignees and due dates
- Key decisions made
- Risk items identified
- Issues and dependencies

The Meeting Intelligence page (sidebar label: **Intelligence**, Brain icon, URL: `/meetings`) is a single-page flow — no tabs. It replaces the former three-tab Meeting Minutes page.

**Trial User Experience:** Trial users who submit a transcript are not blocked with a 403. Instead, `POST /api/v1/meeting-intelligence/analyze` returns a **sample meeting analysis** populated with realistic demo data: a brief executive summary, 3 sample action items (with assignees and due dates), 2 sample decisions, 1 sample risk, and 1 task update suggestion. An amber upgrade banner reads: "Sample Meeting Analysis — This is a sample analysis with demo data. Upgrade to a paid plan to process your real meeting transcripts." The **Apply Changes** button and the **History** table remain gated for trial users. No AI tokens are consumed for the sample.

#### Input Modes

The top of the page presents two input modes:

- **Paste** — text area for pasting or typing a transcript directly. Includes a voice recording toggle (browser Speech Recognition) so users can dictate into the text area.
- **Upload** — drag-and-drop zone accepting `.txt` (Otter.ai), `.vtt` (Teams/Zoom), or `.srt` files. The server auto-detects format, parses speaker attribution and timestamps, and feeds the cleaned text into the AI analysis pipeline via `POST /api/v1/meeting-intelligence/upload-transcript` (multipart form).

- **Import Meeting** — opens the `SyncExternalMeetingModal` to manually import a meeting from any external source (Read.ai, Otter.ai, or any other platform). Users fill in the meeting title, date, duration, location, attendees, summary, and action items (one per line, with optional "Name: Description" format for auto-parsed assignee attribution). On submit, a completed meeting record and associated action items are created via `POST /api/v1/meetings/sync-external`.

An optional **Meeting Title** field lets users label the analysis for easier retrieval in the History table.

#### Running an Analysis

After providing input, users select the associated project and schedule, then click **Process**. The AI extracts five categories:

- **Summary** — concise meeting recap
- **Action Items** — tasks with suggested assignees and due dates
- **Decisions** — key decisions recorded
- **Risks** — potential issues mentioned
- **Issues** — live problems or blockers raised
- **Dependencies** — inter-task or inter-team dependencies

Action items can be converted directly into schedule tasks via **Apply Changes**.

#### Analysis Results (MeetingResultPanel)

After processing, the `MeetingResultPanel` renders the full analysis and provides two actions:

- **Send to RAID** — opens `MeetingToRaidModal` to import extracted findings into the RAID log (see below).
- **Send Minutes** — emails formatted HTML minutes (summary, action items table, decisions list) to specified recipients. Supported via `POST /api/v1/meetings/:id/send-minutes`.

#### Send to RAID

The AI analysis extracts five categories of RAID-relevant items: Risks, Issues, Action Items, Decisions, and Dependencies. Issues and Dependencies are stored in dedicated columns on `meeting_analyses` (added by migration `101_meeting_analysis_raid.sql`).

**Workflow:**

1. Click **Send to RAID** in the result panel.
2. `MeetingToRaidModal` opens, grouping items by RAID type.
3. For each item:
   - Check or uncheck the checkbox to include or exclude it.
   - Edit the title inline.
   - Choose severity (critical / high / medium / low) and category from dropdowns.
   - Items flagged as likely duplicates of existing open RAID records are highlighted — the duplicate check runs via `POST /api/v1/meeting-intelligence/:analysisId/check-raid-duplicates` before the modal opens.
4. Click **Import Selected** to create the checked items in the RAID log. All imported records are tagged with `source: 'meeting'` (migration `T025_raid_meeting_source.sql`).

**Mapping logic:** The `meetingToRaidMapper.ts` utility translates Meeting Intelligence item shapes into RAID record shapes (type, severity defaults, category defaults) before submission.

#### Analysis History

A searchable, filterable table at the bottom of the page lists all past analyses for the project. Rows are expandable to show the full result. Each row includes a **Send to RAID** button to re-push any historical analysis into the RAID log.

#### API Endpoints

| Method | Path | Description |
|--------|------|-------------|
| POST | `/api/v1/meeting-intelligence/analyze` | Run AI analysis on pasted transcript |
| POST | `/api/v1/meeting-intelligence/upload-transcript` | Upload transcript file for AI analysis |
| POST | `/api/v1/meeting-intelligence/:analysisId/check-raid-duplicates` | Duplicate check before RAID import |
| POST | `/api/v1/meeting-intelligence/:analysisId/send-to-raid` | Import meeting items into RAID log |
| POST | `/api/v1/meetings/:id/send-minutes` | Email formatted minutes to recipients |
| POST | `/api/v1/meetings/sync-external` | Import meeting + action items from external source |

### Lessons Learned

The `LessonsLearnedService` captures and retrieves project retrospective insights, categorized and searchable, to improve future project execution. Lessons can be edited and deleted directly from the Lessons Learned page: the edit action opens the same lesson modal pre-filled with existing values; the delete action presents a styled `ConfirmModal` before removing the record. The page supports **"Load More" pagination** so large lesson databases load incrementally rather than all at once.

#### Integration Points

Lessons learned surface proactively at four points in the project lifecycle:

- **Dashboard Widget** — The "Lessons & Insights" widget (AI group, opt-in via Customize) displays trending patterns and recent lessons from the knowledge base directly on the dashboard.
- **Project Closeout Prompt** — When a project's status is changed to "completed", a modal prompts the user to trigger an AI analysis to extract and record lessons learned from that project.
- **Risk Creation — Similar Lessons** — In `RiskFormModal`, a collapsible panel auto-appears once the risk/issue title reaches 10+ characters, showing relevant historical lessons from past projects to inform the current entry.
- **Project Kickoff — Relevant Lessons** — On the Overview tab of projects in "planning" status, a dismissible banner surfaces lessons from similar project types and categories to guide early decisions.

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

### AI Status Report Generator (DBJ Template Standard)

AI-powered executive status report following the DBJ Template Standard with 8 structured sections. Claude analyzes project data and produces a structured JSON response that is rendered as styled HTML for both the UI modal and email delivery.

**Report Format (8 Sections):**

1. **Header Metadata** — Auto-incrementing report number (SR-001, SR-002, …), reporting period (last 14 days with start/end dates), prepared-by name, and generation date. Report numbers are sequential per project.

2. **Executive Summary** — AI-generated paragraph summarizing overall project health, key concerns, and outlook for the reporting period.

3. **Overall Status (RAG Traffic Light Dashboard)** — Table with 7 dimensions, each showing previous status, current RAG status (🟢 Green / 🟡 Amber / 🔴 Red), trend arrow (↑ Improving / → Stable / ↓ Declining), and comments:
   - **Overall Status** — Rollup row showing the worst RAG across all other dimensions
   - Schedule
   - Budget
   - Resources
   - Risks
   - Scope / Change Control
   - **Governance & Stakeholders** — New dimension assessing stakeholder engagement and governance health
   - Quality

4. **Milestone Status** — Table of project milestones (sourced from tasks where `is_milestone = true`) showing milestone name, baseline date, forecast/actual date, and RAG status. Provides at-a-glance tracking of key deliverable dates.

5. **Achievements This Period** — Summary of tasks completed within the last 14 days, automatically gathered from task completion data. Shows what was delivered during the reporting period.

6. **Planned Activities Next Period** — Upcoming tasks due within the next 14 days, sourced from the project schedule. Shows what is planned for the coming period.

7. **For Management Attention** — Critical and high-severity RAID items requiring leadership action, sourced from open RAID items. Each item includes an impact-if-delayed consequence statement to convey urgency.

8. **Change Control** — Active change requests sourced from the `change_requests` table. This section is entirely data-driven (no AI generation) and shows request title, status, priority, and impact.

**RAG Thresholds (configurable):**
- Schedule: Green = <5% tasks overdue, Amber = 5–15%, Red = >15%
- Budget: Green = <90% spent vs progress, Amber = 90–100%, Red = >100%
- Resources: Green = 0 overallocated, Amber = 1–2, Red = 3+
- Risks: Green = 0 high/critical, Amber = 1–2 high, Red = 3+ or any critical
- Scope: Green = 0 change requests, Amber = 1–2 pending, Red = 3+ or unapproved growth
- Quality: Green = <5% tasks missing data, Amber = 5–15%, Red = >15%
- Governance & Stakeholders: AI-assessed based on stakeholder engagement signals and governance activity

**Overall Status Rollup:** The Overall Status row automatically reflects the worst RAG across all individual dimensions. If any dimension is Red, Overall Status is Red. If none are Red but any are Amber, Overall Status is Amber. All Green means Overall Status is Green.

**Trend Computation:** Compares current RAG status against the previous report (stored in `ai_conversations` with `context_type = 'status-report'`). If current is better than previous → improving (↑), same → stable (→), worse → declining (↓).

**Data Sources:** All sections use existing project data — no new database tables are required. Milestones come from tasks with `is_milestone = true`. Achievements and planned activities come from task completion/due dates within the 14-day windows. Management attention items come from open RAID items with critical/high severity. Change control data comes from the `change_requests` table.

**Edit Before Sending:**

Click the **Edit** button in the Report tab to enter inline editing mode. All sections become editable:
- Executive summary text
- RAG status dropdowns (green/amber/red) for each dimension with commentary fields
- Milestone comments
- Achievement and planned activity bullet items (add/remove/reorder)
- Management attention items and change control rows

Click **Save** to re-render the report with your edits (calls `POST /status-reports/render`). Click **Cancel** to discard changes and revert to the original. Edits apply to the displayed report, the emailed version, and exports — what you see is what gets sent.

**Export Formats:**

- **HTML** — Download the styled report as a `.html` file (client-side, no server call)
- **PDF** — Export via the PDF button. Uses `html2pdf.js` client-side rendering with A4 format, 2x scale for crisp text
- **Word (.docx)** — Export via the Word button. The server builds a native Word document using the `docx` package with full styling:
  - Navy (#283480) header rows on all tables
  - RAG cells with proper background colors (green #A8D5A2, amber #FFD966, red #FF9B9B)
  - Calibri font throughout, matching the DBJ template
  - Full-width tables with percentage column widths
  - Section headings kept with their content across page breaks (`keepNext`)
  - Table header rows repeat on multi-page tables (`tableHeader`)

**API Endpoints:**
- `POST /api/v1/status-reports/generate` — Generate a status report for a project, optionally email it to recipients
- `POST /api/v1/status-reports/render` — Re-render HTML from edited structured report data
- `POST /api/v1/status-reports/export/docx` — Export structured report data as a Word (.docx) file
- `POST /api/v1/status-reports/email` — Email the displayed HTML report (including edits) to specified recipients
- `POST /api/v1/status-reports/schedule` — Create a recurring schedule (daily/weekly/monthly) with recipient list
- `GET /api/v1/status-reports/schedules/:projectId` — List active schedules for a project
- `DELETE /api/v1/status-reports/schedule/:id` — Delete a schedule (owner or admin only)

**MCP Tool:** `generate-status-report` — Available to project_manager, scrum_master, pmo, ba, and admin roles.

**Trial User Experience:** Trial users are not blocked with a 403. Instead, the endpoint returns a **sample status report** populated with realistic demo data (green/amber RAG statuses, trend arrows, and example management actions). An amber upgrade banner appears above the report reading "This is a sample report with demo data. Upgrade to a paid plan to generate AI-powered status reports…". The report is rendered at reduced opacity (80%). The Email, Schedule, and Download tabs/buttons are locked with a lock icon. No AI tokens are consumed for the sample report. Paid tier users are unaffected — full AI-powered reports are generated as normal.

**Feature Gating:** Full AI report generation requires a paid tier (consultant/sme/enterprise). AI generation requires `AI_ENABLED=true`; falls back to all-amber template when disabled. Email delivery requires `RESEND_API_KEY`.

### Strategic Risk Analysis (Risk Scan)

On-demand structural risk analysis that examines a project's schedule, milestones, dependencies, resources, and budget to identify risks that may not be visible from individual task views. The analysis uses a hybrid approach: five algorithmic detectors run first to surface data-driven findings, then (for paid tiers with AI enabled) Claude polishes the risk statements and adds cross-category insights.

**How to Use:**

Navigate to the **Reports** page, select a project, and click the **Strategic Risk Scan** tile in the Schedule & Risk category. The scan runs in the background using the same WebSocket pattern as the Status Report — a progress indicator displays while the analysis completes, and the finished report is delivered via WebSocket (`risk_scan_ready`).

**Five Detector Categories:**

1. **Schedule Risk** — Identifies tasks overdue or at risk of slipping, schedule compression (too many tasks in too few days), and critical path vulnerability. Severity thresholds: critical (>20% tasks overdue), high (>10%), medium (>5%).

2. **Resource Risk** — Detects over-allocated resources, single points of failure (one person assigned to many critical tasks), and skill coverage gaps. Severity thresholds: critical (3+ over-allocated resources), high (2), medium (1).

3. **Dependency Risk** — Finds long dependency chains (high cascade risk), circular dependency patterns, and tasks with excessive predecessors. Severity thresholds: critical (chain depth >8), high (>5), medium (>3).

4. **Milestone Risk** — Evaluates milestone clustering (too many milestones in a narrow window), milestones without supporting tasks, and milestones on the critical path with insufficient float. Severity thresholds: critical (3+ milestones at risk), high (2), medium (1).

5. **Budget Risk** — Analyzes burn rate vs. progress, cost overrun trajectories, and unfunded remaining work. Severity thresholds: critical (>120% cost performance index deviation), high (>110%), medium (>100%).

**AI Enhancement (Optional):**

When AI is enabled and the user is on a paid tier, Claude reviews the algorithmic findings to:
- Refine risk descriptions with project-specific context
- Identify cross-category compound risks (e.g., a resource bottleneck on a critical-path milestone)
- Prioritize findings by overall project impact

When AI is disabled or for trial users, the algorithmic findings are presented as-is.

**Export Formats:**

- **PDF** — Download the risk analysis as a PDF document (client-side rendering, A4 format)
- **HTML** — Download the styled report as an `.html` file

**No Content Stored:** Risk scan results are generated on demand and not persisted in the database. Run the scan again at any time for a fresh analysis based on current project data.

**Trial User Experience:** Trial users receive a **sample risk scan** with realistic demo findings across all five categories. An amber upgrade banner identifies the report as sample data. Export buttons are locked. No AI tokens are consumed.

**API Endpoint:**
- `POST /api/v1/risk-scan/generate` — Generate a strategic risk analysis for a project

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
- **Self-learning** — Mjuzi learns from conversations in two ways:
  - **User preferences**: when a user states an ongoing preference (e.g. “keep responses brief”, “always show budget numbers”), Mjuzi stores it via `remember_user_preference` and applies it to all future responses for that user.
  - **Correction memory**: when a user corrects a factual error (e.g. “the budget is $50K, not $30K”), Mjuzi stores the correction via `remember_correction` and avoids repeating the mistake. Project-specific corrections are scoped to that project; general corrections apply across all conversations.
- **Voice input** (browser Speech Recognition): users can click the mic, speak their message, and the transcript is sent as a normal chat message. Optional **text-to-speech** (“Speak replies”) reads the assistant’s replies aloud when enabled.
- **Conversation history UI** — History button and New Conversation button in the chat panel header. Click any past conversation to reload it.
- **Knowledge Base search** — Mjuzi has a `search_knowledge_base` tool that searches embedded product documentation via RAG (Retrieval-Augmented Generation). When users ask how-to questions ("how do I create a subtask?", "where is the Gantt chart?"), Mjuzi searches the indexed documentation instead of guessing. Documentation from USER_GUIDE.md, PRODUCT_MANUAL.md, WORLD_CLASS_FEATURES.md, ADMIN_MANUAL.md, and AI_DESIGN_FEATURES.md is chunked by section heading, embedded via OpenAI text-embedding-3-small, and stored in the `knowledge_base_chunks` table with vector embeddings in the `embeddings` table. Admins can trigger a reindex via `POST /api/v1/admin/knowledge-base/reindex` after doc changes.

### AI Reports

The `aiReportService` generates narrative project reports using AI, summarizing status, risks, and recommendations in natural language.

- **Background generation** — AI reports (risk-assessment, budget-forecast, resource-utilization) are generated asynchronously. The API returns a `jobId` immediately, and the completed report is delivered via WebSocket (`ai_report_ready` / `ai_report_failed`). This prevents Nginx 502 timeouts on long-running AI calls.
- **Styled HTML output** — AI report markdown is rendered to styled HTML matching the status report theme (navy #283480 headers, Calibri font, alternating-row tables). The `renderAIReportHtml()` utility in `src/server/utils/aiReportRenderer.ts` handles conversion via `marked`.

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

### Reports Page (Category-Based Layout)

The Reports page provides a unified report catalog organized into 5 collapsible category sections, replacing the previous flat dropdown-based generator. A **persistent project selector** at the top of the page determines which project all reports are generated against.

**Report Categories and Tiles:**

Each category section displays report tiles that can be clicked to generate a report. There are 19 total reports — 6 AI-powered reports and 13 instant (data-driven) reports:

1. **Project Status** — Status Report (AI), RAID Report (data-driven)
2. **Schedule & Risk** — Strategic Risk Scan (AI), Milestone Report (instant), Critical Tasks (instant), Late & Slipping Tasks (instant)
3. **Resources** — Resource Utilization (AI), Resource Overview (instant), Who Does What (instant), Resource Availability (instant), Resource Status (instant), Who Does What When (instant)
4. **Budget & Cost** — Budget Forecast (AI), Risk Assessment (AI), Resource Cost Overview (instant), Cost Overview (instant), Earned Value Summary (instant), Overbudget Resources (instant)
5. **AI Analysis** — all AI-powered report types grouped for visibility

Each tile shows the report name, a brief description, and a badge indicating whether it is an **AI** report or an **Instant** report.

**Instant Reports:**

Instant reports (Milestone Report, Critical Tasks, Late & Slipping Tasks, Resource Overview, Who Does What, Resource Availability, Resource Cost Overview, Overallocated Resources, Cost Overview, Earned Value Summary, Resource Status, Who Does What When, Overbudget Resources) are generated immediately from live project data with no AI involvement and no WebSocket wait. Results are rendered as styled HTML (navy #283480 theme, inline CSS) and displayed in the **InstantReportModal** with PDF and HTML export options.

The three newest instant reports are:

- **Resource Status** (Resources category) — Dashboard overview of resource counts by role and group, utilization distribution buckets (0%, 1–50%, 51–80%, 81–100%, >100%), average utilization percentage, overallocated resource count, and total capacity hours across the project team.
- **Who Does What When** (Resources category) — Time-phased weekly breakdown showing each resource's task assignments by week, hours per task per week, total hours across the reporting window, and capacity per week. Useful for communicating individual workloads to stakeholders.
- **Overbudget Resources** (Budget & Cost category) — Shows only resources where actual cost exceeds planned cost. Displays planned vs. actual hours and costs, variance amount, and variance percentage for each overbudget resource. Resources within budget are excluded.

- **API**: `POST /api/v1/instant-reports/generate` — accepts `{ projectId, reportType }` and returns styled HTML immediately
- **Service**: `InstantReportService` orchestrates data gathering, `instantReportRenderer` produces themed HTML

**AI Reports:**

AI-powered reports (Risk Assessment, Budget Forecast, Resource Utilization) still generate asynchronously in the background. The API returns a `jobId` immediately, and the completed report is delivered via WebSocket (`ai_report_ready` / `ai_report_failed`). This prevents Nginx 502 timeouts on long-running AI calls.

- **Styled HTML output** — AI report markdown is rendered to styled HTML matching the status report theme (navy #283480 headers, Calibri font, alternating-row tables). The `renderAIReportHtml()` utility in `src/server/utils/aiReportRenderer.ts` handles conversion via `marked`.

**See Also Links:**

The Reports page includes "See Also" links to the **EVM Dashboard** and **Monte Carlo Simulation** pages for users who need deeper analytical views.

### RAID Report (Data-Driven)

The RAID Report is a canned (non-AI) stakeholder report generated from live RAID item data. Available from both the Reports page and the RAID tab toolbar.

- **Filters**: type (Risk/Issue/Action/Decision), severity, owner, category — all optional, defaults to all open items
- **Summary Dashboard**: 4 cards showing open counts with severity breakdowns
- **All Items Table**: unified table sorted by severity (critical first), then days open
- **Overdue Actions**: highlighted section for past-due action items
- **Key Mitigations**: critical/high risks with mitigation plans listed
- **Output**: HTML with inline CSS (email-compatible), preview, download, email, schedule
- **API**: `POST /api/v1/raid-reports/:projectId/generate`, `POST /schedule`, `GET /schedules/:projectId`, `DELETE /schedule/:id`
- **Trial users**: receive a sample report with dummy data

### Report History

The Reports page maintains a history of all generated reports (AI reports, Status Reports, RAID Reports, Instant Reports) in a **sortable, paginated table** below the report catalog, with server-side filtering:

- **Tiered type dropdown** — hierarchical filter: All Types → AI Reports (with sub-types: Weekly Status, Risk Assessment, Budget Forecast, Resource Utilization) → Status Reports → RAID Reports. Sub-type filtering uses deterministic title matching on the server.
- **Date range picker** — From/To date inputs for filtering by generation date. Server-side: `created_at >= dateFrom AND created_at < dateTo + 1 day`.
- **Search** — filter by title (applied on Enter or blur)
- **Sortable columns** — click Title or Date column headers to sort ascending/descending
- **Pagination** — 20 reports per page with first/prev/page numbers/next/last controls. Server-side `LIMIT/OFFSET` — only fetches one page at a time.
- **Clear button** — resets all filters (type, search, date range) in one click
- **Delete** — soft-delete individual reports (sets `is_active = FALSE` in control plane DB)
- **Download** — export any report as HTML from the viewer modal
- **Smart rendering** — HTML reports (Status, RAID) render directly, markdown reports (AI) rendered via `marked` + DOMPurify
- **On-demand content loading** — the history list endpoint returns metadata only (title, type, date, project). Full report content is fetched separately via `GET /api/v1/ai-reports/:id` when the user clicks to view a report, reducing bandwidth on the list view.
- **Content retention** — **Status reports are kept permanently** (they are the historical governance record). **AI reports** (risk assessment, budget forecast, resource utilization) store metadata only — content is not persisted since it can be regenerated from current data. Users can download AI reports at generation time via the viewer modal. The history table shows an "EXPIRED" badge next to reports without stored content. Clicking an expired report shows a "Content Expired" message with a **Regenerate** button. RAID reports are lightweight and always retained.
- **API**: `GET /api/v1/ai-reports/history?type=&subType=&search=&dateFrom=&dateTo=&sortBy=&sortOrder=&page=&limit=`, `GET /api/v1/ai-reports/:id`, `DELETE /api/v1/ai-reports/:id`
  - History responses include `contentAvailable: boolean` per report
  - Detail responses include `contentPurged: boolean`

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

Critical and high-severity notifications are automatically sent via email (Resend) to users with `emailNotificationsEnabled = true` and a verified email. Users can configure a **digest frequency** (none, daily, weekly) in Settings > Notifications. The `DigestService` runs via cron at a user-configured hour and sends a summary containing:

- **Overdue tasks** assigned to the user
- **Upcoming deadlines** (next 3 days)
- **Unread notification count**
- **Meeting Action Items** — overdue action items assigned to the user across all meetings
- **Upcoming Meetings** — meetings scheduled within the next 3 days
- **Active Sprint Summary** — current sprint name, task completion count and percentage (rendered as a progress bar in the email)

#### Digest Customization

Users control digest content and delivery time in **Settings > Notifications**:

- **Preferred send hour** — choose any hour 0–23 UTC (replaces the previous hardcoded 7 AM delivery). The `DigestService` cron checks each user's configured hour and sends at the right time.
- **Section toggles** — checkboxes to include or exclude each section independently:
  - Overdue Tasks
  - Upcoming Deadlines
  - Meeting Action Items
  - Upcoming Meetings
  - Sprint Status
  - Recent Changes
  - Unread Notifications

The digest email template uses **color-coded sections** for quick scanning: red (overdue tasks), amber (upcoming deadlines), purple (meeting action items), blue (upcoming meetings), green (sprint status), cyan (recent activity).

Preferences are stored in the database (`users.email_notifications_enabled`, `users.digest_frequency`, `users.digest_last_sent_at`, `users.notification_type_preferences`) and managed via `PUT /api/v1/users/me/notification-preferences`.

#### Per-Category Notification Preferences

Users can control which categories of notifications they receive, with independent toggles for in-app, email, and Slack delivery:

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

When a category's in-app toggle is off, notifications of that type are not inserted into the database or broadcast via WebSocket. When the email toggle is off, emails are suppressed even for critical/high severity. When the Slack toggle is off, `SlackEventDispatcher` skips forwarding for that category without affecting in-app or email delivery. System alerts are never suppressed for admin users. New users (NULL preferences) default to all categories ON for in-app, email, and Slack.

### Scheduled Report Delivery

Report templates from the Report Builder can be scheduled for automatic email delivery. Configuration is stored in the `report_schedules` table with:

- **Frequency**: daily, weekly (pick day of week), or monthly (pick day of month)
- **Time of day**: configurable delivery time
- **Recipients**: comma-separated email list
- **Format**: CSV attachment via Resend

The `ReportScheduleService` executes due schedules every 15 minutes via cron. Each execution generates the report, exports to CSV, and emails to all recipients. API endpoints at `/api/v1/report-schedules` provide full CRUD. The schedule modal is accessible via the clock icon on each report template card in the Report Builder.

### Scheduled Reports — Reports Page

The **Reports page** exposes a first-class **Scheduled Reports** section between the Favorites row and the Report Categories. It lists all schedules the current user has created in a table with columns: Report, Project, Frequency, Next Run, Status, and Actions.

**Actions per row:**
- **Edit** — opens `ReportScheduleModal` pre-populated with the existing schedule (by ID)
- **Pause / Resume** — toggles the schedule's active/paused state
- **Run Now** — calls `POST /api/v1/report-schedules/:id/run-now`, which triggers `ReportScheduleService.executeOne(id)` immediately regardless of the Next Run time; delivers the report to all recipients
- **Delete** — removes the schedule after confirmation

**Creating a schedule** — the **Schedule Report** button (top-right of the section) opens `ReportScheduleModal` with a project selector dropdown, allowing the user to pick any project they have access to. When opened from a specific report tile the project is pre-filled from the page's project selector.

**ReportScheduleModal enhancements:**
- Project selector dropdown when invoked from the Reports page (not locked to a template context)
- Supports edit mode by schedule ID: fields are pre-populated and the save path calls PATCH instead of POST

### Admin Schedules Page (`/admin/schedules`)

Admins can access all schedules across all users via the **Admin > Schedules** page.

- **Table columns**: Creator, Report, Project, Frequency, Next Run, Last Run, Status
- **Status filter**: All / Active / Paused / Error dropdown
- **Pause / Resume** action available inline per row
- **Backend**: `GET /api/v1/report-schedules/admin/all` calls `ReportScheduleService.listAll()` → `ReportScheduleRepository.findAll()` (no tenant scoping — returns all rows)

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

#### Template Picker (Onboarding)

The onboarding wizard's Step 2 presents a **methodology-aware template picker**. Templates are sorted by relevance to the user's chosen methodology (from Step 1) but are never filtered out — all templates (up to 6) remain visible so users always have choices. The **Hybrid** methodology matches all templates. Users can pick any template or skip this step entirely.

#### Built-In Templates

The system ships with **14 built-in templates** (up from 10). The 4 new additions are:

| Template | Category | Duration | Description |
|----------|----------|----------|-------------|
| **Agile/Scrum Sprint Project** | IT | 90 days | 4 sprints with standard Scrum ceremonies (planning, daily standup, review, retro) |
| **Marketing Campaign** | Marketing | 60 days | Campaign planning, creative production, launch, and post-campaign analysis phases |
| **Product Launch** | Marketing | 120 days | Market research through GA launch with go-to-market and enablement phases |
| **Office Relocation** | Operations | 90 days | Site selection, fit-out, move logistics, and post-move stabilization |

Two new template categories have been added to the picker: **Marketing** and **Operations**.

#### Template Marketplace

The New Project wizard includes a **Marketplace** tab alongside the standard template library. The marketplace allows organizations to discover and share templates:

- **Browse community templates** — templates published by other organizations, shown with download count
- **Import a marketplace template** — clones the template into your organization's library; creates an independent copy that you can customize without affecting the original
- **Publish your own template** — share a custom template with the community via `POST /api/v1/templates/:id/publish`

**Marketplace API endpoints:**

| Method | Endpoint | Description |
|--------|----------|-------------|
| `GET` | `/api/v1/templates/marketplace` | List all community-shared templates with download counts |
| `POST` | `/api/v1/templates/:id/publish` | Publish one of your org's templates to the marketplace |
| `POST` | `/api/v1/templates/marketplace/:id/import` | Import a marketplace template into your org |

---

## 19. Integrations

### Supported Providers

| Provider | Adapter | Capabilities |
|----------|---------|-------------|
| **Jira** | `JiraAdapter` | Bi-directional task sync, status mapping |
| **GitHub** | `GitHubAdapter` | Issue sync, PR status tracking |
| **Slack** | `SlackAdapter` | Event notifications, per-project channel routing, project selector, event filter checkboxes, `/kovarti status` slash command, interactive proposal buttons, POST /slack/send API |
| **Trello** | `TrelloAdapter` | Card sync, board mapping |

### Slack Integration

The Slack integration provides four capabilities:

1. **Event Notifications** — Automatic Slack messages when key events occur. `NotificationService` forwards notifications to Slack via `SlackEventDispatcher` as a fire-and-forget side-effect (never blocks the main request). Notifications are scoped to the project where the event originated; global notifications do not dispatch to Slack. Supported event types with dedicated Block Kit builders:
   - `task_completed` — task name, assignee, schedule
   - `task_assigned` — assignee, due date, project
   - `deadline_approaching` — task name, days remaining, priority badge
   - `budget_alert` — spent vs. budget, burn rate, variance
   - `meeting_followup` — summary, action items, decisions
   - `member_added` — new member name and role
   - `risk_created`, `sprint_started`, `sprint_completed`, `standup_submitted`, `project_status_changed`, `agent_proposal_created` — generic notification fallback (title + body + link button)

2. **Slash Command** (`/kovarti status <project name>`) — Returns an ephemeral Block Kit message with the project's status, priority, methodology, and dates.

3. **Interactive Buttons** — Agent proposals sent to Slack include Approve/Reject buttons. Clicking them records a review with the Slack username in the audit trail.

4. **POST /slack/send** — Internal API endpoint (`POST /api/v1/slack/send`) that sends a free-form message to all Slack channels configured for a given project. Accepts `{ projectId, text, blocks? }`. Used by agents and workflows to push ad-hoc messages.

**Configuration (IntegrationConfigModal):**
- Set `SLACK_SIGNING_SECRET` and `SLACK_BOT_TOKEN` environment variables.
- Create a Slack integration per project. The configuration modal includes:
  - **Project selector** dropdown — choose which project the integration is scoped to.
  - **Webhook URL** — incoming webhook for the target Slack channel.
  - **Event filter checkboxes** — select which of the 11 event types send notifications. Unchecked events are silently suppressed at the dispatcher level.

**User Notification Preferences:**
Each notification category now has three independent toggles — **In-App**, **Email**, and **Slack**. The Slack toggle controls whether that category's events are forwarded to the project's Slack channels. The Slack column appears in the Settings → Notifications table alongside In-App and Email. When the Slack toggle for a category is off, `SlackEventDispatcher` skips dispatch for that notification type without affecting in-app or email delivery.

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

Fourteen user roles with hierarchical scope-based permissions. The `write` scope allows creating, editing, and deleting project-level entities (tasks, schedules, resources, etc.). The `admin` scope is reserved for system-level operations (kill switches, agent policies, feedback management).

| Role | Scopes | Description |
|------|--------|-------------|
| `admin` | read, write, admin | Full system access |
| `executive` | read | Portfolio oversight + approval authority |
| `project_manager` | read, write | Full project lifecycle management |
| `scrum_master` | read, write | Sprint and task management |
| `team_member` | read | Task work + time logging |
| `finance_officer` | read | Budget and financial visibility |
| `risk_manager` | read, write | Risk and issue management |
| `pmo` | read, write | PMO oversight (bypasses project membership) |
| `ba` | read, write | Business analysis and requirements |
| `qa` | read, write | Quality assurance and testing |
| `tester` | read | Test execution and reporting |
| `devops` | read, write | CI/CD and infrastructure |
| `claude_sme` | read | AI subject-matter expert |
| `viewer` | read | Read-only access |

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

- **Per-tier defaults**: Trial — 25,000 tokens/mo; Consultant Basic — 0 (no AI); Consultant Pro — 500,000; SME — 1,500,000; Enterprise — 5,000,000. Configurable via `AI_TIER_BUDGET_TRIAL`, `AI_TIER_BUDGET_CONSULTANT_PRO`, `AI_TIER_BUDGET_SME`, `AI_TIER_BUDGET_ENTERPRISE` env vars.
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
| `send-slack-message` | Send a message to all Slack channels configured for a project |
| `test-slack-connection` | Verify that the Slack webhook for a project is reachable |
| `list-slack-channels` | List all Slack channel configurations registered for a project |

### MCP Proxy

The main application also exposes an `/mcp` reverse proxy route for HTTP-based MCP transport, allowing browser-based Claude integrations to connect through the production domain.

---

## 22. Billing

### Stripe Integration

The `StripeService` manages subscription billing:

- **Customer creation**: linked to user accounts
- **Multi-tier checkout**: Consultant Basic ($19/mo or $190/yr), Consultant Pro ($29/mo or $290/yr), SME ($39/mo or $390/yr), Enterprise ($79/mo or $790/yr). Price IDs configured via `STRIPE_CONSULTANT_BASIC_MONTHLY_PRICE_ID`, `STRIPE_CONSULTANT_PRO_MONTHLY_PRICE_ID`, `STRIPE_SME_MONTHLY_PRICE_ID`, `STRIPE_ENTERPRISE_MONTHLY_PRICE_ID` (and annual variants).
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

- **Plan name**: dynamically resolved from the user's actual subscription tier — never hardcoded. Trial tier shows "Trial Plan", paid tiers show "Consultant Basic Plan", "Consultant Pro Plan", "SME Plan", or "Enterprise Plan" accordingly.
- **Top-up balance**: remaining purchased token balance with a **Buy More** button linking to the token top-up Stripe checkout.
- **AI usage meter**: progress bar showing current-month token consumption vs the effective budget (tier allowance + top-up balance), color-coded green/amber/red.

### Viewer Invite Flow

Paid subscribers (Consultant, SME, and Enterprise tiers) can invite external client stakeholders as **viewer accounts** — free, read-only users who do not consume a paid seat.

**Invite limits by tier:**

| Tier | Viewer Invites |
|------|---------------|
| Trial | 0 (not available) |
| Consultant Basic | 5 |
| Consultant Pro | 5 |
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
5. The invitee clicks the link and sees the registration page with messaging that says **"You've been invited to join this organization"** (not "invited as a viewer"). They complete registration (password only — no billing) and land on a read-only project view.
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

### Trial Abuse Prevention

When a user deletes their account (via `DELETE /api/v1/auth/delete-account`), their email address is recorded in the `deleted_emails` table. If the same email is used to register again, the system skips the 14-day free trial — the new account is created with `subscriptionStatus: 'none'` and the user must select a paid plan to access features. This prevents users from repeatedly deleting and re-registering to obtain unlimited free trials.

- **Table**: `deleted_emails` (control plane DB) — stores `email` and `deleted_at` timestamp
- **Registration check**: case-insensitive email lookup against `deleted_emails` before granting trial
- **Migration**: `079_deleted_emails.sql`

### Signup Flow — Pricing First

All entry points route users through plan selection before registration:

- **Landing page hero** — "Get Started" button anchor-scrolls to the pricing section on the same page (no page navigation)
- **Landing page nav** — both "Pricing" and "Get Started" anchor-scroll to `#pricing`
- **Login page** — "Sign up" link routes to `/pricing`

From the pricing cards, users choose their plan:

- **"Start Free Trial"** on the Trial card links to `/register` for standard registration with a 14-day trial
- **"Subscribe"** on paid plan cards links to `/register?tier=<tier>&billing=<billing>`, which creates the account and redirects to Stripe checkout

The `/register` page remains directly accessible for invite links and direct URL access.

**Registration form guards:** The submit button is disabled until both conditions are met: the user has accepted the Terms of Service checkbox, and the password and confirm-password fields match. This prevents accidental form submission with mismatched credentials.

### Pricing Page

The Pricing page (`/pricing`) presents the Free Trial tier and three paid tiers (Consultant Basic, Consultant Pro, SME) with monthly/annual billing toggle and a 17%-save badge on annual plans. Each plan card shows:

- Price and billing period
- AI token allowance with **practical usage equivalents** (e.g., "~100 AI chats, 50 risk scans, or 25 reports/mo") so users understand what their token budget means in real terms
- Feature list with checkmarks
- Start Free Trial / Subscribe / Switch Plan / Current Plan button (context-aware based on auth state and current tier)

Below the plan cards, a **Feature Comparison Matrix** provides a side-by-side table across all 5 tiers (Trial, Consultant Basic, Consultant Pro, SME, Enterprise). Features are marked with checkmarks (included), X marks (excluded), or text values (e.g., "3", "1GB", "Unlimited"). The table covers projects, AI tokens, exports, API access, EVM, Monte Carlo, resource management, workflows, portal, intelligence features, meeting tools, MCP, storage, and top-ups.

| Feature | Trial | Consultant Basic | Consultant Pro | SME | Enterprise |
|---------|-------|-----------------|----------------|-----|------------|
| Projects | 3 | Unlimited | Unlimited | Unlimited | Unlimited |
| AI Tokens/mo | 25K | None | 500K | 1.5M | 5M |
| Storage | 100MB | 1GB | 1GB | 5GB | 10GB |
| Viewer Invites | 0 | 5 | 5 | 20 | Unlimited |
| Exports | ✗ | ✓ | ✓ | ✓ | ✓ |
| API Keys | ✗ | ✓ | ✓ | ✓ | ✓ |
| EVM | ✗ | ✓ | ✓ | ✓ | ✓ |
| Monte Carlo | ✗ | ✗ | ✓ | ✓ | ✓ |
| Auto-Reschedule | ✗ | ✗ | ✓ | ✓ | ✓ |
| Resource Management | ✗ | ✓ | ✓ | ✓ | ✓ |
| Custom Reports | ✗ | ✓ | ✓ | ✓ | ✓ |
| DAG Workflows | ✗ | ✓ | ✓ | ✓ | ✓ |
| Portal Management | ✗ | ✓ | ✓ | ✓ | ✓ |
| Meeting Intelligence | ✗ | ✗ | ✓ | ✓ | ✓ |
| NL Query | ✗ | ✗ | ✓ | ✓ | ✓ |
| Cross-Project Intelligence | ✗ | ✗ | ✓ | ✓ | ✓ |
| Token Top-Ups | ✗ | ✗ | ✓ | ✓ | ✓ |
| Price (monthly) | Free | $19/mo | $29/mo | $39/mo | $79/mo |
| Price (annual) | Free | $190/yr | $290/yr | $390/yr | $790/yr |

A **Token Top-Up CTA** below the comparison table lets users purchase additional token packs ($5 per 500K).

**Checkout Error Display:** When a Stripe Checkout session fails to initialize (network error, invalid price ID, Stripe API error), the Pricing page displays an **inline error banner** in a styled red alert box.

### Feature Gating

Trial users have access to core project management features only. The following features are restricted to paid tiers (Consultant Basic, Consultant Pro, SME, Enterprise), with AI features additionally requiring Consultant Pro or higher:

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

### Launch Offer

#### Overview

Kovarti offers a limited-time launch promotion for early subscribers:

- **20% discount** on the annual Consultant Pro plan (first year only)
- **Founders badge** granted to early Pro annual subscribers — displayed on the user avatar and billing page
- **30-day prorated refund guarantee** on annual plans

#### How It Works

- The launch offer is controlled by two environment variables: `LAUNCH_OFFER_ENABLED` (boolean) and `STRIPE_LAUNCH_COUPON_ID` (Stripe coupon ID)
- When enabled, the 20% discount is automatically applied at Stripe checkout for Consultant Pro annual subscriptions
- The discount uses a Stripe Coupon with `duration: once` (first invoice only) and an optional `redeem_by` expiry date
- Founders badge is granted automatically when a Pro annual subscription is created during the launch period
- Pricing pages show strikethrough original price, discounted price with "20% OFF" badge, and savings amount

#### Founders Badge

- Displayed as a gold star icon on the user's avatar in the TopBar
- Shown as an amber "Founder" badge on the Account & Billing page
- Revoked automatically if the user requests a refund (via Stripe `charge.refunded` webhook)
- Stored as `is_founder` boolean and `founder_at` timestamp on the users table

#### Refund Policy

- Annual plan subscribers can request a prorated refund within 30 days
- Refunds are processed manually via the Stripe dashboard
- The `charge.refunded` webhook automatically:
  - Increments the user's `refund_count`
  - Revokes the Founders badge (`is_founder = false`)
  - Logs a `refund_processed` subscription event
  - Flags abuse if `refund_count > 1` via the audit ledger

#### Configuration

| Variable | Description | Default |
|----------|-------------|---------|
| `LAUNCH_OFFER_ENABLED` | Enable/disable the launch offer | `false` |
| `STRIPE_LAUNCH_COUPON_ID` | Stripe coupon ID for the discount | (empty) |

#### Pricing Display

- All prices shown in USD
- "Try free for 14 days. Upgrade anytime." subtitle on all pricing pages
- "30-day prorated refund guarantee on annual plans" shown with shield icon
- Pricing cards use dark styling on landing pages for visual consistency

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
| **Change Requests** | Status summary showing pending, approved, and rejected counts with colored badges. Top 5 pending CRs with project name and days waiting. Link to drill down into the full change request view. (default: off, enable via Customize dropdown) |

#### Widget Sizes

Each widget supports three layout sizes, selectable per-widget:

| Size | Grid columns | How to set |
|------|-------------|-----------|
| **Full width** | 12 (spans the full row) | Default for most widgets |
| **Half width** | 6 (2-column layout) | Click the resize handle on the widget, or use the **F/H/T** size buttons in the Customize dropdown next to the widget checkbox |
| **Third width** | 4 (3-column layout) | Same resize handle or size buttons |

A **resize handle** appears on each widget when hovered — clicking it cycles through Full → Half → Third → Full. Size preferences are persisted alongside enabled/order preferences via `GET/PUT /api/v1/users/me/dashboard-preferences`. **Reset Layout** in the Customize dropdown resets all widget sizes to their defaults in addition to restoring default order.

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

On mobile, the project Schedule tab renders a dedicated mobile experience with a **view switcher** offering three modes. The mobile view initializes from the desktop view mode — if you selected Kanban or Calendar on desktop, the mobile view starts with that mode. All other desktop modes (Gantt, Table, Network, Burndown) map to List on mobile.

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
- **Project Detail Page** — Action buttons condense on mobile (Save as Template button hidden on small screens); tab navigation changes from `flex-wrap` to `overflow-x-auto` horizontal scroll with `min-w-max` tab items.
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

Health badges appear in the Table view Predecessor column, the Gantt left panel Pred column, and Gantt bar tooltips. Dependency arrows on the Gantt chart are drawn for each predecessor and colour-coded by health status (green, yellow, or red). Hovering over any dependency arrow shows a native tooltip with the predecessor name, successor name, dependency type, and lag days (e.g., "Design → Build (FS, 2d lag)").

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

### Dependency Removal

Two operations are available for removing dependencies:

- **Remove a single dependency** — `DELETE /api/v1/schedules/:scheduleId/tasks/:taskId/dependencies/:predecessorId` removes one predecessor link from a task. Available via MCP tool `remove-dependency` and AI agent tool `remove_dependency`.
- **Clear all dependencies in a schedule** — `DELETE /api/v1/schedules/:scheduleId/dependencies` bulk-removes every predecessor-successor link in the schedule. Available via MCP tool `clear-all-dependencies` and AI agent tool `clear_all_dependencies`. This is classified as a destructive operation and requires manager-level project access.

Both operations also clear the legacy denormalized columns (`dependency`, `dependency_type`, `dependency_lag_days`) on affected tasks and broadcast WebSocket events for real-time UI updates.

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
- **Phase/Group as summary tasks** — if a Phase, Group, Category, WBS, or Section column is detected, the import creates summary (parent) tasks for each unique phase value and nests child tasks underneath them.
- **Resource auto-creation** — after tasks are imported, unique assignee names are checked against existing resources. New resources are created automatically with default settings (40 hrs/week, no role/department). The import response includes a `resourcesCreated` count, shown in the UI as "X resources added."

**Notes column** — both Table view and Gantt chart support a **Notes** column (hidden by default, toggle via column picker). The column maps to the task's `description` field. Clicking any Notes cell opens a floating popup editor with a full textarea, Save and Cancel buttons, and auto-save on click-away. Press Escape to dismiss without saving.

---

## 31. Gantt PDF/Image Export

The schedule toolbar provides an **Export** dropdown (replaces the previous Print/CSV buttons) with four export options. All export modes temporarily expand the Gantt to capture full content before reverting.

| Option | Mechanism | Output |
|--------|-----------|--------|
| **PDF** | `html2pdf.js` client-side rendering | A3 landscape, auto-scaled to fit Gantt content |
| **PNG** | `html-to-image` library, 2x pixel ratio | High-quality PNG image of the full Gantt |
| **Print** | `window.print()` with print-optimised CSS | Browser print dialog (same as before) |
| **CSV** | Task data serialization | CSV file of current task list (same as before) |

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
- The legend also includes a **priority section** (separated by a divider) showing coloured dots for Urgent (red), High (orange), Medium (yellow), and Low (green) — matching the inline priority dots on task rows.

Detection is entirely client-side (no server API required). Toggle the button off to hide all overallocation highlights.

---

## 35. Gantt Minimap

A **200×80px overview panel** in the bottom-right corner of the Gantt timeline provides a bird's-eye view of the entire schedule. Toggle it with the **"Minimap"** button (map icon) in the toolbar. The minimap is enabled by default.

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

The **ReadingLevelBadge** is displayed next to the "Project Brief" heading in the project overview. It computes readability client-side (no API call) from the saved description text (minimum 20 characters). The badge shows the reading level (Easy/Moderate/Advanced) with a tooltip showing the Flesch score and grade.

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
| **Step 1 — Profile** | Full name, role selector (dropdown: project_manager, team_member, executive, etc.), and preferred methodology (waterfall/agile/hybrid). Role is persisted to the backend only during onboarding (when `fullName` is null), preventing accidental role changes later. The "Other" role option displays "You can change this in Settings" to reassure users. |
| **Step 2 — Template Picker** | Template selection step where the user picks a methodology-matched template or skips. Templates are sorted by relevance to the chosen methodology — all templates remain visible (up to 6) rather than filtered, so the user always sees options. Hybrid methodology matches all templates. |
| **Step 3 — Done** | Completion screen with navigation links to Dashboard, Projects, and Mjuzi AI Chat. |

All three steps are fully reachable. A previous redirect bug that sent users away from the wizard after Step 1 (before Steps 2 and 3 could be shown) has been fixed.

After creating a project in Step 2, the user is taken to the project's **Overview** tab (not the Gantt chart), which is the appropriate starting point for a brand-new project.

First-login detection uses `sessionStorage` (set once per browser session after registration). Completing or dismissing the wizard persists a flag in `localStorage` so it does not reappear on subsequent logins.

The `apiService.updateProfile()` call in Step 1 accepts an optional `role` parameter, which is applied by the backend only when the user's `fullName` is currently null (i.e., this is their first profile save).

**Abandoned checkout banner:** If a user selects a paid plan, gets redirected to Stripe, and abandons the checkout without completing payment, the onboarding page detects the incomplete checkout state and shows a dismissible banner explaining that the checkout was not completed, with a link to the Pricing page to try again. The banner is cleared automatically on a successful Stripe return or after the user completes Step 1 of onboarding.

Component: `src/client/src/components/onboarding/WelcomeModal.tsx`

### Project Detail Tabs

The project detail page shows **6 primary tabs** plus a single **More** overflow menu. The visible primary tabs depend on the project methodology:

| Methodology | Primary tabs (left → right) |
|-------------|----------------------------|
| **Waterfall** | Overview, Schedule, Team, Risks & Issues, Financials, Changes |
| **Agile** | Overview, Sprints, Backlog, Schedule, Risks & Issues, Team |
| **Hybrid** | Overview, Schedule, Sprints, Backlog, Risks & Issues, Team |

**More overflow (all methodologies):** Time, Files, Performance, AI Insights, Resources, Agent Activity, plus any methodology-specific tabs not shown as primary.

The RAID log tab is labelled **Risks & Issues** in the tab bar. Its badge shows the **critical-item count only** (not total open items).

### Project Readiness Bar

A methodology-aware progress bar displayed above the tabs on the project detail page. It guides new project setup with data-driven steps that vary by methodology:

| Waterfall | Agile | Hybrid |
|-----------|-------|--------|
| Tasks | Backlog | Tasks |
| Predecessors | Sprint | Sprint |
| Resources | Team | Resources |
| | | Predecessors |

All steps are data-driven and auto-detect completion (tasks exist, predecessor links exist, resources assigned, sprints created). The bar can be dismissed per project.

Component: `src/client/src/components/onboarding/ProjectReadinessBar.tsx`
Step configurations: `src/client/src/utils/methodology.ts`

### Empty-State CTA

When a user has **zero projects**, the Projects Table on the dashboard renders a "New Project" button in place of the empty table body. Clicking it links to `/projects`, where the project creation flow can be started. This replaces the blank table that previously appeared for new accounts.

When a project has **zero schedules**, the Schedule tab shows two options: a primary **Create Schedule** button (creates a blank schedule named "{Project} Schedule" with a 1-year date range, ready for manual task entry) and a secondary **Upload Schedule** button (import from .xlsx or .csv file). The create button uses the project's start date if available, otherwise defaults to today.

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

The **Risks & Issues** tab header (formerly labelled RAID) shows a count badge with the number of **critical-severity open items** only — not the total count of all open items. Surfacing only the critical count keeps the badge meaningful and avoids alert fatigue when a project has many low-severity items open.

### Slide-Out Detail Panel

Clicking any row in the RAID log opens a slide-out panel from the right side of the screen. The panel shows:

- Full record header (ID, type badge, status pill, severity chip)
- All type-specific fields (editable inline for permitted roles)
- **Updates** — a dedicated section for team communication. Users with editor access can post updates and delete their own updates. Each update shows the author name, relative timestamp, and text.
- **Activity** — a pure audit trail showing every state change, with actor name, timestamp, and change description. Comments are no longer mixed with audit entries.

### Updates vs Activity

RAID records have two distinct sections:

**Updates** (`raid_updates` table) — User narratives and team communication. Posted via the input box at the bottom of the detail panel. Each update is attributed to its author and can be deleted by the author. Adding or deleting an update creates an audit entry (`update_added` / `update_deleted`) in the activity log.

**Activity** (audit trail) — A read-only chronological log of every system-generated event:

- Status transitions (e.g., `open → in_progress`, `decided → reversed`)
- Field edits (title, description, owner, due date, rationale, etc.)
- Cancel and reverse actions (with the mandatory reason recorded)
- Update added / Update deleted audit entries
- AI Scan findings imported as new records
- Agent writes via `importFromAgent` or `importFromAIScan`

Legacy comments (created before the Updates feature) remain in the activity log for backward compatibility but are hidden from the activity display.

### AI Agent Partnership

The RAID log integrates with the platform's AI agent layer in two ways:

**AI Scan** — A project-scoped scan that reads the current schedule, task statuses, overdue items, and budget data to surface new risks and issues. Results are presented as a preview; the user selects which findings to import. Imported records are tagged with `source: ai_scan`.

**Agent writes** — Background agents (e.g., the Risk Agent, Budget Agent) can write directly to the RAID log using the `importFromAgent` pathway. These records are tagged with `source: agent` and appear in the log alongside manually created entries. Agent-written records go through the same activity logging as manual records.

**Suggest with AI** — When editing a risk, the form offers "Suggest with AI" buttons on three fields:
- **Mitigation Plan** — AI suggests preventive strategies based on historical lessons learned and RAG-based similarity search
- **Trigger Condition** — AI suggests early warning signs and leading indicators to monitor
- **Response Plan** — AI suggests contingency actions, escalation paths, and recovery steps

All three use the same `POST /:projectId/risks/:riskId/suggest-mitigation?field=mitigation|trigger|response` endpoint, which queries the lessons-learned knowledge base via RAG (or deterministic fallback) and generates suggestions using Claude. The `suggest-mitigation` MCP tool also uses this pathway.

### RAID Notifications

RAID items generate in-app notifications to keep the team informed without requiring manual follow-up:

| Event | Recipients |
|-------|-----------|
| Owner assigned/reassigned | New owner |
| Status changed | Owner + project managers (excluding changer) |
| Update posted | Owner + project managers (excluding poster) |
| Severity escalated to high/critical | Project managers |
| New item created (triage) | Project managers |

All notifications link directly to the RAID item. The poster/changer is excluded from their own notifications to avoid noise.

### RAID Report

A data-driven (no AI) RAID report that provides a comprehensive snapshot of all open RAID items with filtering, preview, download, email delivery, and recurring schedule support. The report follows the same preview/download/email/schedule pattern as the AI Status Report but does not consume AI tokens — all content is generated directly from project data.

**How to access:** Navigate to the **RAID** tab on any project, then click the **RAID Report** button in the toolbar.

**Report Filters:**
- **Type** — Checkboxes for Risk, Issue, Action, and Decision. Select one or more to include in the report.
- **Severity** — Filter by critical, high, medium, and/or low severity levels.
- **Owner** — Dropdown to filter items by a specific owner.

Click **Generate Report** to produce the report with the selected filters applied.

**Report Sections:**
1. **Summary Dashboard** — Four cards showing the count of open items by type (Risks, Issues, Actions, Decisions), each with a severity breakdown (critical / high / medium / low counts).
2. **All Items Table** — A full table of all RAID items matching the current filters, with columns for ID, Title, Type, Severity, Status, Owner, and Date.
3. **Overdue Actions** — A highlighted section listing all Action and Issue items past their due date or target resolution date, sorted by how overdue they are.
4. **Key Mitigations** — A section showing active mitigation plans for open risks, so stakeholders can see what preventive measures are in place.

**Actions:**
- **Download HTML** — Download the rendered report as a standalone `.html` file for offline viewing or attachment to emails and governance documents.
- **Email to recipients** — Enter comma-separated email addresses and send the report directly to stakeholders. The report is delivered as branded HTML email.
- **Schedule recurring** — Set up automatic RAID report delivery on a daily, weekly, or monthly cadence with configurable day/time and recipient list. Schedules are stored with a `raid-report::` prefix to distinguish them from status report schedules. View and delete existing schedules from this tab.

**API Endpoint:** `POST /api/v1/raid-reports/generate` — Generates the RAID report for a project with optional filters (types, severities, ownerId) and optional email recipients.

**Trial User Experience:** Trial users are not blocked with a 403. Instead, the endpoint returns a **sample RAID report** populated with realistic demo data (example risks, issues, actions, and decisions with varied severities and statuses). An amber upgrade banner appears above the report. The Email, Schedule, and Download actions are locked with a lock icon. No database queries against real project data are performed for the sample report. Paid tier users receive full reports generated from their actual RAID data.

**Feature Gating:** Full report generation requires a paid tier (consultant/sme/enterprise). Email delivery requires `RESEND_API_KEY`. Scheduling requires a paid tier.

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
- **PWA**: Service worker with offline caching, install prompts, push notifications. Auto-refresh on deploy: `skipWaiting` + `clientsClaim` activate the new service worker immediately; `onNeedRefresh` auto-reloads the page. Update checks run every 60 seconds, so users see new deployments within a minute without needing a hard refresh.
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
/api/v1/meetings             Meeting agenda & minutes management
/api/v1/meeting-action-items Meeting action item tracking
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
- **AI Usage Limits (Section 5A)** — highlighted section covering per-tier monthly token allowances (Trial: 25K, Consultant Basic: none, Consultant Pro: 500K, SME: 1.5M, Enterprise: 5M), budget exhaustion behavior (AI features blocked, non-AI features unaffected), token top-up terms (non-refundable, no expiry), no carry-over of unused monthly tokens, per-user overrides, and fair use policy.
- **Governing law** — disputes are governed by the laws of British Columbia, Canada.
- **Dispute resolution** — parties agree to attempt informal resolution before pursuing formal legal proceedings.

### Privacy Policy

The Privacy Policy (`/privacy`) has been updated to include:

- **Cookie consent banner** — Google Analytics 4 (GA4) is only loaded after the user explicitly consents via a cookie consent banner shown on first visit. If the user declines, no analytics cookies are set and no usage data is collected. Consent preference is stored in localStorage (`kovarti_analytics_consent`).
- **Google Analytics GA4 disclosure** — when consented, GA4 sets `_ga` (2-year expiry, identifies unique visitors) and `_ga_*` (session tracking). Users can revoke consent by clearing localStorage.
- **Waitlist data collection** — pre-launch waitlist collects email addresses only, stored securely, used solely for launch notification, and deleted within 30 days of launch. Removal by emailing the privacy officer.
- **International data transfer** — user data may be processed outside Canada by third-party service providers (e.g., Anthropic, Stripe, Resend, Google). Transfers are subject to standard contractual clauses or equivalent safeguards.
- **PIPEDA compliance** — the policy affirms compliance with Canada's Personal Information Protection and Electronic Documents Act (PIPEDA).
- **Google as a third-party processor** — Google is identified as a data processor for analytics purposes, governed by Google's own privacy and data processing terms.

The Terms of Service (`/terms`) governing law and jurisdiction is set to the Province of Ontario, Canada.

---

## Public Roadmap Page

The product roadmap is available at `/roadmap` — a public page accessible without login. It shows planned features organized by quarter in a visual timeline layout with status badges (Shipped, In Progress, Planned). The page uses the same `PublicNavbar` and `PublicFooter` as the Terms, Privacy, and Guide pages. A "Roadmap" link appears in both the public navbar and footer. The internal roadmap document is maintained in `ROADMAP.md` at the repository root.

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
| **Tier** | Subscription tier badge: Trial (gray), Consultant Basic (blue), Consultant Pro (indigo), SME (green), Enterprise (amber) |
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

## 51. Resource Management Enhancements

Nine enhancements to the resource management system, shipping together as a cohesive upgrade to workforce planning. Two foundational features (Cost Rollup and Assignment Conflict Detection) are documented in Section 4; the remaining seven are detailed below.

### Skill Proficiency Levels

Skills on resources now carry a numeric proficiency level from 1 to 5:

| Level | Label |
|-------|-------|
| 1 | Junior |
| 2 | Intermediate |
| 3 | Mid |
| 4 | Senior |
| 5 | Expert |

Backward compatible: existing plain-string skill tags are treated as level 3 (Mid). Skills are stored as `{ name: string, level: number }` objects. The skill-match finder (`find-skill-match`) uses proficiency levels when ranking candidates.

### Cross-Project Workload

A new org-wide workload endpoint aggregates task assignments across **all** projects rather than a single project:

```
GET /api/v1/resources/workload
```

No `projectId` parameter is required. The response follows the same shape as the per-project workload endpoint, grouped by resource, with weekly demand, capacity, utilization, and over-allocation flags calculated across every project the resource is assigned to. Useful for staffing decisions and preventing hidden cross-project over-allocation.

### Departments

Resources can be assigned to a department:

- Engineering, Design, QA, Management, Operations, Marketing, Sales, Support, and custom departments.
- Department is stored on the resource record (`resource_group` column).
- The Team tab on the Resource Management page (`/resources`) includes a **Department** filter dropdown so managers can view a single department at a time.
- The `GET /api/v1/resources` endpoint supports a `?group=` query parameter for server-side filtering.

### Utilization Dashboard

A historical utilization trends panel on the Resource Management page displays a 12-week SVG line chart with three series:

| Series | Description |
|--------|-------------|
| **Planned** | Hours assigned to tasks (scheduled) |
| **Actual** | Hours logged via time entries |
| **Capacity** | Resource capacity hours per week |

The chart allows managers to spot trends — e.g., consistently high actual vs. planned — and adjust upcoming allocations before over-runs occur.

### Gantt Quick-Assign

A toggleable **Resource** column in the Gantt chart table allows inline resource assignment without leaving the schedule view:

- Each task row shows resource chips (initials) for currently assigned resources.
- Hovering a chip reveals an "×" button to remove the assignment.
- A "+" button opens a searchable dropdown listing all available resources (filtered to exclude already-assigned ones).
- Selecting a resource creates a `task_assignment` record via the existing `onTaskUpdate` flow — no page reload required.

**Backend endpoint** (also used by MCP tools):

```
POST /api/v1/resources/quick-assign
Body: { taskId, resourceId, scheduleId }
```

The server derives assignment dates from the task's `startDate` and `endDate`, and defaults `hoursPerWeek` to the resource's `capacityHoursPerWeek`. An over-allocation warning is returned (advisory, non-blocking) if the new assignment exceeds capacity.

The Resource column is hidden by default and can be enabled via the Gantt column picker. The same Resource column and quick-assign interface is also available in **Table View** via its column picker.

### Calendar Templates

Customizable working schedules allow resources to follow non-standard work weeks. CRUD API:

| Method | Endpoint | Description |
|--------|----------|-------------|
| `GET` | `/api/v1/resources/calendar-templates` | List all templates |
| `POST` | `/api/v1/resources/calendar-templates` | Create a template |
| `PUT` | `/api/v1/resources/calendar-templates/:id` | Update a template |
| `DELETE` | `/api/v1/resources/calendar-templates/:id` | Delete a template |

Built-in presets include standard 5×8, compressed 4×10, and 6×6. Templates define working days and hours per day. When a resource is assigned a calendar template, all capacity and workload calculations use the template's effective weekly hours rather than the flat `capacityHoursPerWeek` default.

Calendar templates are managed from the **Calendar Templates** tab on the Resource Management page (`/resources`). The `CalendarTemplateManager` component provides full CRUD: create, edit (name, working days, hours/day, default flag), and delete with confirmation.

### Timesheet Integration

Resources can be linked to a user account via a `userId` field on the resource record. When linked:

- The workload heatmap and cross-project workload views display **actual hours** from that user's time entries alongside planned hours.
- The utilization dashboard's "Actual" series is populated from real time-log data rather than estimates.
- Actual vs. planned variance is surfaced per week, color-coded: green when actual ≤ planned, amber when 10–25% over, red when >25% over.

**API:** `PUT /api/v1/resources/:id` accepts `{ userId }` to link a resource to a user. The `GET /api/v1/resources/workload` and `GET /api/v1/resources/workload/:projectId` responses include `actualHours` per weekly entry when a userId link exists.

---

## 52. Resource Management Enhancements (Phase 2)

Six additional resource management features closing gaps identified in an audit against MS Project, Primavera, Smartsheet, and Monday.com.

### Actual vs Planned Overlay

Workload heatmap cells now display **actual/allocated hours** (e.g., "28/40h") with utilization percentage below. Hover tooltip shows full breakdown: allocated, actual, capacity, utilization %, and cost. Both the project-level heatmap (ResourcesTab) and the standalone WorkloadHeatmap component show this overlay. Legend updated to explain the cell format.

### Bulk Resource Import (CSV)

Import resources in bulk via a CSV file:

- **Endpoint:** `POST /api/v1/resources/import` — accepts `{ csv: string }` (raw CSV text, max 5MB, max 200 rows)
- **Expected columns:** name, role, email, capacityHoursPerWeek, skills (semicolon-separated), costRateHourly, resourceGroup
- **Returns:** `{ created: number, errors: [{ row, error }], total: number }`
- **UI:** "Import CSV" button on the Team sub-tab opens a modal with drag-and-drop file upload, preview table, and import results with error details

### Resource Profile Modal

Click any resource name (in Team table or Workload heatmap) to open a profile modal showing:

- Resource details (name, role, email, department, skills with proficiency)
- Summary cards (capacity, active assignments, utilization %, cost rate)
- Current assignments table with task names, hours/week, and date range
- Embedded utilization trend chart (reuses `UtilizationTrendChart`)
- **Endpoint:** `GET /api/v1/resources/:id/profile` — returns resource + assignments + summary

### Rate Types (Overtime)

Resources can now have an **overtime rate** in addition to the standard cost rate:

- **New column:** `overtime_rate_hourly` on `resources` table (migration 080)
- **New column:** `rate_type` ENUM('standard','overtime') on `time_entries` table (migration 080)
- **Cost calculation:** When time entries have `rate_type='overtime'`, those hours are costed at the overtime rate. Falls back to `costRateHourly * 1.5` if no overtime rate is set.
- **UI:** "OT Rate ($/hr)" field in the resource form and column in the resource table

### Capacity Planning by Role

A new **Role Capacity** sub-tab on the Resources page shows capacity vs demand aggregated by role:

- **Endpoint:** `GET /api/v1/resources/capacity-by-role` — groups resources by role, sums capacity and allocated hours per role per week (12-week window)
- **Color coding:** Green (surplus >20%), Yellow (tight 0-20%), Red (over-committed)
- Each cell shows allocated/capacity hours and surplus/deficit
- Useful for identifying which roles are bottlenecks vs overstaffed

### Effort-Driven Scheduling

Tasks can be marked as **effort-driven**, where duration is a function of work hours and assigned resources:

- **New columns:** `work_hours` DECIMAL and `effort_driven` TINYINT on `tasks` table (migration 081)
- **Logic:** When `effort_driven = true` and task assignments change, duration is recalculated: `duration = work_hours / (sum of resource hours per day)`
- Hours per day derived from each resource's `capacityHoursPerWeek / 5`, weighted by allocation percentage
- End date recalculated skipping weekends
- **UI:** "Work Hours" number input + "Effort Driven" checkbox in the task edit form (TaskFormModal)
- Recalculation triggers on `addAssignment()` and `removeAssignment()` in TaskAssignmentService

---

## 50. Cross-Device View Preferences

UI layout preferences are persisted server-side so they follow the user across devices and browsers. The following preferences are synced:

- **Theme** (light/dark)
- **Sidebar collapsed** state
- **AI panel open** state
- **Schedule view mode** (gantt/kanban/table/calendar/network/burndown)
- **Projects view mode** (card/table)

### How It Works

- On login, the app fetches `GET /api/v1/users/me/view-preferences` and applies the saved state.
- When the user changes any of these settings, the change is applied immediately (localStorage for instant feedback) and debounce-written to the server via `PUT /api/v1/users/me/view-preferences` (1-second debounce).
- Partial updates are merged with existing preferences — changing one setting does not reset others.
- If the server has no saved preferences (new user), localStorage defaults are used.
- Stored in the `view_preferences` JSON column on the `users` table (migration 076).

---

## 52. Table & Gantt UX Enhancements

### Arrow Key Navigation in Table View

The Table View supports spreadsheet-style keyboard navigation:

- **Arrow keys** move focus between cells. The focused cell is highlighted with a blue ring.
- **Enter** or **F2** enters edit mode on the focused cell. **Escape** clears the focus without editing.
- **Click-to-select then click-to-edit**: the first click on a row selects it; a second click on a cell of the already-selected row enters edit mode. This matches the Gantt chart behavior and allows selection-dependent actions (like Tab indent) before editing.
- **Cell-level Ctrl+C / Ctrl+V**: when a cell is focused, Ctrl+C copies its value to the clipboard and Ctrl+V pastes from the clipboard into the focused cell. Paste only applies when the field types match. A green flash confirms the paste.

### Copy/Paste Rows (Table View and Gantt Chart)

When no cell is focused, Ctrl+C / Ctrl+V operate at the task level in both Table View and Gantt Chart:

- **Ctrl+C** copies the currently selected or active task(s).
- **Ctrl+V** pastes them as new duplicate tasks. Each duplicate has `" (copy)"` appended to its task name. Other fields (dates, status, priority) are preserved from the original.
- **Ctrl+D** duplicates the selected or active task(s) in a single shortcut (equivalent to Ctrl+C then Ctrl+V). Works in both Table View and Gantt Chart.
- Implemented via the `onDuplicateTasks` prop on both view components.

### Resource Column in Table View

The **Resource** column — previously available only in the Gantt chart — is now available in the **Table View** column picker. It uses the same `ResourceQuickAssign` component:

- Each task row shows resource chips (initials) for assigned resources.
- Hover a chip to reveal a remove (×) button.
- Click **"+"** to open a searchable dropdown of available resources.
- Selecting a resource creates a `task_assignment` record instantly.

Toggle it on from the **Columns** picker in the Table View toolbar.

### Column Auto-Fit (Double-Click Resize Handle)

In both Table View and Gantt Chart, double-clicking a column's resize handle (the right border of any column header) auto-fits the column width to its content:

- Width is calculated by measuring the longest text value in the column using the HTML5 Canvas `measureText` API.
- The resulting width is capped at **400px** to prevent excessively wide columns.
- The auto-fit width is applied immediately and saved to localStorage alongside manually dragged widths.

### Gantt Task Name Visibility & Default Column Set

The Gantt left panel previously showed all 12 columns by default, which squeezed the flex-width Task Name column to near-zero pixels. This is fixed:

- **Default visible columns** are now 6 essentials: Pred, Start, End, Duration, %, Status (plus # and Task Name which are always shown). All other columns (Succ, Est Days, Work, Priority, Assigned) are hidden by default and can be toggled on via the column picker.
- **Task Name is now resizable** with a 250px default width (previously flex-only, so it was unresizable). Drag its right border to adjust; the width persists in localStorage per schedule.
- **Improved resize handles**: all column resize handles show a visible dot indicator for discoverability.
- **Horizontal scroll**: the left panel uses `overflow-x: auto` so toggling on additional columns does not crush the task name — columns extend horizontally and the panel scrolls.

### Successor Column (Succ)

A **Successor** column is available in both the Gantt left panel and the Table View:

- Displays which tasks depend on the current task (the inverse of Predecessor).
- Format matches the Predecessor column: row numbers with optional dependency type and lag (e.g. `5FS`, `3SS+2d`). Multiple successors are comma-separated.
- Hovering the cell shows a tooltip with the full successor task names.
- **Read-only** — derived automatically from the `task_dependencies` table; cannot be edited directly. Edit the successor task's Predecessor field to change the relationship.
- **Hidden by default** — toggle on via the Columns picker in the Gantt toolbar or Table View toolbar.
- Column visibility syncs between Gantt and Table views (both use the same per-schedule localStorage key).

---

## 54. Scrum Enhancements

A suite of agile/scrum features that bring task typing, acceptance criteria, epic grouping, expanded workflow statuses, burnup charting, and flow metrics to PM Assistant.

### Task Types

Every task can be assigned a type: **Story**, **Bug**, **Task**, or **Epic**. The type is selected via a dropdown in the Task Form modal. Color-coded type badges appear consistently across all views:

- **Gantt chart** — type badge next to the task name in the left panel
- **Sprint Board** — type badge on each card
- **Kanban Board** — type badge on each card
- **Backlog View** — type badge in each task row

Color coding: Story = blue, Bug = red, Task = grey, Epic = purple.

### Acceptance Criteria

Tasks support acceptance criteria using markdown checkbox syntax:

```
- [ ] User can log in with email and password
- [x] Error message shown for invalid credentials
- [ ] Session persists across page refresh
```

The Task Form modal includes a dedicated Acceptance Criteria text area. On Sprint Board cards, a completion count badge shows progress (e.g., "2/3" meaning 2 of 3 criteria met). Criteria are stored as part of the task record and rendered with the standard markdown parser.

### Epics

Epics group related stories and tasks into larger bodies of work. Any task with type **Epic** can serve as a parent grouping. Features:

- **Epic dropdown** in the Task Form modal — assign a task to an epic
- **Backlog View** — "Group by Epic" toggle organizes backlog tasks under their parent epic with collapsible headers showing epic name and progress rollup
- **Epic progress API** — `GET /api/v1/projects/:projectId/schedules/:scheduleId/epics` returns all epics with child task counts, completed counts, and percentage progress

Tasks not assigned to any epic appear under an "Unassigned" group when grouping is enabled.

### Custom Workflow Statuses

Tasks support 7 workflow statuses: **pending**, **in_progress**, **in_review**, **testing**, **completed**, **blocked**, and **cancelled**. Each status has a distinct color:

| Status | Color |
|--------|-------|
| pending | grey |
| in_progress | blue |
| in_review | amber |
| testing | purple |
| completed | green |
| blocked | red |
| cancelled | dark grey |

**Sprint Board** renders 5 columns: Pending, In Progress, In Review, Testing, and Completed. Tasks with **blocked** or **cancelled** status appear in their current column with a status badge overlay rather than a dedicated column. **Kanban Board** renders all 7 statuses as separate columns. Status colors are consistent across Gantt, Table, Sprint Board, Kanban Board, and Backlog views.

### Burnup Chart

The Sprint Burnup Chart visualizes sprint progress as two lines plotted over the sprint timebox:

- **Scope line** (blue) — total story points in the sprint over time, showing scope changes
- **Completed line** (green) — cumulative completed story points over time
- The area between the two lines represents **remaining work**

Accessible via the **"burnup"** tab in the Sprint view switcher. Summary stats tiles show Total Scope, Completed, Remaining, and Days Left.

### Flow Metrics

Flow metrics provide insight into team throughput and delivery predictability:

- **Lead Time** — elapsed time from task creation to completion (created → done)
- **Cycle Time** — elapsed time from work started to completion (started → done)
- **Statistics** — average and median values for both lead time and cycle time
- **Distribution histogram** — visual distribution of lead/cycle times across configurable buckets

Accessible via the **"metrics"** tab in the Sprint view switcher. The API endpoint `GET /api/v1/projects/:projectId/schedules/:scheduleId/flow-metrics` returns lead time and cycle time arrays with avg/median summaries for the specified sprint or schedule.

### Standup Logging

Daily standup entries capture what each team member did yesterday, what they plan to do today, and any blockers — all scoped to a sprint.

- **Per-user, per-sprint, per-day** — Each user submits one standup entry per day per sprint. Entries include three fields: Yesterday (what was accomplished), Today (what is planned), and Blockers (impediments).
- **Date navigation** — A date picker with previous/next day buttons lets users review past standups or submit for the current day.
- **Blocker management** — Blockers entered during standup are automatically created as RAID issues with `source: 'standup'`. This ensures impediments surface in the project's risk/issue tracking without manual re-entry.
- **Team view** — Below the submit form, a read-only team view shows all standup entries for the selected day across all team members, giving scrum masters and PMs a consolidated daily view.
- **Notifications** — When a team member submits a standup, project managers receive a `standup_submitted` notification.
- **API** — `POST /api/v1/sprints/:sprintId/standups` (create), `GET /api/v1/sprints/:sprintId/standups?date=YYYY-MM-DD` (list for date), `PUT /api/v1/sprints/:sprintId/standups/:id` (update), `DELETE /api/v1/sprints/:sprintId/standups/:id` (delete own entry).

Accessible via the **"standup"** tab in the Sprint view switcher.

### Retrospective Board

A structured retrospective board for sprint reflection with three categories, voting, and AI seeding.

- **Three-column layout** — Items are organized into Went Well (green), To Improve (amber), and Action Items (red). Each column is color-coded for quick visual scanning.
- **Add items inline** — Click the add button in any column to create a new retrospective item. Items are attributed to the creating user.
- **Delete own items** — Users can delete items they created. Items created by other users are read-only.
- **Voting** — Each user can cast one vote per item. Vote counts are displayed on each card. Click to vote; click again to unvote. This surfaces the team's priorities without lengthy discussion.
- **AI Seed** — The "AI Seed" button generates retrospective items from sprint data (completed tasks, velocity, blockers) using Claude. AI-generated items are marked with an "AI" badge so the team can distinguish them from human-authored items.
- **Convert to task** — Action items can be converted directly into backlog tasks, ensuring follow-through on improvement actions. The converted task is linked back to the sprint.
- **API** — `GET /api/v1/sprints/:sprintId/retro` (list items), `POST /api/v1/sprints/:sprintId/retro` (create item), `DELETE /api/v1/sprints/:sprintId/retro/:id` (delete own item), `POST /api/v1/sprints/:sprintId/retro/:id/vote` (vote), `DELETE /api/v1/sprints/:sprintId/retro/:id/vote` (unvote), `POST /api/v1/sprints/:sprintId/retro/seed` (AI seed), `POST /api/v1/sprints/:sprintId/retro/:id/convert` (convert to task).

Accessible via the **"retro"** tab in the Sprint view switcher.

### Definition of Ready / Done (DoR/DoD)

Project-level quality gate templates that define when a task is ready to start (DoR) and when it is truly done (DoD).

- **Project-level templates** — Managers define ordered lists of criteria for both Definition of Ready and Definition of Done at the project level. These templates apply to all tasks within the project.
- **Template editor** — The Definitions tab provides an editor with add, remove, and reorder controls for each criterion. Suggested default criteria are available as a starting point (e.g., "Acceptance criteria defined" for DoR, "Code reviewed" for DoD).
- **Per-task checklists** — When a task is created or when templates are first applied, checklist items are initialized from the project templates. Each task gets its own independent copy that can be checked off as work progresses.
- **Checkbox UI** — Task checklists appear in both the Sprint Board task form and the Gantt/Schedule task form modal (between Attachments and Activity panels) with checkboxes for tracking completion of each criterion.
- **DoR badge (Backlog)** — In the Backlog view, each task displays a readiness badge: a green checkmark if all DoR criteria are met, or an amber warning icon if any remain unchecked. This helps scrum masters quickly identify which stories are truly ready for sprint planning.
- **DoD badge (Sprint Board)** — On Sprint Board cards, a progress fraction badge (e.g., "3/5") shows how many DoD criteria have been completed, giving the team visibility into remaining work before a task can be considered done.
- **Bulk readiness API** — `GET /api/v1/sprints/definitions/:projectId/readiness?taskIds=...` returns readiness status for multiple tasks in a single call, enabling efficient badge rendering in list views.
- **Role restriction** — Only project managers and above can edit DoR/DoD templates. All team members can view and check off items on their tasks.
- **API** — `GET /api/v1/sprints/definitions/:projectId` (get templates), `PUT /api/v1/sprints/definitions/:projectId` (update templates), plus checklist CRUD endpoints for per-task checklists.

Accessible via the **"definitions"** tab in the Sprint view switcher.

### Database — Scrum Ceremonies

Migration `T021_scrum_ceremonies.sql` creates five tables:

| Table | Purpose |
|-------|---------|
| `standup_entries` | Daily standup submissions (yesterday, today, blockers, per user per sprint per date) |
| `retrospective_items` | Retro board items with category (went_well, to_improve, action_item), text, author, AI flag |
| `retrospective_votes` | One vote per user per retro item (unique constraint) |
| `scrum_definitions` | Project-level DoR/DoD templates (JSON arrays of ordered criteria) |
| `task_checklists` | Per-task checklist items initialized from DoR/DoD templates (type, label, checked status) |

The migration also expands the RAID `source` enum to include `'standup'`.

---

## 55. Project Grouping (Folders/Spaces)

Projects can be organized into flat groups (no nesting) for visual organization and filtering on the Projects page.

### Groups

- **Create, edit, delete, and reorder** groups via the "Manage Groups" modal accessible from the Projects page header
- Each group has a **name** and a **color** (displayed as a colored dot next to the group header)
- Groups are flat — there is no nesting or hierarchy
- Reorder groups to control display order on the Projects page

### Project Assignment

- Projects can be assigned to a group via the project form or inline on the Projects page
- A project belongs to zero or one group
- Unassigned projects appear outside of any group header

### Projects Page Integration

- When groups exist, the Projects page renders **collapsible group headers** with color dots
- Projects are listed under their assigned group; ungrouped projects appear in a default section
- A **Group filter dropdown** in the header allows filtering the project list to a single group
- Collapsing/expanding group sections is per-session

### Database

Migration `T022` adds:
- `project_groups` table — id, name, color, display_order, organization-scoped
- `group_id` column on the `projects` table (nullable FK to `project_groups`)

---

## 56. Resource Request/Approval Workflow

A formal workflow for requesting, approving, and fulfilling resource needs across projects.

### Creating a Resource Request

Resource requests capture:
- **Role** — the role being requested (e.g., Developer, QA Engineer)
- **Group** — optional resource group/department
- **Hours** — estimated hours needed
- **Dates** — requested start and end dates
- **Skills** — required skills for the resource
- **Priority** — low, medium, high, or urgent
- **Justification** — free text explaining why the resource is needed

### Status Lifecycle

`draft` → `pending` → `approved` | `rejected` → `fulfilled` | `cancelled`

- **Draft** — initial state, editable by the requester
- **Pending** — submitted for approval, awaiting manager review
- **Approved** — approved by a manager, ready to be fulfilled
- **Rejected** — rejected with a comment explaining the reason
- **Fulfilled** — an actual resource has been assigned to satisfy the request
- **Cancelled** — withdrawn by the requester or cancelled by a manager

### Approval Flow

- **Submit for approval** — moves the request from `draft` to `pending`
- **Approve** — manager approves with an optional comment
- **Reject** — manager rejects with a required comment
- **Fulfill** — assign a specific resource to satisfy an approved request

### Notifications

- **Email + in-app** notifications are sent to the requester when their request is approved or rejected
- Email includes the request details, action taken, and reviewer comment
- Notifications follow the fire-and-forget pattern and respect the user's email notification preferences

### UI

- **Requests tab** on the Resource Management page (`/resources`) — list of resource requests with status filters
- **Pending Approvals panel** for managers — shows requests awaiting their review with approve/reject actions
- Request form with fields for role, group, hours, dates, skills, priority, and justification

### Database

Migration `T023` adds the `resource_requests` table with columns for all request fields, status, requester, reviewer, fulfillment resource link, and timestamps.
