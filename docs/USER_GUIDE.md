# PM Assistant -- User Guide

A comprehensive guide for using PM Assistant, an AI-powered enterprise project management platform. This guide covers every feature from initial login through advanced analytics and automation.

---

## Table of Contents

1. [Getting Started](#1-getting-started)
2. [Projects](#2-projects)
3. [Schedules and Tasks](#3-schedules-and-tasks)
4. [Views](#4-views)
5. [Critical Path](#5-critical-path)
6. [Baselines](#6-baselines)
7. [Earned Value Management (EVM)](#7-earned-value-management-evm)
8. [Resources](#8-resources)
9. [Workflows](#9-workflows)
10. [Sprints](#10-sprints)
11. [Time Tracking](#11-time-tracking)
12. [Reports](#12-reports)
13. [Monte Carlo Simulation](#13-monte-carlo-simulation)
14. [AI Features](#14-ai-features)
15. [Templates](#15-templates)
16. [Integrations](#16-integrations)
17. [Intake Forms](#17-intake-forms)
18. [Portfolio](#18-portfolio)
19. [Intelligence and Scenarios](#19-intelligence-and-scenarios)
20. [Lessons Learned](#20-lessons-learned)
21. [Agent Proposals](#21-agent-proposals)
22. [Settings and Account](#22-settings-and-account)
23. [Dark Mode, Language, and Time Zone](#23-dark-mode-language-and-time-zone)
24. [Goals / OKR Tracking](#24-goals--okr-tracking)
25. [Bulk CSV / Excel / XML Import](#25-bulk-csv--excel--xml-import)
26. [Resource Management Page](#26-resource-management-page)
27. [EVM Dashboard Page](#27-evm-dashboard-page)
28. [Notifications Center Page](#28-notifications-center-page)
29. [Dashboard Widget Drag-to-Reorder](#29-dashboard-widget-drag-to-reorder)
30. [Dashboard & Projects](#30-dashboard--projects)
31. [RAID Log](#31-raid-log)

---

## 1. Getting Started

### Signing Up

1. Navigate to the PM Assistant URL in your browser.
2. On the landing page, click **Get Started** — this scrolls to the **Pricing** section.
3. Choose your plan:
   - Click **Start Free Trial** for a 14-day free trial (no credit card required).
   - Click **Subscribe** on a paid plan (Consultant or SME) to go straight to checkout.
4. Fill in your email, password, and other details on the registration form.
5. Verify your email address using the link sent to your inbox.

> **Note:** Each email address is eligible for one free 14-day trial. If you previously had an account that was deleted, you can still register again with the same email, but you will need to select a paid plan — the free trial will not be available a second time.

### Logging In

1. Go to the login page (`/login`) and enter your username and password.
2. Click **Sign In**. You will be redirected to the **My Work** page.
3. If your session expires, you will be returned to the login page automatically.
4. Use **Forgot Password** if you need to reset your credentials.

### First Login — Onboarding Wizard

On your very first login, a **3-step onboarding wizard** appears to help you get set up:

**Step 1 — Your Profile**
- Enter your full name.
- Select your role from the dropdown (e.g., Project Manager, Team Member, Executive).
- Choose your preferred methodology: Waterfall, Agile, or Hybrid. This sets the default view mode and tab ordering on new projects.

**Step 2 — Create Your First Project (optional)**
- Pick a project template from the library to pre-populate tasks, milestones, and dependencies.
- Or skip this step if you prefer to create a project manually later.

**Step 3 — You're ready**
- Links to the Dashboard, Projects page, and Mjuzi AI Chat to get started.

The wizard only appears once. After you complete or dismiss it, it will not show again.

### Dashboard Overview

All users see a single **Unified Dashboard** with customizable widgets:

- **KPI Tiles** -- 6 tiles showing Portfolio Health, Overdue Tasks, Open Risks, At-Risk Projects, Budget Variance, and Budget Utilization.
- **Portfolio Intelligence** -- AI-generated health score, risk summary, budget status, and key insights.
- **Projects Table** -- Sortable table with health score, status, priority, progress, budget, and end date. Click any row to open the project. If you have no projects yet, the table shows a **New Project** button in place of the empty list — click it to create your first project.
- **Issues Trend** -- Chart showing issues created vs resolved per week.
- **Milestones** -- Upcoming milestones with days-until badges.
- **Budget Watch** -- Portfolio summary row (total allocated/spent, utilization %, over-budget count), top 5 projects by spend % with burn-rate-vs-progress indicators and progress markers.
- **Recent Activity** -- Latest notifications. Click any notification to navigate to the linked page and mark it as read. Includes a "View All" link to the full notifications page.
- **Health Trends** -- Sparkline health history per project.
- **Sprint Velocity** -- Per-project velocity sparklines with average, trend arrow, sprint-over-sprint delta %, and commitment ratio (delivered vs committed). Portfolio aggregate row when multiple agile projects exist.
- **Sprint Snapshot** -- Active sprints across projects with day progress, task completion bar, and velocity trend (off by default).
- **Goals** -- Objectives sorted by urgency with progress bars, status badges, and due dates (off by default).
- **Team Workload** -- Summary stats (active/overallocated count), per-resource task counts with horizontal bars, overload warnings (15+ tasks), multi-project overallocation alerts (3+ projects), and capacity display (off by default).

**Scope toggle**: If you have fewer projects than the full portfolio, a **My Projects / All Projects** toggle appears. Switching scope updates all widgets.

Click **Customize** next to the dashboard title to toggle widget sections on/off. Your selections are saved automatically and persist across sessions. The three new widgets (Sprint Snapshot, Goals, Team Workload) are off by default — enable them via Customize.

### Sidebar Navigation

The left sidebar provides access to all areas of the application:

| Menu Item      | Description                                 |
|----------------|---------------------------------------------|
| My Work        | Personal task aggregation across all projects (default landing page) |
| Dashboard      | Portfolio overview with KPI tiles and widgets |
| Projects       | Create and manage projects                  |
| Reports        | Pre-built report templates                  |
| Portfolio      | Cross-project Gantt and portfolio view      |
| Analytics      | Summary analytics and dashboards            |
| Workflows      | DAG-based automation workflows              |
| Intelligence   | Scenario modeling and cross-project analysis|
| Resources      | Resource workload heatmap, histogram, and capacity forecast |
| EVM            | Earned value KPIs, trend charts, forecasts, and AI predictions |
| Simulation     | Monte Carlo schedule simulation             |
| Meetings       | AI meeting intelligence                     |
| Lessons        | Lessons learned knowledge base              |
| Timesheets     | Time tracking and actual vs. estimated      |
| Integrations   | Jira, GitHub, Slack, Trello connections     |
| Report Builder | Custom report designer                      |
| Intake         | Project intake forms and submissions        |
| AI Query       | Natural language query interface (Mjuzi AI) |
| AI Proposals   | AI-generated agentic proposals (Mjuzi AI)   |
| Help           | In-app help and user guide                  |
| Account        | Billing and subscription management         |
| Settings       | User preferences and API keys (admin/manager)|

The sidebar can be collapsed using the toggle at the bottom. On mobile devices, it slides in as an overlay.

Your UI layout preferences — theme (light/dark), sidebar collapsed state, AI panel open state, schedule view mode, and projects view mode — are automatically synced to the server. When you log in from a different device or browser, your layout preferences are restored automatically.

An **AI Token Usage** indicator appears above the user section, showing your current month's AI token consumption as a progress bar (or a ring chart when the sidebar is collapsed). The bar changes color as usage increases: green (<70%), amber (70-90%), red (>90%). Click the indicator text to view detailed usage in Settings.

### Command Palette

Press **Ctrl+K** (or **Cmd+K** on Mac) to open the Command Palette. Type to quickly search and navigate to any page, project, or action. The global search covers 9 entity types — **projects, tasks, RAID items (risks/issues), goals, lessons learned, resources, change requests, sprints, and task comments** — with all queries running in parallel. Results appear grouped by category with contextual badges: severity (color-coded) for RAID items, priority for tasks, progress bars for goals, and record IDs (e.g., "R-001") for RAID items. Clicking a result navigates to the relevant page. If one entity type is temporarily unavailable it is silently omitted rather than blocking the whole search. The Command Palette fully supports dark mode — modal background, search input, ESC badge, badge colors, quick action items, results, and empty state all adapt to the active theme.

### Notifications

The bell icon in the top bar shows unread notifications. Click it to view alerts about task changes, workflow approvals, schedule delays, and other events. You can mark individual notifications as read or clear all at once.

---

## 2. Projects

### Creating a Project

1. From the Dashboard, click **Create New Project**.
2. Fill in the project details:
   - **Name** (required) -- A descriptive project name.
   - **Description** -- Overview of the project scope. Supports markdown formatting (headings, bold, italic, lists, links, inline code). Can also be edited inline from the Overview tab's Project Brief card.
   - **Status** -- Planning, Active, On Hold, Completed, or Cancelled.
   - **Priority** -- Low, Medium, High, or Urgent.
   - **Methodology** -- Waterfall (default), Agile, or Hybrid. This controls the default view, tab ordering, readiness bar steps, and context cards (see below).
   - **Budget Allocated** -- The total budget for the project.
   - **Start Date / End Date** -- Planned project timeline.
   - **Assigned PM** -- The project manager responsible.
3. Click **Create** to save the project.

### Editing a Project

Open a project from the Dashboard or Projects page. Edit any field (name, description, status, priority, methodology, budget, dates, assigned PM) and save your changes. Changing the methodology immediately updates the tab ordering, readiness bar, and context cards.

### Deleting a Project

From the project detail view, use the delete option. This action requires appropriate permissions and will remove the project and all associated schedules, tasks, and data.

### Project Detail View

#### Methodology-Aware Layout

The project detail page adapts its layout based on the project's **methodology** setting:

| Aspect | Waterfall (default) | Agile | Hybrid |
|--------|-------------------|-------|--------|
| **Default view** | Gantt | Kanban | Gantt |
| **Primary tabs** | Overview, Schedule, Team, Risks & Issues, Financials, Changes | Overview, Sprints, Backlog, Schedule, Risks & Issues, Team | Overview, Schedule, Sprints, Backlog, Risks & Issues, Team |
| **Context card 1** | Progress % | Velocity (avg pts/sprint) | Progress % |
| **Context card 5** | Status | Sprint count | Velocity (avg pts/sprint) |

#### Context Cards

The project detail page shows 5 context cards at the top: the first and last cards adapt to methodology (see above), while cards 2-4 are always **Budget**, **Timeline**, and **Risks** (open risk count with critical alert).

#### Readiness Bar

Below the context cards, a **readiness bar** guides new project setup. The steps change per methodology:

- **Waterfall:** Tasks, Predecessors, Resources
- **Agile:** Backlog, Sprint, Team
- **Hybrid:** Tasks, Sprint, Resources, Predecessors

Each step turns green when complete. All steps are data-driven and auto-detect completion (tasks exist, predecessor links exist, resources assigned, sprints created). Dismiss the bar with the X button.

#### Tabs

The project detail page shows **6 primary tabs** plus a single **More** overflow menu. Which tabs appear as primary depends on the project methodology:

| Methodology | Primary tabs (left → right) |
|-------------|----------------------------|
| **Waterfall** | Overview, Schedule, Team, Risks & Issues, Financials, Changes |
| **Agile** | Overview, Sprints, Backlog, Schedule, Risks & Issues, Team |
| **Hybrid** | Overview, Schedule, Sprints, Backlog, Risks & Issues, Team |

**More overflow menu (all methodologies):** Time, Files, Performance, AI Insights, Resources, Agent Activity — plus any methodology-specific tabs not shown as primary.

> **Note:** The RAID log is labelled **Risks & Issues** in the tab bar. The tab badge shows the **critical-item count only** (not the total of all open items) to surface the most urgent items at a glance.

The **Overview** tab presents 15 information cards in a responsive grid layout. Cards can be **drag-and-drop reordered** (grip handle on hover) and **shown/hidden** via a Customize dropdown. Card order persists in localStorage.

Available cards:

- **Task Summary** -- Total, completed, overdue, and in-progress task counts with a donut-style breakdown.
- **Timeline Progress** -- Elapsed vs complete percentage with on-track/behind/overdue indicator and progress bar.
- **Key Milestones** -- Up to 5 milestones sorted by date with status icons and dates. Click to navigate to the Schedule tab.
- **Health Score** -- Current project health score with a 30-day **sparkline trend chart** (SVG) showing health history. Trend arrow (up/down/stable) with colour coding.
- **EVM Metrics** -- CPI and SPI gauges with earned value, planned value, and cost/schedule variance. Click to navigate to the Performance tab.
- **Budget** -- Budget allocated vs spent with utilization percentage bar, currency formatting, and over-budget warning.
- **Due Soon** -- Tasks due within the next 7 days, sorted by urgency.
- **RAID Summary** -- 2x2 grid showing open risks, open issues, open actions, and pending decisions with critical/triggered badges. Click to navigate to the RAID tab.
- **Current Sprint** -- Active sprint name, day progress (Day X of Y), task completion bar, and sprint goal.
- **Recent Activity** -- Last 6 audit trail entries with user, action, and timestamp.
- **Blocked Tasks** -- Tasks with "blocked" status, showing blockers and assignees.
- **Comments** -- Recent task comments across the project.
- **Goals** -- Project-linked OKR progress with completion percentages.
- **Attachments** -- Recent file uploads with version info.
- **Latest Meeting** -- Most recent meeting analysis summary with action items and decisions.

#### Project Brief

The **Project Brief** card is part of the reorderable overview card grid — drag it to reposition alongside KPI, milestones, and other cards (it always spans full width). The brief displays the project description with full markdown rendering (headings, bold, italic, lists, links, and inline code) powered by the `marked` GFM parser.

- **Editing** -- Admins and project managers see a pencil icon (always visible on mobile; appears on hover on desktop). Click the card (or the pencil) to enter edit mode with a monospace textarea. Clicking a **link** in the rendered brief opens it in a new tab without entering edit mode. The card shows a focus ring while editing. The textarea is capped at 50vh height with scrolling to prevent it from consuming the entire viewport on mobile. You can also **Tab** to the brief and press **Enter** or **Space** to start editing (keyboard accessible).
- **Markdown toolbar** -- In edit mode, a formatting toolbar appears above the textarea with 6 buttons: **Bold**, **Italic**, **Heading**, **Bullet list**, **Link**, and **Inline code**. Each button wraps the current text selection with the appropriate markdown syntax (or inserts a placeholder if nothing is selected). Keyboard shortcuts **Ctrl+B** (bold) and **Ctrl+I** (italic) also work. The toolbar wraps to a second row on narrow screens.
- **Save on blur** -- Changes save when you click outside the editor or tab away. A "Saving..." / "Saved" indicator appears next to the header. If a save fails, a red "Save failed" message with a **Retry** link appears. If you navigate away mid-edit, the draft is persisted to sessionStorage and an API save is attempted; if the save fails, the draft is recovered on your next visit. Closing the browser tab while editing with unsaved changes triggers a confirmation warning.
- **Escape to cancel** -- Pressing **Escape** while editing discards your changes and reverts the draft to the pre-edit description. Because nothing is saved while you type, Escape is always a clean cancel — no partial saves to worry about.
- **Conflict detection** -- If another user saves the brief while you are editing, your next save will detect the conflict and show an amber "Someone else saved" message with a **Refresh** link. Click Refresh to load their changes. This prevents silently overwriting another user's work.
- **Collaborative editing** -- When another user is editing the brief at the same time, an amber indicator with a pulsing dot shows their username (e.g., "jsmith editing"), truncated on narrow screens. The indicator is screen-reader accessible (`role="status"`, `aria-live="polite"`) and respects reduced-motion preferences.
- **Empty state** -- When no description exists, a placeholder ("Click to add a project brief...") is shown. Editors can click or press Enter to start writing. Read-only users see "No project brief yet."
- **Markdown support** -- `# Headings`, `**bold**`, `*italic*`, `- lists`, `[links](url)`, and `` `inline code` `` are all rendered.

Additional sections below the card grid:
- **Custom Fields** -- User-defined metadata fields.
- **Portal Links** -- External portal link management. Each link generates a unique token URL (`/portal/:token`) that stakeholders can access without logging in. The portal shows project progress, task statistics, budget summary, milestone timeline, recent activity, and a comment form. Visibility of each section is controlled by the link's permissions (`canViewBudget`, `canViewGantt`, `canViewReports`, `canComment`).
- **Export XML** -- Click the **Export XML** button (same row as Export CSV and Export PDF) to download the project as an MSPDI XML file. This format is compatible with Microsoft Project and ProjectLibre and includes tasks, resources, assignments, and dependency links.

> **Trial accounts:** If you are on a trial plan, clicking any export button (CSV, XML, or JSON/PDF) downloads a **sample file** containing demo project data (5 tasks across 2 phases) rather than your real project. An amber banner in the UI identifies it as a sample before the download begins. Upgrade to a paid plan to export your actual project data.

#### Real-Time Presence

When other users are viewing the same project, their avatar circles appear in the project header next to the action buttons. Each circle shows the user's initials with a tooltip displaying their username. This helps teams coordinate and avoid conflicting edits.

Presence automatically re-joins after a WebSocket reconnect (e.g., if your connection drops briefly), so you don't need to refresh the page to reappear in the viewer list.

---

## 3. Schedules and Tasks

### Creating a Schedule

1. Open a project and navigate to the **Schedule** tab.
2. If no schedules exist, you'll see two options:
   - **Create Schedule** -- creates a blank schedule ready for adding tasks manually.
   - **Upload Schedule (.xlsx / .csv)** -- import tasks from a spreadsheet file.
3. You can have multiple schedules per project (e.g., baseline schedule, revised schedule).

### Switching Between Schedules

When a project has more than one schedule, a **pill/tab strip** appears at the top of the Schedule tab, letting you switch between them without leaving the page. Only the selected schedule is rendered — there are no duplicate toolbars or overlapping views. On mobile, the strip is replaced by a **dropdown (`<select>`)** for touch-friendly switching.

### Schedule Toolbar

The schedule toolbar is a compact single row of controls:

```
[Search] [Filters] | [Columns] [Critical Path] | [⋯]
```

The **⋯ overflow menu** groups less-frequent actions:

| Group | Items |
|-------|-------|
| **Baseline** | Save baseline, Select baseline, Show variance |
| **Scenarios** | Create scenario, Select scenario, Compare |
| **Data** | Import (CSV / Excel / XML), Export CSV |
| **Automation** | AI Reschedule, Level Resources, % Mode |
| **Help** | Keyboard shortcuts |
| **Danger** | Delete schedule (shown in red) |

### Adding Tasks

1. Within a schedule, click **Add Task**.
2. Fill in the task form:
   - **Name** (required) -- Task description.
   - **Status** -- Pending, In Progress, Completed, or Cancelled.
   - **Priority** -- Low, Medium, High, or Urgent.
   - **Start Date / End Date** -- Task timeline.
   - **Estimated Days** -- Duration estimate.
   - **Work Effort (hours)** -- Total labor hours needed to complete the task.
   - **Progress Percentage** -- Current completion (0-100%).
   - **Assigned To** -- Team member responsible.
   - **Description** -- Detailed task notes.
   - **Story Points** -- Agile estimation value.
   - **Recurrence** -- Set a recurring schedule (Daily, Weekly, Biweekly, or Monthly). For Weekly/Biweekly, select specific days. When you save a recurring template, task instances are automatically expanded up to 90 days ahead (capped at 100 instances). The template task displays a blue repeat icon on its Gantt bar. Generated instances also show a repeat icon and link back to their parent template. To regenerate instances after editing a template, delete existing children and re-save.
3. Click **Save** to add the task.

### Task Hierarchy

Tasks can be organized hierarchically:

- Create **parent tasks** (phases or work packages) as top-level items.
- Add **subtasks** under parent tasks to break down work.
- Expand or collapse task groups using the chevron icon.
- **Summary tasks**: Parent tasks with children become summary tasks. Their dates, progress, status, and budget are automatically computed from children. Rollup fields are read-only in the table and task form (shown as greyed/disabled). The Gantt chart renders summary tasks with diamond markers at each end of the bar.

### Task Budget

Each task can track budget and cost:

- **Budget ($)** -- Planned budget for the task. Set in the Task Form modal or inline in the Table view (Cost column group).
- **Actual Cost ($)** -- Actual spend to date.
- **Cost Variance** -- Computed as Budget minus Actual Cost. Shown colour-coded: green (under budget), red (over budget).

Enable cost columns via the **Columns** picker > **Cost** group.

### Task Constraints

Constraints control when tasks can be scheduled in the Critical Path calculation:

- **ASAP** -- As Soon As Possible (default, no constraint)
- **ALAP** -- As Late As Possible (scheduled at latest possible time)
- **SNET/SNLT** -- Start No Earlier/Later Than a specific date
- **FNET/FNLT** -- Finish No Earlier/Later Than a specific date
- **MSO/MFO** -- Must Start/Finish On a specific date

Set constraints in the Task Form modal or inline via the **Constraint** and **Constraint Date** columns (enable in Columns picker > Scheduling group).

### Multi-Resource Assignment

Tasks can have multiple resources assigned:

- In the Task Form modal, use the **Resource Assignments** section to add up to 10 resources.
- Each assignment has: Resource name/ID, Allocation % (1-100), and optional Role.
- The primary assignee (first resource or the "Assigned To" field) is shown in the Gantt and Table views.

### Custom Calendars

Each project has a working calendar that defines which days are working days:

- **Default calendar**: Monday through Friday, 8 hours/day.
- Add **holidays** (non-working exceptions) or mark weekend days as working.
- Calendars are managed via the API (`/api/projects/:projectId/calendars`).

### Dependencies

Each task supports up to **20 predecessors**. Set dependencies to define execution order:

- **Adding predecessors** -- In the task form modal, use the multi-predecessor panel: click **Add Predecessor** to add a row, then choose the predecessor task, dependency type, and optional lag days. Use the remove button on any row to delete it.
- **Dependency Type** -- Each predecessor has its own type: Finish-to-Start (FS), Start-to-Start (SS), Finish-to-Finish (FF), or Start-to-Finish (SF). FS is the default.
- **Lag** -- Optional number of days on each individual dependency (e.g., a 2-day lag on FS means the successor starts 2 days after the predecessor finishes). Negative lag represents lead time.
- **In Table view** -- Click the Predecessor cell and type one or more entries separated by commas (e.g. `3`, `5SS`, `7FS+2d`, `3FS+2d,5SS,7`). Press Enter to save.
- Dependencies are displayed as a comma-separated list in compact MS Project row-number format. Each predecessor shows a health dot: green (done), yellow (in progress), red (overdue).
- Gantt dependency arrows are drawn for each predecessor and colour-coded by predecessor health. All predecessors are used in critical path and Monte Carlo analysis.
- **Validation** -- The server enforces dependency rules for each predecessor: no self-references, no circular dependencies (A→B→C→A), dependencies must exist and be in the same schedule, and the 20-predecessor limit is enforced. Invalid dependencies return an error message explaining the issue.
- **Orphan cleanup** -- Deleting a task automatically removes all dependency records that referenced it (via `ON DELETE CASCADE`), so no other tasks are left with broken predecessors.
- **Removing dependencies** -- To remove a single predecessor, edit the task and delete the predecessor row, or clear it from the inline Predecessor cell. To remove **all** dependencies in a schedule at once, ask the AI assistant (e.g. "remove all dependencies from this schedule") — it will use the `clear-all-dependencies` tool to bulk-remove them.

### Task Activity Panel

Click on any task to view its activity history, including status changes, reassignments, date modifications, and comments.

**@Mentions in comments** -- When writing a comment, type `@` to open an autocomplete list of project members. Selecting a name inserts the mention. The mentioned user receives an in-app notification linking to that task.

### Delay Detection

Tasks that are behind schedule are flagged with a delay indicator showing the number of days overdue. The system automatically detects schedule slippage.

### Bulk Operations

Select multiple tasks to perform bulk operations:

- **Bulk Status Update** -- Change the status of many tasks at once.
- **Bulk Update** -- Modify priority, assignee, or dates in batch.

---

## 4. Views

The schedule page offers multiple visualization modes:

### Gantt Chart

The default schedule view. Displays tasks as horizontal bars on a timeline:

- **Timescale zoom**: Use the **D | W | M | Q | Y** buttons in the toolbar to switch between Day, Week, Month (default), Quarter, and Year zoom levels. A **two-tier header** shows coarser units on top (e.g. months) and finer units below (e.g. weeks). Your zoom choice is remembered per schedule.
- **Bar length** represents task duration (start to end date).
- **Bar color** indicates status (blue for in progress, green for completed, gray for pending).
- **Progress fill** shows completion percentage within each bar.
- **Resizable panel splitter**: Drag the vertical bar between the task table and the Gantt timeline to resize the panels. Your chosen width is remembered per schedule. Drag right to reveal more columns, drag left to give more room to the timeline.
- **Left panel columns**: #, Task Name, Pred, Start, End, Duration, Est Days, %, Priority, Assigned, Status. Fixed-width columns stay in place; only Task Name grows/shrinks as you resize.
- **Resizable columns**: Drag the right border of any column header (Pred, Start, End, Duration, Est, Work, %, Priority, Assigned, Status) to resize it. Widths are saved per schedule in localStorage. The Task Name column uses flex width and Row # and Edit Icon columns are fixed.
- **Column show/hide**: Click the **Columns** button in the toolbar to open a dropdown. Toggle any column on/off (except Row #, Task Name, and Edit Icon which are always visible). Click **Reset to default** to restore all columns. Visibility persists per schedule in localStorage.
- **Row expand/collapse**: Parent tasks show a chevron (▶) to the left of their name. Click it to collapse or expand their children. Collapsed parents hide all descendants. Collapsed state persists per schedule in localStorage. Use the **Collapse All** (▶) and **Expand All** (▼) buttons in the toolbar to collapse or expand all parent tasks at once.
- **Click-to-select, click-to-edit**: The first click on a task row **selects** it (highlighted with a ring). Clicking a cell on the already-selected row enters **inline edit mode**. This two-step behavior matches MS Project and lets you perform selection-dependent actions (like Tab to indent) before editing.
- **Inline grid editing**: On a selected row, click any cell in the left panel to edit it directly — no modal required. Editable fields: Task Name, Predecessor, Start Date, End Date, Duration, Est Days, %, Priority, Assigned To, and Status. Press **Enter** to save, **Escape** to cancel, or just click away (blur saves automatically). A green flash confirms the save. Use **Tab** to advance to the next field and **Shift+Tab** to go back; tabbing past the last field jumps to the first field of the next row. Editing the **Duration** column (e.g. typing `10`) automatically sets End Date = Start Date + 10 days. The row number (#) column is not editable. Double-click a row or click the pencil icon to open the full edit modal instead.
- **Row drag reorder (cross-parent)**: Hover over the # column to reveal a drag grip icon (⠿). Drag rows up or down to reorder tasks — you can move tasks across parent levels, just like MS Project. Dropping a task on a summary task makes it the first child; dropping between tasks makes it a sibling of the drop target. Summary tasks move with all their children. Cycle prevention stops you from dropping a parent onto its own descendant. A blue border highlights the drop target. Sort order and parent assignment are persisted automatically and can be undone with Ctrl+Z.
- **Multi-select bulk edit**: **Ctrl+click** (Cmd+click on Mac) any task row to add or remove it from the selection — no need to use checkboxes first. **Shift+click** for range selection. You can also click the checkbox in the # header to select all rows, or click individual checkboxes. When tasks are selected, a sticky toolbar appears with dropdowns to bulk-update Status, Priority, or Assignee, plus a Delete button. Press the **Delete** key to bulk-delete selected tasks — a confirmation modal shows the exact count ("Delete N tasks?") before anything is removed. Right-clicking a task when multiple tasks are selected shows "Delete N Tasks" in the context menu and the confirmation modal covers all selected tasks plus the right-clicked one. Both the Delete key and right-click context menu use the same confirmation modal (not the browser's native dialog). Click **Clear** to deselect all.
- **Undo/Redo**: Press **Ctrl+Z** to undo and **Ctrl+Y** (or **Ctrl+Shift+Z**) to redo inline edits, bar drag operations, row reorders, bulk updates, and delete operations (single or bulk). Task data is captured before deletion so undo can fully recreate the tasks via the API. Undo/redo buttons also appear in the Gantt toolbar with tooltips showing the action description. The undo stack holds up to 50 actions per session and resets on navigation or page refresh. Creating new tasks is not undoable.
- **Keyboard navigation**: Use **Arrow keys** to move between cells in the grid like a spreadsheet. Press **Enter** or **F2** to start editing the focused cell. Press **Escape** to clear the focus. Arrow Up/Down also selects the row. Focus is indicated by a blue ring around the cell.
- **Predecessor column (Pred)** shows all predecessors as a comma-separated list in compact row-number format (e.g. "3FS+2d,5SS,7") with a colour-coded health dot: green (done), yellow (in progress), red (overdue). Click to edit inline using the same MS Project notation.
- **Dependency arrows** are drawn for each predecessor individually, colour-coded by that predecessor's health: green for completed, yellow for in-progress, red for overdue. Hover over any arrow to see a tooltip showing the predecessor name, successor name, dependency type, and lag days.
- **Drag-and-drop rescheduling**: Drag a bar to move the task to new dates. Drag the right edge to resize (change end date only). Changes automatically cascade through dependencies. The timeline **auto-scrolls** when you drag near the left or right edge of the viewport.
- **Interactive dependency drawing**: Hover over a task bar to see connector dots at the left (start) and right (finish) edges. Drag from a dot to another task bar to create a dependency link. The dependency type (FS/SS/FF/SF) is determined by which edges you drag from and to. A dashed blue preview line and target row highlight guide you during the drag.
- **Recurring task indicator**: Template tasks display a repeat icon on their bar.
- **Milestones**: Tasks marked as milestones appear as diamonds instead of bars.
- **PDF Export**: Click the **Print / Export PDF** button in the toolbar to open a print-optimised Gantt ready for saving as PDF.
- Hover over a bar to see task details including all predecessors (row number, task name, dependency type, lag, and health status per predecessor). Click to edit.
- **Column header sort**: Click any column header in the left panel to sort rows ascending, then descending, then back to default (none). A ▲ or ▼ indicator appears in the header to show the active sort direction. Sort preserves task hierarchy — children are sorted within their own sibling group, not mixed across levels. Row drag reorder is disabled while a sort is active.
- **Copy/Paste cells**: Press **Ctrl+C** to copy the focused cell's value to the clipboard. Press **Ctrl+V** to paste the clipboard value into the focused cell (paste only applies when the field types match). A green flash confirms the paste.
- **Copy/Paste rows**: When no cell is focused, **Ctrl+C** copies the selected or active task(s) and **Ctrl+V** pastes them as new duplicate tasks with `" (copy)"` appended to each name. Useful for quickly creating similar tasks without re-entering data.
- **Duplicate shortcut (Ctrl+D)**: Duplicates the selected or active task(s) in one step — equivalent to Ctrl+C then Ctrl+V. Works in both Gantt Chart and Table View.
- **Column auto-fit**: **Double-click** the right border of any column header (the resize handle) to auto-fit the column width to its longest content value. Width is capped at 400px.
- **Baseline bar refinement**: When a baseline is active, ghost bars are shown only for tasks whose baseline dates differ from their current dates. Tasks that are exactly on schedule show no ghost bar, keeping the chart uncluttered.
- **Indent/Outdent**: Click a task to select it, then press **Tab** to indent it (makes it a child of the task immediately above it). Press **Shift+Tab** to outdent (promotes the task up one level to its parent's parent). Also works when a cell is focused via arrow keys. **Multi-select indent**: select multiple tasks via checkboxes (click the # header for all, or individual rows), then press **Tab** to indent them all under the task above the first selected task, or **Shift+Tab** to outdent them all. Selected tasks won't indent under each other. Both operations go through the standard update path and are automatically undoable with Ctrl+Z.
- **Bar progress drag**: Hover over the right edge of a task bar's progress fill to reveal a drag handle. Drag left or right to adjust the task's completion percentage directly on the timeline. The change is applied via the standard update path and is automatically undoable with Ctrl+Z.
- **Quick Search (Ctrl+F)**: A search bar in the Gantt toolbar lets you filter tasks by name with type-ahead. Press **Ctrl+F** to focus the search input. Matching is case-insensitive substring. Parent rows stay visible when children match, preserving hierarchy. A **"X / total tasks"** counter shows how many tasks match. Press **Escape** to clear the search.
- **Filter Panel**: Click the **Filter** button (funnel icon) to open a filter panel with multi-select checkboxes for **Status** and **Priority**, a text input for **Assignee**, date pickers for **Start After / Start Before**, and min/max inputs for **Progress %**. All filters combine with AND logic. Parent rows remain visible when descendants match. An active filter count badge appears on the button. Click **"Clear All"** to reset all filters.
- **Saved Views**: The **Saved Views** dropdown in the toolbar lets you save and load named view configurations including visible columns, sort field/direction, and zoom level. Views are stored in localStorage with a `gantt:` prefix (separate from Table views). Select a view to restore its settings instantly, or create/delete views from the dropdown.
- **Row striping**: Alternating row backgrounds (every other row) in both the left task panel and the timeline for improved readability. Stripes are subtle and support dark mode. Active task and hover highlights override the stripe.
- **Resource avatars**: Task bars show a small circle with the assignee's initials at the right edge. Colors are deterministic — the same person always gets the same color. Avatars appear on non-parent, non-milestone bars wider than 40px. Hover over the circle to see the full assignee name.
- **MPP-style inline task entry**: Below existing tasks in the left panel, 3-6 persistent empty rows appear (MS Project style) with continuation row numbers. Click into the Task Name cell of any empty row and start typing. Press **Enter** to create the task — the input clears and empty rows remain for the next entry. Press **Escape** to cancel. The first empty row shows a "Type a task name…" placeholder. When a schedule has no tasks, the inline rows are the primary entry point for adding tasks.
- **Drag-to-create**: Click and drag on an empty area of the timeline to create a new task. A dashed blue preview rectangle appears while dragging. On release, the Add Task form opens with the start and end dates pre-filled from the drag range. The parent task is auto-detected: dragging on a parent row creates a child task, dragging on a child row creates a sibling. A minimum drag width of half a day prevents accidental creation.
- **Non-working day shading**: At Day and Week zoom levels, non-working days (weekends, holidays, and custom calendar exceptions) are shaded with a subtle grey overlay on the timeline. This makes it easy to see at a glance which days are off-limits for scheduling. Shading data is fetched from the project's calendar automatically.
- **Quick Level Resources**: Click the **Level Resources** button (orange) in the Gantt toolbar to run automatic resource leveling on the current schedule. A modal appears showing the proposed task adjustments — each row lists the task name, original dates, new dates, and the reason for the shift. Click **Apply All** to accept the changes, or **Cancel** to discard. Applied changes are added to the undo stack, so you can revert with Ctrl+Z.
- **Progress Mode (Duration vs Work)**: Use the **% Mode** dropdown in the toolbar to switch between **Duration** and **Work** modes. In **Duration** mode (default), parent task progress is calculated as the simple average of child progress percentages. In **Work** mode, parent progress is weighted by each child's estimated duration in hours — a 40-hour task contributes more to the parent's progress than an 8-hour task. The setting is saved per schedule.
- **What-If Scenarios**: Click **Create Scenario** (indigo button) in the toolbar to clone the current schedule into an independent what-if scenario. The clone copies all tasks, dependencies, and assignments. Edit the scenario freely without affecting the base schedule. Use the scenario dropdown to switch between the base schedule and its scenarios. Click **Compare** to see a side-by-side diff: summary cards show counts of modified, added, and removed tasks plus total duration change, while a detail table highlights date and duration changes per task. Click **Promote to Base** to replace the base schedule's task dates with the scenario's values, then delete the scenario.
- **Resource overallocation warnings**: Click the **Overalloc** button (warning triangle icon) in the toolbar to highlight tasks with overlapping resource assignments. The system detects when the same person is assigned to multiple tasks with overlapping dates, then marks those bars with an amber border, glow effect, and a small "!" warning dot. A badge on the button shows the total count of flagged bars. The legend adds an "Overallocated" entry when active. Toggle the button off to hide the highlights.
- **Minimap**: A small overview panel (200×80px) appears in the bottom-right corner of the timeline, showing the entire schedule at a glance. Each task is shown as a coloured rectangle matching its status colour. A semi-transparent blue rectangle indicates the currently visible area. Click anywhere on the minimap to jump to that position, or drag the viewport rectangle to scroll proportionally. Toggle the **Minimap** button in the toolbar to show or hide the minimap. Enabled by default.
- **Touch gestures (mobile/tablet)**: All Gantt drag interactions support touch input for tablets and touch-enabled laptops. Touch-drag a task bar to move or resize it, touch-drag the progress handle to adjust completion percentage, and touch-drag on empty timeline space to create a new task. Single-finger gestures only; page scrolling is suppressed during drag operations.
- **Row action icons**: Each row shows three action icons on hover — **Edit** (pencil, opens the task editor), **Insert Below** (+ icon, opens the add form to create a new task after the current row, inheriting the parent if the row is a subtask), and **Delete** (trash, opens a confirmation modal before deleting; if multiple tasks are selected, the trash icon deletes the entire selection). Icons fade in on row hover.

#### Schedule Filter Bar & CSV Export

A cross-view **filter bar** appears above all schedule views (Gantt, Kanban, Calendar, Table):

- **Search** — real-time text filtering by task name.
- **Filter dropdowns** — Status, Priority, and Assignee dropdowns populated from the current task list. A badge on the Filter toggle button shows how many filters are active.
- **Clear all** — resets all filters in one click.
- **Task count** — "X of Y tasks" indicator.
- **CSV Export** — downloads the currently filtered tasks as a CSV file named after the schedule.

#### Mobile Schedule View

On mobile, the Schedule tab switches to a dedicated mobile experience with a **view switcher** (List / Kanban / Calendar). The mobile view initializes from the desktop view mode — if you were on Kanban or Calendar on desktop, the mobile view starts with that same mode selected:

- **List view** — `TaskCardMobile` cards with swipe-to-complete (swipe right past 80px to mark complete) and tap-to-cycle status badges.
- **Kanban view** — mobile-friendly columns with horizontal scrolling.
- **Calendar view** — responsive Month/Week/Day calendar.

### Kanban Board

Drag-and-drop card view organized by status columns:

- **Pending** -- Tasks not yet started.
- **In Progress** -- Active work items.
- **Completed** -- Finished tasks.
- **Cancelled** -- Removed tasks.

Drag a card between columns to update its status. Each card shows the task name, priority badge, assignee, due date, **subtask count badge**, and **dependency count badge**.

**WIP Limits** -- Each column supports a configurable Work-In-Progress limit set from the Kanban toolbar. When a column reaches its limit, the column header turns amber to signal congestion. Limits are stored in localStorage per schedule.

**Inline Quick-Add** -- Click the "+" button at the bottom of any column to reveal an inline text input. Type a task name and click Add to create a task directly in that status without opening a modal.

**Swimlane Mode** -- Use the dropdown in the Kanban header to group cards by **Assignee** or **Priority** in addition to the default flat layout. Each swimlane row shows a label and mini status columns. Swimlane selection persists in localStorage.

### Calendar View

Tasks plotted on a calendar with three display modes:

- **Month view** (default) -- Monthly grid with task indicators per day. Supports **drag-to-reschedule**: drag a task from one day to another and the task's duration is preserved (start and end dates shift together).
- **Week view** -- 7-column layout with large day headers and full task lists showing priority, assignee, and date range.
- **Day view** -- Single-day detail view with rich task cards including priority badge, assignee, date range, and progress bar.

Toggle between Month / Week / Day using buttons in the calendar header. Navigation arrows and a Today button move through time periods in any mode.

### Table View

A spreadsheet-like view of all tasks with inline editing. Click the **Columns** button (gear icon) to open the column picker. Choose from 22 columns organized into four groups:

- **Standard** -- # (row number, always visible), Name, Status, Priority, Start Date, End Date, Progress, Assigned To (visible by default, inline-editable), Notes (hidden by default, click to open popup editor)
- **Scheduling (CPM)** -- Duration, Early Start, Early Finish, Late Start, Late Finish, Total Float, Free Float, Critical (read-only; enabling any of these triggers CPM computation automatically)
- **Baseline** -- Baseline Start, Baseline End, Start Variance, End Variance (read-only; populated when a baseline comparison is active)
- **Other** -- Predecessor (inline-editable), WBS (read-only; auto-computed from task hierarchy)

The **# column** always appears as the first column and cannot be toggled off. It shows sequential row numbers (1, 2, 3...) based on the current sort order.

The **Predecessor column** displays all predecessors as a comma-separated list in MS Project-style row-number format:
- `3` — Finish-to-Start on row 3 (FS is default, omitted)
- `7SS` — Start-to-Start on row 7
- `3FS+2d` — Finish-to-Start on row 3 with 2-day lag
- `3FS+2d,5SS,7` — three predecessors: rows 3, 5, and 7

Each predecessor in the list shows a **health dot**: green (completed), yellow (in progress), red (overdue). Hover to see the full predecessor task name, type, and lag.

**Inline predecessor editing**: Click the Predecessor cell and type one or more comma-separated entries (e.g. `3`, `5SS`, `7FS+2d`, `3FS+2d,5SS,7`). Press Enter to save. Invalid inputs (bad row number, self-reference, more than 20 predecessors) show a red error. Clear the field to remove all dependencies.

Column selections are saved per schedule and persist across page reloads. All visible columns support sorting. Bulk select, status/priority/assignee changes, and inline cell editing continue to work on the standard columns.

**Group-By** -- Use the dropdown in the table header to group rows by **Status**, **Priority**, or **Assignee**. Each group has a collapsible header row showing the group name and task count. Collapsed/expanded state persists in localStorage.

**MPP-Style Empty Rows** -- The bottom of the table shows 5-8 persistent empty rows (MS Project style) with continuation row numbers. Click into the Task Name cell of any empty row and start typing. Press **Enter** to create the task — the input clears and empty rows remain for the next entry. Press **Escape** to cancel.

**Right-Click Context Menu** -- Right-click any task row to open a context menu with: Insert Before, Insert After, Edit Task, Indent, Outdent, and Delete. When multiple tasks are selected, Delete shows the total count and removes all selected tasks plus the right-clicked task.

**Tab Indent / Shift+Tab Outdent** -- Select a task (or multi-select several) and press **Tab** to indent under the task above, or **Shift+Tab** to outdent to the grandparent level. Works identically to the Gantt chart.

**Delete Key** -- Press **Delete** to remove the active task or all selected tasks. A confirmation modal appears showing how many tasks will be deleted. Deletions can be undone with **Ctrl+Z**.

**Undo / Redo** -- The table toolbar includes Undo and Redo buttons (also accessible via **Ctrl+Z** / **Ctrl+Y**). All edits, bulk updates, and deletions are tracked in the undo history. Hover over the buttons to see what action will be undone or redone.

**Bulk Operations with Undo** -- Multi-select tasks using checkboxes, then use the bulk toolbar to change status, priority, or assignee. All bulk operations are tracked in the undo history, so you can reverse them with Ctrl+Z.

**Arrow Key Navigation** -- Use the **Arrow keys** to move between cells. The focused cell is highlighted with a blue ring. Press **Enter** or **F2** to enter edit mode; press **Escape** to clear the focus. The first click on a row selects it; a second click on a cell of the already-selected row enters edit mode (matching the Gantt chart behavior).

**Cell Copy/Paste** -- When a cell is focused, press **Ctrl+C** to copy its value to the clipboard and **Ctrl+V** to paste from the clipboard into the focused cell (same field type only). A green flash confirms.

**Copy/Paste Rows** -- When no cell is focused, press **Ctrl+C** to copy the selected or active task(s) and **Ctrl+V** to paste them as duplicates. Each copy has `" (copy)"` appended to its name. Other fields (dates, status, priority) are carried over from the original. Press **Ctrl+D** to duplicate in one step (no separate copy needed).

**Resource Column** -- Enable the **Resource** column from the Columns picker to add and remove resource assignments inline — the same quick-assign chips available in the Gantt chart. Click **"+"** to open a searchable resource dropdown; hover a chip and click **"×"** to remove.

**Column Auto-Fit** -- **Double-click** the right border of any column header (the resize handle) to auto-fit that column's width to its content. Width is capped at 400px.

#### Notes Column

Toggle the **Notes** column on via the Columns picker. It maps to the task's description field. Click any Notes cell (in either Table view or Gantt chart) to open a floating popup editor with:

- A full-size textarea (6 rows, resizable)
- **Save** and **Cancel** buttons
- Auto-saves when you click outside the popup
- Press **Escape** to dismiss without saving

#### Saved Views

Click the **Views** button next to the Columns picker to save and load named view configurations. Each saved view stores the current column selection and sort order. You can:

- **Save** a new view by entering a name and clicking Save
- **Load** a saved view by clicking its name in the dropdown
- **Update** the active view if you've changed columns or sorting since loading it
- **Delete** a view by clicking the trash icon

Saved views are stored per schedule in your browser's localStorage.

### Network Diagram

A node-and-edge graph showing task dependencies. Each task appears as a node, with arrows representing dependency relationships. The critical path is highlighted.

---

## 5. Critical Path

The critical path identifies the longest chain of dependent tasks that determines the minimum project duration.

### Viewing the Critical Path

1. Open a project schedule.
2. Toggle the **Critical Path** checkbox in the schedule toolbar.
3. Tasks on the critical path are highlighted with red borders on the Gantt chart.
4. A **Critical Path info banner** appears below the toolbar showing the total project duration (in days) and the number of critical tasks.

### Key Information

- **Critical tasks** -- Any delay to these tasks directly delays the project end date.
- **Float/Slack** -- Non-critical tasks show their available float (how much they can slip without affecting the project end date).
- **Total duration** -- The calculated minimum project duration based on the critical path.

Use critical path analysis to focus management attention on the tasks that matter most to the timeline.

---

## 6. Baselines

Baselines capture a snapshot of the schedule at a point in time, enabling comparison against the current plan. Baselines are permanently saved to the database, so they persist across sessions and server restarts.

### Creating a Baseline

1. Open a schedule with defined tasks.
2. Click **Save Baseline** (or use the baselines panel).
3. Enter a baseline name (e.g., "Original Plan", "Rev 2").
4. The system captures a copy of all task dates, durations, and progress at that moment and stores it permanently.

### Comparing Baselines

- View baseline bars alongside current task bars on the Gantt chart.
- Compare planned vs. actual dates to identify schedule drift.
- Use baseline data in EVM calculations (planned value is derived from the baseline).

### Managing Baselines

- List all baselines for a schedule.
- Delete baselines that are no longer needed.
- Multiple baselines can exist per schedule for tracking progressive changes.

---

## 7. Earned Value Management (EVM)

EVM provides objective cost and schedule performance measurement.

### EVM Dashboard

Navigate to the EVM section of a project to see:

- **Planned Value (PV)** -- The budgeted cost of work scheduled.
- **Earned Value (EV)** -- The budgeted cost of work actually performed.
- **Actual Cost (AC)** -- The actual cost incurred.

### Key Metrics

| Metric | Formula | Meaning |
|--------|---------|---------|
| SPI (Schedule Performance Index) | EV / PV | > 1.0 = ahead of schedule |
| CPI (Cost Performance Index) | EV / AC | > 1.0 = under budget |
| SV (Schedule Variance) | EV - PV | Positive = ahead |
| CV (Cost Variance) | EV - AC | Positive = under budget |
| EAC (Estimate at Completion) | BAC / CPI | Forecasted total cost |
| ETC (Estimate to Complete) | EAC - AC | Remaining cost forecast |
| TCPI (To-Complete Performance Index) | Remaining work / remaining budget | Required efficiency |

### S-Curve Chart

A visual plot of PV, EV, and AC over time. The S-curve shows:

- Whether the project is ahead or behind schedule (EV vs. PV gap).
- Whether the project is over or under budget (EV vs. AC gap).
- Trend lines for forecasting completion.

### EVM Forecast

The EVM Forecast Dashboard shows:

- **Completion date predictions** based on current SPI.
- **Cost at completion forecasts** based on current CPI.
- **Forecast comparison charts** showing optimistic, most likely, and pessimistic scenarios.
- **AI-generated alerts** when metrics indicate critical or warning thresholds.

### EVM Trend Chart

Track how SPI and CPI change over time to identify whether performance is improving or degrading. The trend chart includes:

- **Dark mode support** -- SVG grid lines and axis labels adapt to dark mode using class-based fills.
- **Interactive tooltips** -- Hover data points to see CPI, SPI values and date.
- **AI prediction line** -- Dashed purple extension showing predicted future CPI trend.

### Budget Tab

The Budget tab within each project provides comprehensive expense tracking and budget visualization.

#### Overview

- **Summary cards** -- Budget Allocated, Total Spent, Remaining (green when positive, red when over budget).
- **Budget health gauge** -- Semi-circle SVG gauge showing budget consumption percentage with color zones (green < 80%, amber 80-100%, red > 100%).
- **Category donut chart** -- SVG donut chart showing cost breakdown across 10 categories (labor, materials, software, hardware, travel, contractors, training, consulting, licenses, other) with a color legend.
- **Monthly spend trend** -- Bar chart showing monthly spending with an amber cumulative line overlay. Legend identifies monthly bars vs cumulative trend.

#### Expenses

- **Search bar** -- Filter expenses by vendor name, description, or category.
- **Category filter** -- Dropdown to show only expenses in a specific category.
- **Sortable columns** -- Click the Date, Category, Amount, or Vendor column headers to sort ascending or descending. Active sort shows an arrow indicator.
- **CSV export** -- Click the CSV button to download all filtered expenses as a CSV file.
- **Add expense** -- Inline form with date, amount, category, vendor, and description fields.
- **Delete** -- Remove individual expenses with the trash icon.
- **Mobile cards** -- On small screens, expenses display as compact cards instead of a table.

---

## 8. Resources

### Managing Team Members

1. Navigate to the project's **Resources** section.
2. Add team members by assigning them to the project.
3. Set each resource's role, availability, and hourly rate.

### Workload Heatmap

The workload heatmap shows resource utilization across time:

- **Green** -- Under-allocated (available capacity).
- **Yellow** -- Optimally allocated.
- **Red** -- Over-allocated (overloaded).

Each cell displays **actual/allocated hours** (e.g., "28/40h") with the utilization percentage below. Hover over a cell for a detailed tooltip showing allocated, actual, capacity, utilization %, and cost. Click a resource name to open their **Resource Profile** modal.

### Bulk Resource Import

Click **Import CSV** on the Team sub-tab to import resources in bulk:

1. Drop a CSV file or click to browse (max 5MB, 200 resources).
2. Expected columns: `name, role, email, capacityHoursPerWeek, skills, costRateHourly, resourceGroup`.
3. Skills should be semicolon-separated (e.g., `React;TypeScript;Node.js`).
4. Preview the first 5 rows before importing.
5. Results show success count and any per-row errors.

### Resource Profile

Click any resource name (in Team table or Workload Heatmap) to open the Resource Profile modal:

- **Summary cards:** Capacity/week, active assignments, utilization %, cost rate.
- **Skills:** Listed with proficiency levels.
- **Assignments table:** Current task assignments with hours/week and date range.
- **Utilization trend:** Embedded 12-week chart showing planned vs actual vs capacity.

### Overtime Rates

Resources can have an **overtime rate** separate from the standard cost rate:

- Set the "OT Rate ($/hr)" when creating or editing a resource.
- Time entries with `rate_type = 'overtime'` are costed at the overtime rate.
- If no overtime rate is set, the system defaults to 1.5× the standard rate.

### Role Capacity Planning

The **Role Capacity** sub-tab shows a 12-week capacity vs demand view grouped by role:

- Each row is a role (e.g., Developer, Designer) showing resource count and total weekly capacity.
- Cells are color-coded: **Green** (surplus >20%), **Yellow** (tight 0-20%), **Red** (over-committed).
- Each cell shows allocated/capacity and surplus/deficit hours.

### Effort-Driven Scheduling

Mark a task as **Effort Driven** in the task edit form to have its duration auto-adjust based on resources:

1. Enter the total **Work Hours** (e.g., 80 hours of work).
2. Check **Effort Driven**.
3. When resources are assigned or removed, the duration recalculates: `duration = work_hours / total_resource_hours_per_day`.
4. End date adjusts automatically, skipping weekends.

This mirrors how MS Project and Primavera handle effort-driven tasks — adding more resources shortens the schedule, removing resources extends it.

### Resource Histogram

A bar chart showing resource demand by time period. Helps identify peaks and valleys in resource requirements.

### Resource Leveling

The resource leveling panel suggests schedule adjustments to resolve over-allocation:

- Review suggested task delay shifts.
- Accept or reject leveling recommendations.
- Apply changes to smooth resource demand.
- **Reassignment suggestions** appear below the delay table for tasks that remain over-allocated. Each row shows the current resource, a suggested alternative (with skill match score), and a "Reassign" button to immediately reassign the task.

### Capacity Chart

Shows planned capacity vs. actual demand for each resource, helping identify where additional resources may be needed.

### Resource Forecast

AI-powered forecasting of future resource bottlenecks based on current task assignments and capacity (configurable up to 8 weeks ahead).

### Rebalance Suggestions

The system analyzes workload across resources and suggests task reassignments to balance the team's load more evenly.

### Resource Availability Calendar

Each resource has an availability calendar in the Team tab. Use it to define when a resource is unavailable or has reduced hours:

1. Select a resource from the dropdown in the Team tab.
2. Click **Add Block** to define an availability entry.
3. Set the date range, type (Vacation, Holiday, Unavailable, or Reduced Hours), and optional note.
4. For Reduced Hours, specify the hours per day available.

The calendar displays a color-coded month view: red for vacation, blue for holiday, gray for unavailable, amber for reduced hours. Navigate months with the arrow buttons. Existing blocks appear in a list below the calendar and can be deleted.

Workload calculations automatically account for availability — if a resource has vacation during a week, their effective capacity is reduced proportionally.

---

## 9. Workflows

PM Assistant includes a DAG (Directed Acyclic Graph) workflow engine for automating project processes.

### Creating a Workflow

There are two ways to create a workflow:

**Option A: Generate with AI**

1. Navigate to **Workflows** in the sidebar.
2. In the **Generate with AI** panel, describe your workflow in plain English (e.g., "When a task is marked complete, notify the project manager and log the activity").
3. Click **Generate** — the AI creates a complete workflow definition.
4. Review and edit the generated nodes and edges in the form below.
5. Click **Create Workflow** to save.

**Option B: Manual creation**

1. Navigate to **Workflows** in the sidebar.
2. Click **New Workflow**.
3. Define the workflow:
   - **Name** -- Descriptive workflow name.
   - **Description** -- What this workflow automates.
   - **Project** (optional) -- Scope to a specific project, or leave global.

### Workflow Nodes

Build your workflow by adding nodes of these types:

| Node Type   | Purpose |
|-------------|---------|
| **Trigger** | Starts the workflow (e.g., task status change, priority escalation, task creation, overdue detection). |
| **Condition** | Evaluates a rule and branches the flow (if/else logic). |
| **Action** | Performs an automated step (e.g., update task status, send notification, invoke agent). |
| **Approval** | Pauses execution until a designated approver accepts or rejects. |
| **Delay** | Waits for a specified duration before continuing. |
| **Agent** | Invokes an AI agent capability (e.g., auto-reschedule) with retry logic. |

### Connecting Nodes

- Draw edges between nodes to define the execution flow.
- Edges can have condition expressions that determine which path to follow.
- Edges can be labeled and sorted for readability.
- The graph must be acyclic (no circular loops).

### Positioning

Each node has optional X/Y position coordinates for visual layout in the workflow editor.

### Triggering a Workflow

Workflows can be triggered:

- **Manually** -- By providing an entity type (e.g., "task") and entity ID.
- **Automatically on task events** -- Creating or updating a task fires matching triggers (status_change, task_created, priority_change, assignment_change, dependency_change).
- **Automatically on project events** -- Budget or status changes on projects fire budget_threshold and project_status_change triggers.
- **Automatically by overdue scanner** -- A 15-minute cron scans for newly-overdue tasks and fires date_passed triggers.

All automatic triggers are non-blocking and will not slow down the originating operation.

### Execution History

Each workflow run creates an execution record:

- View the status of each node in the run (pending, running, completed, failed, waiting_approval).
- See timestamps for when each node started and completed.
- Review input/output data for each step.

### Resuming Approvals

When a workflow reaches an **Approval** node:

1. The workflow pauses and a notification is sent to the approver.
2. The approver reviews the context and either approves or rejects.
3. Use the **Resume** action on the paused node, providing the approval result.
4. The workflow continues along the appropriate branch.

---

## 10. Sprints

For teams using agile methodology, PM Assistant supports sprint-based work management.

### Sprint Tab Header

The Sprint tab header provides at-a-glance status:

- **Active sprint progress bar** -- Colored bar showing task completion percentage for the active sprint (amber < 50%, blue 50-99%, green at 100%).
- **Day progress** -- "Day X of Y" label with a mini bar showing elapsed time in the sprint timebox.
- **View switcher** -- When a sprint is selected, toggle between List, Planning, Board, Burndown, Flow, and Capacity views.

### Sprint List

All sprints are displayed as clickable cards. Click a sprint to open it in the Planning view.

- **Status badges** -- Color-coded badges (Planning, Active, Completed, Cancelled).
- **Active sprint highlight** -- Active sprints have a blue left border and tinted background.
- **Progress bars** -- Each sprint card shows task completion progress with point totals.
- **Sorting** -- Click the sort toggle to cycle between Status (active first), Date (newest first), and Name (alphabetical) order.
- **Velocity sparkline** -- A mini SVG chart in the list header shows velocity trend across the last 6 completed sprints.
- **AI Retrospective** -- Completed sprints show a book icon. Click it to generate an AI-powered retrospective summary.

### Creating a Sprint

1. Open a project and navigate to the Sprints tab.
2. Click **New Sprint**.
3. Fill in:
   - **Name** -- e.g., "Sprint 14".
   - **Goal** -- What the team aims to achieve.
   - **Start Date / End Date** -- Sprint timebox.
   - **Velocity Commitment** -- Target story points.
4. Click **Create Sprint**.

### Sprint Planning

The Sprint Planning Panel shows a two-column layout:

- **Backlog** (left column) -- Tasks not yet assigned to a sprint.
  - **Search bar** -- Type to filter backlog tasks by name or assignee.
  - **Priority filter** -- Dropdown to show only urgent, high, medium, or low priority tasks.
  - The backlog count in the header always shows total unfiltered count.
- **Sprint backlog** (right column) -- Tasks added to the current sprint with running point total.

Click the **+** button on a backlog task to add it to the sprint, or the trash icon on a sprint task to remove it. Each task card shows name, status badge, priority badge, and story points.

### Starting a Sprint

Once planning is complete, click **Start Sprint** to begin. The sprint status changes from "planning" to "active".

### Sprint Board

During an active sprint, the sprint board provides a Kanban-style view with three columns (Todo, In Progress, Done):

- **Drag-and-drop** -- Drag cards between columns to update task status. The UI updates immediately (optimistic update) while the API call completes in the background.
- **WIP limits** -- Click the gear icon on any column header to set a work-in-progress limit. The column highlights amber when at or over the limit.
- **Swimlanes** -- Click the **Swimlane** toggle to group tasks by assignee. Each group shows an avatar header with task count.
- **Assignee avatars** -- Each card shows the assignee with a colored avatar circle. Colors are deterministic (same person always gets the same color from an 8-color palette).
- **Story points** -- Column headers show per-column point totals. The board header shows total points across all tasks.

### Sprint Burndown Chart

Track sprint progress with the interactive burndown chart:

- **Ideal burndown** -- A dashed gray line from total points to zero.
- **Actual burndown** -- Solid indigo line showing real remaining story points over time.
- **Today marker** -- A vertical dashed amber line at the current date.
- **Hover tooltips** -- Hover any data point to see the date, remaining points, and ideal comparison.
- **Summary tiles** -- Four metric tiles above the chart: Total, Completed, Remaining (points), and Days Left.
- If the actual line is above the ideal line, the team is behind pace.

### Velocity Chart

View historical velocity across completed sprints. The chart shows story points completed per sprint, helping calibrate future commitments. The sprint list header also includes a velocity sparkline for quick trend visibility.

### Completing a Sprint

When the sprint period ends:

1. Click **Complete Sprint**.
2. Review completed vs. incomplete tasks.
3. Incomplete tasks can be moved to the next sprint or back to the backlog.

### Dark Mode & Mobile

All sprint views fully support dark mode with appropriate contrast for cards, badges, charts, and SVG elements. On mobile devices, layouts use flex-wrap with condensed button labels and adjusted column widths for comfortable use on small screens.

### Mobile Responsiveness (UI Improvement Sprint)

Additional responsive improvements were made across several pages:

- **Notifications & Agent Proposals** — Summary stat cards reflow into a 2-column grid on mobile (4 columns on wider screens).
- **Goals** — The create/edit modal form stacks its fields into a single column on mobile.
- **Resource Management** — The tab bar scrolls horizontally on mobile; the resource table also scrolls horizontally rather than clipping content.
- **Project Detail** — Action buttons are condensed on small screens (some labels hidden); the tab bar scrolls horizontally instead of wrapping onto a second line.
- **Portfolio** — Wide data tables (Project Comparison, CPI/SPI, Resource Utilization) have a minimum width so they scroll horizontally rather than collapsing columns.

---

## 11. Time Tracking

### My Timesheet

1. Navigate to **Timesheets** in the sidebar.
2. The **My Timesheet** tab shows a weekly grid grouped by project and task.
3. Project names and task names are displayed (not internal IDs).
4. Log hours for each task by day:
   - Enter hours in the grid cells.
   - Add optional notes for each entry.
5. Deleting a time entry requires confirmation before removal.
6. The system tracks total hours per task and per day.

### Logging Time from the Timesheet Page

Click the **"Log Time"** button at the top of the Timesheet page to open an inline form without leaving the page:

1. Select a **Project** from the dropdown.
2. Select a **Schedule** (filtered to the chosen project).
3. Select a **Task** (filtered to the chosen schedule).
4. Set the **Date** and enter the number of **Hours**.
5. Add an optional **Description**.
6. Click **Save** to create the time entry. The weekly grid refreshes automatically.

### Project Summary

Switch to the **Project Summary** tab to see:

- **Actual vs. Estimated Chart** -- A comparison of logged hours against original estimates for each task.
- Identifies tasks that are consuming more effort than planned.
- Helps improve future estimation accuracy.

### Time Entries

Each time log entry records:

- The task and schedule.
- Hours worked.
- Date of work.
- Optional description/notes.

### Submitting a Timesheet for Approval

Once you have logged your hours for a week, you can submit them to your project manager for approval.

1. Navigate to **Timesheets** in the sidebar and open the **My Timesheet** tab.
2. Your entries appear grouped by project. Each entry shows a status badge: **gray** = draft, **blue** = submitted, **green** = approved, **red** = rejected.
3. Submitted and approved entries display a lock icon and cannot be edited. Rejected entries remain editable so you can correct them directly.
4. Click **Submit for Approval** on a project group to submit all draft entries for that week and project together.
5. A blue status banner appears at the top confirming the submission is pending review.

**If your timesheet is rejected:**

- A red banner appears with the rejection reason provided by your manager.
- Rejected entries stay in **rejected** status but are fully editable — you can update hours, descriptions, and dates directly.
- Fix the entries and click **Submit for Approval** again to resubmit.

**Recalling a submission:**

- If your manager has not yet reviewed the submission, click the **Recall** button on the project group.
- Entries revert to **draft** and you can edit them before resubmitting.

### Approving Timesheets (Managers)

Project managers and owners see an **Approvals** tab on the Timesheet page.

1. Click the **Approvals** tab to open the **Timesheet Approval Panel**.
2. The panel lists all pending submissions across your projects, showing the submitter, project, week, total hours, and individual entries.
3. To approve: click **Approve**. The submitter receives an approval notification.
4. To reject: click **Reject**, enter a reason (required), and confirm. The submitter receives a high-severity notification with your reason and their entries revert to draft for correction.

---

## 12. Reports

Navigate to **Reports** in the sidebar to access the report catalog. The page is organized into a persistent **project selector** at the top and **5 collapsible category sections** with clickable report tiles.

### Selecting a Project

Use the project dropdown at the top of the Reports page to choose which project to report on. All reports (both AI and instant) are generated for the selected project. A project must be selected before generating any report.

### Report Categories

Reports are organized into 5 categories. Click a category header to expand or collapse it:

1. **Project Status** — Status Report (AI), RAID Report (data-driven)
2. **Schedule & Risk** — Strategic Risk Scan (AI), Milestone Report, Critical Tasks, Late & Slipping Tasks
3. **Resources** — Resource Utilization (AI), Resource Overview, Who Does What, Resource Availability, Resource Status, Who Does What When
4. **Budget & Cost** — Budget Forecast (AI), Risk Assessment (AI), Resource Cost Overview, Cost Overview, Earned Value Summary, Overbudget Resources
5. **AI Analysis** — all AI-powered report types grouped together

Each tile shows the report name, a brief description, and a badge indicating whether it is an **AI** report or an **Instant** report.

### Generating Instant Reports

Click any tile marked **Instant** to generate it immediately:

1. Select a project in the project selector.
2. Click the report tile (e.g., Milestone Report, Critical Tasks, Resource Overview).
3. The report is generated instantly from live project data and displayed in a modal.
4. Use the **PDF** or **HTML** export buttons in the modal to download the report.

Instant reports do not use AI and return results immediately — no waiting for background processing.

**Available instant reports include:**

- **Resource Status** — Dashboard overview showing resource counts by role and group, utilization distribution across five buckets (0%, 1–50%, 51–80%, 81–100%, >100%), average utilization percentage, overallocated resource count, and total capacity hours.
- **Who Does What When** — Time-phased weekly breakdown of each resource's task assignments. Shows hours per task per week, total hours across the reporting window, and available capacity per week. Useful for sharing individual workload plans with stakeholders.
- **Overbudget Resources** — Lists only resources where actual cost exceeds planned cost. Shows planned vs. actual hours and costs, variance amount, and variance percentage for each resource. Resources within budget are not shown.

### Generating AI Reports

Click any tile marked **AI** to start an AI-powered report:

1. Select a project in the project selector.
2. Click the report tile (e.g., Budget Forecast, Risk Assessment, Resource Utilization).
3. The report generates in the background. You will see a "generating" confirmation and receive a toast notification when the report is ready.
4. The report appears in the Report History table below and can be viewed, downloaded, or emailed.

For **Status Reports** and **RAID Reports**, a modal opens with additional options (editing, email delivery, scheduling, and multi-format export). For **Strategic Risk Scan**, the scan runs in the background and the finished report is delivered via WebSocket.

### See Also

The Reports page includes links to the **EVM Dashboard** and **Monte Carlo Simulation** pages for deeper analytical views beyond standard reports.

### Report Builder

For custom reports, use the **Report Builder**:

1. Navigate to **Report Builder** in the sidebar.
2. Click **New Report** to open the report designer.
3. Configure report sections:
   - Choose data sources (tasks, resources, time entries, EVM metrics).
   - Add filters (by project, date range, status, assignee).
   - Select visualization types (tables, bar charts, line charts, pie charts).
   - Arrange sections in the desired order.
4. Save the report template with a name and description.
5. Mark as **Shared** to make it available to other team members.

### Report History

All generated reports appear in the **Report History** table below the report catalog. Use the filter bar to find reports quickly:

- **Filter by type** — use the dropdown to select a report category. AI Reports expand into sub-types (Weekly Status, Risk Assessment, Budget Forecast, Resource Utilization). You can also filter by Status Reports, RAID Reports, or Instant Reports.
- **Date range** — set **From** and **To** dates to narrow results to a specific period.
- **Search** — type a keyword and press Enter to search by report title.
- **Sort** — click the **Title** or **Date** column headers to sort ascending or descending.
- **Clear** — click the **Clear** button to reset all filters at once.
- **View** — click any row to open a full preview with proper formatting. Report content is fetched on demand when you click a row, keeping the history list fast to load.
- **Download** — click the download icon in the viewer to save as HTML.
- **Delete** — click the trash icon to remove a report from history.
- **Pagination** — reports are shown 20 per page. Use the page controls to navigate.
- **Content storage** — **Status reports** are kept permanently for your records. **AI reports** (risk, budget, resource) are available for download when generated but are not stored long-term — they can always be regenerated from current project data, which gives you a fresher result anyway. Reports without stored content show an **EXPIRED** badge; click to see a **Regenerate** button.

> **Note:** Regular users can delete report templates they created. Deleting another user's template still requires an admin role. When updating a template in the Report Designer, all configured sections are saved correctly.

> **Trial accounts:** If you are on a trial plan, the Report Builder shows 3 sample templates (Weekly Status, Budget Overview, Time Tracking) so you can preview the feature. The New Report, Edit, Generate, and Delete buttons are replaced with an "Upgrade to use" label. An amber banner at the top of the page identifies the templates as samples. Upgrade to a paid plan to create and run your own custom report templates.

### Scheduled Reports

The **Scheduled Reports** section appears on the Reports page between the Favorites row and the Report Categories. It shows all recurring report schedules you have created.

#### Viewing Your Schedules

The section displays a table with the following columns:

| Column | Description |
|--------|-------------|
| **Report** | The report template name |
| **Project** | The project the report runs against |
| **Frequency** | Daily, Weekly (day of week), or Monthly (day of month) |
| **Next Run** | Date and time of the next scheduled delivery |
| **Status** | Active, Paused, or Error |
| **Actions** | Edit, Pause/Resume, Run Now, Delete |

#### Creating a Schedule

1. Click **Schedule Report** (top-right of the Scheduled Reports section).
2. In the modal, select a **project** from the dropdown.
3. Choose the report template, frequency, delivery time, and recipient email addresses.
4. Click **Save** to activate the schedule.

#### Managing Schedules

- **Edit** — click the edit icon to reopen the schedule modal with all fields pre-filled. Change any setting and save.
- **Pause / Resume** — click to toggle the schedule on or off without deleting it. Paused schedules are skipped by the delivery cron job.
- **Run Now** — click to deliver the report immediately, regardless of when the next scheduled run is. Useful for sending a one-off delivery on demand.
- **Delete** — removes the schedule permanently after a confirmation prompt.

> **Note:** If you opened the schedule modal from a specific report tile, the project and report type are pre-filled from the page context. If you click **Schedule Report** from the section header, you must select both the project and the report template manually.

### Analytics Dashboard

The **Analytics** page provides a summary dashboard with key metrics across all projects, including task completion rates, budget utilization, and schedule adherence.

---

## 13. Monte Carlo Simulation

Monte Carlo simulation uses random sampling to model schedule uncertainty and produce probabilistic forecasts.

### Running a Simulation

1. Navigate to **Simulation** in the sidebar.
2. Select a **Project** and **Schedule**.
3. Configure simulation parameters:
   - **Iterations** -- Number of simulation runs (e.g., 1,000 or 10,000). More iterations produce smoother results.
   - **Uncertainty Model** -- The probability distribution for task duration variability (e.g., triangular, PERT, normal).
4. Click **Run Simulation**.

> **Trial accounts:** If you are on a trial plan, clicking Run Simulation returns a sample simulation with demo data instead of running against your actual schedule. An amber banner at the top of the results identifies it as a sample. Upgrade to a paid plan to run simulations on your real project data.

### Interpreting Results

The simulation produces several outputs:

#### Histogram

A frequency distribution of possible project completion dates. The X-axis shows duration in days; the Y-axis shows the number of iterations that resulted in that duration. The cumulative percentage line shows the probability of finishing by a given date.

#### Confidence Levels

A table of key percentiles:

| Percentile | Meaning |
|------------|---------|
| P50 | 50% chance of completing by this date |
| P80 | 80% chance -- a common planning target |
| P90 | 90% chance -- conservative estimate |

#### Tornado Diagram (Sensitivity Analysis)

Ranks tasks by their impact on overall schedule variance. Tasks at the top of the tornado have the highest correlation with project duration -- they are your biggest sources of risk.

#### Criticality Index

Shows how often each task appeared on the critical path across all iterations (as a percentage). Tasks with high criticality are frequently critical even when durations vary.

#### Cost Forecast

If cost data is available, the simulation also produces probabilistic cost forecasts (P50, P80, P90, mean, and standard deviation).

#### Statistics

- **Mean duration** -- The average project duration across all iterations.
- **Standard deviation** -- The spread of possible outcomes.
- **Min/Max** -- The best-case and worst-case durations observed.

---

## 14. AI Features

PM Assistant integrates AI capabilities throughout the platform (requires AI to be enabled in your environment).

### Natural Language Queries (AI Query)

All AI surfaces are grouped under the **Mjuzi AI** section in the sidebar. "Ask AI" has been renamed to **AI Query** and the Agent Proposals page is now **AI Proposals**.

1. Navigate to **AI Query** in the sidebar under Mjuzi AI.
2. Type a question in plain English, such as:
   - "Which tasks are overdue across all projects?"
   - "What is the budget utilization for Project Alpha?"
   - "Show me a breakdown of task status by assignee."
3. The AI returns a written answer, often accompanied by auto-generated charts (bar, line, pie, or doughnut).
4. **Suggested follow-ups** appear below the answer for deeper exploration.

> **Trial accounts:** If you are on a trial plan, submitting a query returns a **sample response** with demo data — a short narrative answer, a sample bar chart showing task status across fictitious projects, and 3 suggested follow-up questions. An amber banner at the top of the page identifies it as a sample. No AI tokens are consumed. Upgrade to a paid plan to query your real project data.

### Mjuzi AI Chat Panel

**Mjuzi** is your AI project assistant, available as a persistent slide-out **Mjuzi AI Chat** panel from any page:

- Click the AI chat icon to open the side panel.
- Ask questions about the current context (project, schedule, task).
- Mjuzi is aware of the page you are on and can provide contextual answers.
- Includes **Quick Actions** for common operations.

**Conversation history**

- Your conversations are saved and persist across sessions (even after server restarts).
- Click the **History** button (clock icon) in the chat header to browse past conversations.
- Click any conversation to reload it and continue where you left off.
- Click the **+** button to start a new conversation.
- Mjuzi remembers past interactions about a project and incorporates agent scan findings for richer, more informed responses.

**Self-learning**

- **Preferences**: Tell Mjuzi how you like your responses and it will remember across sessions. Examples: "keep it brief", "always include budget numbers", "I prefer bullet points over tables". Mjuzi stores these and applies them to all future conversations.
- **Corrections**: If Mjuzi gets a fact wrong, correct it and it will remember. Example: "No, the budget is $50K not $30K." Mjuzi stores the correction and won't repeat the mistake. Project-specific corrections stay scoped to that project.

**Voice input and spoken replies**

- **Speak your message:** If your browser supports it, a **microphone** button appears next to the chat input. Click it, speak your question (e.g. “What projects are in trouble?” or “What’s my portfolio spend to date?”), and your words are sent as a normal chat message. Click the mic again to stop listening.
- **Speak replies:** Check **Speak replies** below the input to have Mjuzi’s answers read aloud when each reply is complete. Uncheck to turn this off. The welcome message is never spoken.
- Voice uses the same AI chat as typing: you can say anything you could type and get the same smart, contextual answer.

### AI Task Breakdown

1. Open a project schedule.
2. Click **AI Task Breakdown** in the action bar.
3. Provide a brief project description.
4. The AI generates a structured set of tasks with suggested durations, dependencies, and assignments.
5. Review, adjust, and save the generated tasks.

### AI Task Prioritization

The Task Prioritization Panel analyzes your backlog and suggests an optimal task ordering based on dependencies, deadlines, resource availability, and priority.

### Meeting Intelligence

1. Navigate to **Meetings** in the sidebar.
2. Paste or type a meeting transcript.
3. Select the associated project and schedule.
4. Click **Process**. The AI extracts:
   - **Summary** -- Concise meeting recap.
   - **Action items** -- Tasks identified from discussion, with suggested assignees and due dates.
   - **Decisions** -- Key decisions recorded.
   - **Risks** -- Potential issues mentioned.
5. Action items can be converted directly into schedule tasks.

> **Trial accounts:** If you are on a trial plan, clicking Process returns a **sample meeting analysis** with demo data — a brief summary, 3 sample action items (with assignees and due dates), 2 sample decisions, 1 sample risk, and 1 task update suggestion. An amber banner at the top of the page identifies it as a sample. The **Apply Changes** button (to convert action items into tasks) and the meeting **History** list are hidden or disabled for trial users. No AI tokens are consumed. Upgrade to a paid plan to process your real meeting transcripts.

> **Trial accounts — Stakeholder Portal:** If you are on a trial plan, the Portal Links page shows 2 sample portal links (Stakeholder Review Portal, Executive Dashboard) with an amber banner instead of your real links. The **Create Link** button is hidden. Upgrade to a paid plan to create and share real stakeholder portals.

> **Trial accounts — Workflow Automation:** If you are on a trial plan, the Workflows page shows 3 sample workflow definitions (Task Status Notification, Overdue Escalation, Budget Alert) with an amber banner. The **New Workflow** button and AI Generate section are hidden. Upgrade to a paid plan to build and run your own automations.

> **Trial accounts — Resource Management:** If you are on a trial plan, the Resource Management page shows 4 sample resources (Project Manager, Developer, QA Engineer, Designer — with skills and hourly rates) with an amber banner. The **Add Resource** button is hidden. Upgrade to a paid plan to manage your real team resources.

> **Trial accounts — Auto-Reschedule:** If you are on a trial plan, the Auto-Reschedule panel shows 3 sample detected delays (API Integration, Database Migration, UI Redesign) and 1 sample AI proposal with an amber banner. The **Generate Proposal** button is disabled. No AI tokens are consumed. Upgrade to a paid plan to run AI-powered reschedule analysis on your real schedule.

> **Trial accounts — API Keys:** If you are on a trial plan, the API Keys tab in Settings shows 2 sample keys (CI/CD Pipeline, Dashboard Read-Only) with an amber banner. The **Create Key** button is hidden. Upgrade to a paid plan to generate real API keys for programmatic access.

### AI Summary Banner

On the dashboard, the **Portfolio Intelligence** banner provides an AI-generated portfolio health summary, risk breakdown, budget status, and key insights. An optional AI narrative section (toggleable via accessibility settings) provides a plain-language summary tailored to your context.

### Auto-Reschedule

When delays are detected, the AI can suggest schedule adjustments that minimize overall project impact. Review and accept or reject proposed changes.

### Task Slip Predictions

In the **AI Insights** tab of any project, the Task Slip Predictions section shows which tasks are most likely to slip. Each task is scored (0-100%) based on:

- Whether it's already overdue
- Progress gap (actual vs expected)
- Incomplete predecessor tasks
- Task duration (longer = higher risk)

Tasks are shown sorted by slip probability with color-coded bars and suggested actions.

### Scope Creep Detector

Also in the **AI Insights** tab, the Scope Creep Detector compares the current project state against its baseline. It shows:

- New tasks added since the baseline
- Estimate growth (total days added)
- Open change requests
- Schedule health percentage

A severity badge (Low/Medium/High/Critical) flags the degree of scope drift. Create a baseline first to enable this feature.

### Status Report Generator (DBJ Template Standard)

Navigate to the **Reports** page, select a project, and click the **Status Report** tile in the Project Status category to generate an AI-powered executive status report following the DBJ Template Standard. The report contains 8 structured sections and is rendered as styled HTML. The modal has three tabs:

- **Report** — View the generated report with 8 sections:
  1. **Header Metadata** — Report number (SR-001, SR-002, … auto-incrementing per project), reporting period (last 14 days with start and end dates), prepared-by name, and generation date
  2. **Executive Summary** — AI-generated paragraph on overall project health and outlook for the period
  3. **Overall Status (RAG Traffic Light Dashboard)** — Table with 7 dimensions. Each row shows previous status, current RAG status (🟢🟡🔴), trend arrow (↑→↓), and comments:
     - **Overall Status** — Automatically shows the worst RAG across all other dimensions
     - Schedule, Budget, Resources, Risks, Scope / Change Control, **Governance & Stakeholders**, Quality
  4. **Milestone Status** — Table of project milestones (tasks marked as milestones) with baseline date, forecast/actual date, and RAG status
  5. **Achievements This Period** — Tasks completed in the last 14 days, automatically gathered from your project data
  6. **Planned Activities Next Period** — Tasks due in the next 14 days, sourced from your project schedule
  7. **For Management Attention** — Critical and high-severity RAID items needing leadership action, each with an impact-if-delayed consequence statement
  8. **Change Control** — Active change requests showing title, status, priority, and impact (data-driven, no AI)

#### Editing the Report

  Click the **Edit** button to modify any section before sending or exporting. In edit mode you can:
  - Rewrite the executive summary
  - Change RAG statuses (green/amber/red) for each dimension and update commentary
  - Edit milestone comments
  - Add, remove, or modify achievement and planned activity bullet items
  - Update management attention items and change control rows

  Click **Save** to apply your edits and re-render the report. Click **Cancel** to discard changes. Edits are reflected in the email, PDF, and Word exports — what you see is what gets sent.

#### Exporting the Report

  Three export formats are available via the toolbar buttons:
  - **HTML** — Download the styled report as a `.html` file
  - **PDF** — Generates a PDF directly in your browser (A4 format, high resolution)
  - **Word (.docx)** — Downloads a professionally formatted Word document with proper styling: navy header rows, RAG cells with background colors (green/amber/red), Calibri font, and full-width tables. Section headings stay with their content across page breaks, and table headers repeat on multi-page tables.

- **Email Report** — Enter comma-separated email addresses and send the displayed report (including any edits) directly to stakeholders in branded HTML format with all 8 sections.
- **Schedule Recurring** — Set up automatic report delivery on a daily, weekly, or monthly cadence. Choose the day of week/month, time, and recipients. View and delete existing schedules from this tab.

The report tracks trends by comparing against the previous report — if Schedule was Green last week and is now Amber, the trend arrow shows ↓ (declining). The Overall Status row always reflects the worst individual dimension: if any dimension is Red, Overall Status is Red. Report numbers increment automatically so you can reference specific reports (e.g., "as noted in SR-003"). Scheduled reports run automatically via the report scheduler cron and email the report to all configured recipients. Requires a paid subscription (Consultant, SME, or Enterprise tier).

**Trial users:** Instead of an error, a **sample report** is shown with realistic demo data so you can preview the format. An amber banner at the top identifies it as sample data. The Email, Schedule, Export, and Download options are locked — upgrade to a paid plan to generate live AI-powered reports for your project.

### Strategic Risk Analysis (Risk Scan)

The Risk Scan analyzes your project's structure to identify risks that are not visible from individual tasks — schedule compression, resource bottlenecks, dependency chains, milestone clustering, and budget trajectory issues.

#### Running a Risk Scan

1. Navigate to the **Reports** page.
2. Select a project from the project selector at the top.
3. Click the **Strategic Risk Scan** tile in the Schedule & Risk category.
4. A progress indicator appears while the analysis runs in the background.
5. When complete, a modal opens displaying the risk findings organized by category.

#### Understanding the Results

The scan produces findings across five categories:

- **Schedule Risk** — Tasks that are overdue or at risk of slipping, compressed timelines, and critical path vulnerabilities.
- **Resource Risk** — Over-allocated team members, single points of failure (one person on too many critical tasks), and skill coverage gaps.
- **Dependency Risk** — Long dependency chains where a single slip cascades through many tasks, and tasks with excessive predecessors.
- **Milestone Risk** — Milestones clustered too closely together, milestones without supporting tasks, and milestones on the critical path with insufficient float.
- **Budget Risk** — Burn rate outpacing progress, cost overrun trajectories, and unfunded remaining work.

Each finding has a severity level (Critical, High, or Medium) based on configurable thresholds. When AI is enabled on a paid plan, the findings are enhanced with refined descriptions and cross-category insights — for example, flagging when a resource bottleneck coincides with a critical-path milestone.

#### Exporting the Results

Two export formats are available via toolbar buttons:

- **PDF** — Download the risk analysis as a PDF document.
- **HTML** — Download the styled report as an `.html` file.

Results are generated on demand and not stored — run the scan again at any time for a fresh analysis based on current project data.

**Trial users:** A **sample risk scan** is shown with realistic demo findings across all five categories. An amber banner identifies it as sample data. Export buttons are locked — upgrade to a paid plan to run live risk analysis on your project.

---

## 15. Templates

Templates let you save and reuse project structures.

### Saving a Template

1. Open a project with a well-defined schedule.
2. Click **Save as Template**.
3. Enter a template name and description.
4. The template captures the full task hierarchy, dependencies, durations, and structure (but not specific dates or assignments).

### Using a Template

1. When creating a new project or schedule, click **Use Template** or open the **Template Picker**.
2. Browse available templates. Each shows a preview card with the template name, description, and task count.
3. Click **Preview** to see the full task structure before applying.
4. Click **Apply** to populate your schedule with the template's tasks.

### Customizing a Template

After selecting a template, the **Template Customize Form** lets you:

- Adjust task names and durations.
- Remove tasks you do not need.
- Set a project start date (all task dates shift accordingly).

---

## 16. Integrations

Connect PM Assistant to external tools for bidirectional synchronization.

### Supported Providers

| Provider | Capability |
|----------|-----------|
| **Jira** | Sync tasks with Jira issues. Import/export task status, priority, and assignments. |
| **GitHub** | Link GitHub issues and pull requests to project tasks. Track development progress. |
| **Slack** | Event notifications, `/kovarti status` slash command, interactive proposal approval buttons. |
| **Trello** | Sync cards with project tasks. |

### Setting Up an Integration

1. Navigate to **Integrations** in the sidebar.
2. Click **Configure** on the desired provider.
3. In the configuration modal, enter the required credentials:
   - **Jira** -- Server URL, API token, project key.
   - **GitHub** -- Repository, personal access token.
   - **Slack** -- See [Slack Setup](#slack-setup) below.
   - **Trello** -- API key, board ID.
4. Click **Save** to create the integration.

### Syncing

- Click **Sync Now** to manually trigger a synchronization.
- View the **Sync Log** panel to see a history of sync operations, including timestamps, status, and any errors.
- Integrations can be enabled/disabled with a toggle without deleting the configuration.

### Slack Setup

#### Connecting Slack to a Project

1. Navigate to **Integrations** in the sidebar and click **Configure** under Slack.
2. In the **Slack Configuration** modal:
   - **Project** — Use the dropdown to select the project this integration applies to. Each Slack integration is scoped to one project; create multiple integrations for multiple projects.
   - **Webhook URL** — Paste the incoming webhook URL from your Slack App (Settings > Incoming Webhooks in the Slack API portal).
   - **Event Filters** — Check the event types you want to send to Slack. Available events:
     - Task Assigned
     - Task Completed
     - Deadline Approaching
     - Budget Alert
     - Meeting Followup
     - Member Added
     - Risk Created
     - Sprint Started
     - Sprint Completed
     - Project Status Changed
     - Agent Proposal Created
3. Click **Save**.

#### Notification Preferences

In **Settings → Notifications**, the notification category table now has a **Slack** column alongside In-App and Email. Toggle Slack on or off per category to control which event types are forwarded to your connected Slack channels. Turning off a category's Slack toggle does not affect in-app or email delivery.

#### What Slack Messages Look Like

Notifications arrive as formatted Slack Block Kit messages. Key event types have dedicated layouts:

- **Task Assigned** — shows task name, assignee, due date, and a link to the task.
- **Deadline Approaching** — shows task name, days remaining, and priority badge.
- **Budget Alert** — shows amount spent vs. budget, burn rate, and cost variance.
- **Meeting Followup** — shows meeting summary, action items, and decisions.
- **Member Added** — shows the new member's name and project role.
- All other events use a standard notification card with title, body, and a direct link button.

#### Slash Command

Type `/kovarti status My Project` in any Slack channel to get a formatted project status card. This requires the slash command to be registered in your Slack App and pointing to `https://your-domain/api/v1/slack/commands`.

#### Interactive Proposal Buttons

When the AI agent creates a proposal, a Slack message is sent with **Approve** and **Reject** buttons. Clicking either button records the review decision and logs the Slack username in the project audit trail.

#### Sending Messages from Agents or Workflows

Agents and workflow actions can push ad-hoc messages to a project's Slack channels using the `send-slack-message` MCP tool or the internal `POST /api/v1/slack/send` endpoint. This is also available as `test-slack-connection` (sends a ping to verify the webhook is live) and `list-slack-channels` (lists all configured channels for a project) via MCP.

---

## 17. Intake Forms

Intake forms provide a structured way to collect and process new project requests.

### Designing a Form

1. Navigate to **Intake** in the sidebar.
2. On the **Forms** tab, click **New Form**.
3. Use the **Intake Form Designer** to:
   - Add fields (text, number, date, dropdown, etc.).
   - Set required/optional flags.
   - Configure validation rules.
   - Arrange field order.
4. Save the form.

### Submitting a Request

1. On the **Submissions** tab (or via a shared link), open a form.
2. Fill in all required fields.
3. Click **Submit**. The submission enters the review pipeline.

### Reviewing Submissions

Submissions flow through a status pipeline:

- **Submitted** -- Awaiting review.
- **Under Review** -- Being evaluated.
- **Approved** -- Accepted for project creation.
- **Rejected** -- Declined with reason.
- **Converted** -- Turned into an active project.

Reviewers can filter by status, open the Review Panel for each submission, and take action.

---

## 18. Portfolio

The **Portfolio** page provides a cross-project view of all active work with two modes selectable via a toggle in the toolbar.

### Portfolio Dashboard (default view)

The dashboard mode shows:

- **6 KPI cards** at the top of the page: Total Projects, Active, On Track, At Risk, Budget Allocated, and Budget Spent. These update as you apply status filters.
- **Status filter pills** — click All, Active, On Hold, Planning, or Completed to narrow which projects appear in the card grid below.
- **Portfolio budget progress bar** — a single bar showing aggregate budget spent vs. allocated across all currently visible projects, with a percentage label.
- **CPI/SPI Comparison Table** — side-by-side CPI and SPI values for each active project, color-coded (green ≥1.0, amber 0.85–0.99, red <0.85) with SVG sparkline trend lines showing the last 8 weeks. Click column headers to sort by CPI or SPI.
- **Burndown Trends** — mini burndown sparklines per project showing ideal (gray dashed) vs. actual (blue solid) remaining work, completion percentage, and a schedule variance badge (e.g. "+2%" green or "−5%" red).
- **Project Comparison Matrix** — sortable table comparing all projects across Health (colored dot + score), CPI, SPI, Budget %, Progress (with mini progress bar), Tasks (completed/total), and Status. Click any column header to sort ascending/descending. Click any row to navigate to the project detail page.
- **Project cards** — one card per project displaying: project name, status badge, a color-coded health indicator, an overall progress bar with percentage, a task completion ratio (e.g. "12 / 20 tasks"), and a budget utilization bar showing spend against the allocated budget. Click the project name or the arrow link on a card to navigate to the project detail page.

### Portfolio Timeline (Gantt view)

Click the **Timeline** toggle to switch to the multi-project Gantt chart:

- Each project appears as a parent row with its tasks as children.
- Aggregated progress and date ranges per project.
- Color-coded status indicators.
- Click a project row to navigate to its detail page.

Click **Dashboard** in the toggle to return to the KPI card view.

### Portfolio Resources View

Click the **Resources** toggle to see cross-project resource utilization:

- **4 KPI cards**: Total Resources, Over-Allocated, Avg Utilization, Weekly Cost.
- **Cross-project contention table** (red border): lists resources on 2+ projects with combined utilization > 100%, showing each project and its share.
- **Resource utilization table**: all resources sorted by utilization, showing role, cost rate, project count, combined utilization percentage, and assigned projects.

---

## 19. Intelligence and Scenarios

### Scenario Modeling

Navigate to **Intelligence** in the sidebar to access:

- **Portfolio Risk Heatmap** -- A matrix showing each project's health score, risk level, budget utilization, and progress. Color-coded for quick identification of problem areas.
- **Budget Reallocation** -- Identifies projects with surplus budget and those in deficit, with recommendations for reallocation.
- **Resource Conflicts** -- Flags resources assigned to overlapping tasks across projects.
- **Anomaly Detection** -- AI identifies unusual patterns (sudden cost spikes, schedule anomalies, performance outliers) with severity ratings and recommendations.

> **Trial accounts:** If you are on a trial plan, the Portfolio Intelligence and Anomaly Detection panels display **sample data** with fictitious projects and demo findings rather than your real portfolio. An amber banner at the top of the page identifies the results as samples. The **Scenario Modeling** (What-If) section remains fully gated on trial — attempting to submit a scenario shows an upgrade prompt without sample data. Upgrade to a paid plan to run intelligence analysis on your real portfolio.

---

## 20. Lessons Learned

### Recording Lessons

1. Navigate to **Lessons** in the sidebar.
2. Click **New Lesson**.
3. Fill in:
   - **Title** -- Brief description.
   - **Description** -- What happened.
   - **Category** -- e.g., Planning, Execution, Communication, Risk.
   - **Impact** -- Positive, Negative, or Neutral.
   - **Recommendation** -- What to do differently.
   - **Project** (optional) -- Associate with a specific project.
4. Save the lesson.

### Editing a Lesson

Click the **Edit** (pencil) icon on any lesson card. The lesson modal opens pre-filled with the existing values. Make your changes and click **Save** to update the record.

### Deleting a Lesson

Click the **Delete** (trash) icon on any lesson card. A confirmation modal appears asking you to confirm the deletion. Click **Delete** to remove the lesson permanently, or **Cancel** to dismiss without making changes.

### Browsing Lessons

The Lessons Learned page loads an initial set of lessons. Click **"Load More"** at the bottom of the list to fetch additional records incrementally.

### Pattern Detection

The AI analyzes your lessons learned database and identifies recurring patterns:

- **Pattern cards** show the title, description, frequency, related project types, and recommendations.
- Use patterns to proactively apply learned improvements to new projects.

### Lessons in Context — Integration Points

Lessons surface automatically at key moments so you benefit from past experience without having to search manually:

- **Dashboard Widget** — Add the "Lessons & Insights" widget from the AI group via **Customize Dashboard**. It displays trending patterns and your most recent lessons at a glance.
- **Project Closeout** — When you change a project's status to **Completed**, a prompt appears offering to run an AI analysis and extract lessons learned from that project automatically.
- **Risk & Issue Creation** — When entering a new risk or issue in the Risk form, type a title of 10 or more characters and a collapsible **Similar Lessons** panel will appear below the title field, showing relevant lessons from past projects. Expand it to review before continuing.
- **Project Kickoff** — On the **Overview** tab of any project in **Planning** status, a banner shows lessons from projects with similar types or categories. Dismiss it once you've reviewed it.

---

## 21. Agent Proposals

AI agents continuously monitor your projects for schedule delays, scope creep, and other issues. When an agent detects something actionable, it creates a **proposal** -- a recommended set of changes for human review.

Access the Agent Proposals page from the **Agent** link in the sidebar (visible to managers and admins).

### Viewing Proposals

The proposals page shows:

- **Health banner** -- Current agent system status, scan scope, daily cost, and pending proposal count.
- **Status tabs** -- Filter by All, Pending, Approved, Executed, Rejected, or Expired.
- **Proposals table** -- Each row shows the agent name, title, status badge, risk level, confidence score, and age.
- **Load More** -- Click "Load More" at the bottom of the table to fetch additional proposals. The page loads in batches to remain responsive for teams with large proposal histories.

Click any proposal row to open the detail modal.

### Proposal Detail

The detail modal displays:

- **Summary** -- A brief description of what the agent found and recommends.
- **Reasoning** -- The agent's full chain-of-thought explaining why it made this recommendation.
- **Confidence breakdown** -- Scores for data quality, historical accuracy, and model certainty.
- **Proposed actions** -- The specific changes the agent wants to make (e.g., move task dates, create change requests, send notifications). Each action shows its type, target entity, and proposed values.

### Reviewing Proposals

For **pending** proposals:

1. Read the reasoning and proposed actions carefully.
2. Optionally add a comment.
3. Click **Approve** to advance the proposal, or **Reject** to dismiss it.

### Executing Proposals

After approval, an admin can click **Execute Proposal** to apply all proposed actions to the project. Each action is executed in order with rollback support if any step fails.

### Rollback

If an executed proposal caused unintended effects, admins can click **Rollback** to reverse all changes to their original state.

### Providing Feedback

After a proposal has been executed, you can submit feedback on whether it was effective. Choose from:

- **Effective** -- The changes solved the problem.
- **Partially effective** -- Helped but didn't fully resolve the issue.
- **Ineffective** -- No meaningful impact.
- **Made worse** -- The changes had a negative effect.

Feedback improves future agent confidence scoring and proposal quality.

### Risk Levels

Each proposal has a risk level that determines its approval requirements:

| Risk Level | Meaning | Examples |
|------------|---------|----------|
| **Low** | Read-only analysis, notifications | Pattern detection, risk aggregation |
| **Medium** | Modifying task dates, updating progress | Moving a due date, adjusting estimates |
| **High** | Resource changes, dependency modifications | Reassigning team members, adding dependencies |
| **Critical** | Budget or scope changes | Reallocating budget, removing milestones |

---

## 22. Settings and Account

### Account and Billing

Navigate to **Account** in the sidebar to manage:

- **Subscription plan**: The billing page displays your current plan name based on your actual subscription tier (e.g., "Trial", "Consultant Plan", "SME Plan", or "Enterprise Plan"). Paid plans: Consultant ($19/mo or $190/yr), SME ($39/mo or $390/yr), and Enterprise ($79/mo or $790/yr). Annual billing saves ~17%. Visit the **Pricing** page to see a full feature comparison matrix across all tiers, with practical usage equivalents explaining what each token budget means (e.g., "~100 AI chats, 50 risk scans").
- **Payment method**: Managed via Stripe's secure billing portal.
- **AI usage meter**: A progress bar shows your current-month token consumption vs your effective budget (tier allowance plus any purchased top-up balance), color-coded green (<70%), amber (70–90%), or red (>90%).
- **Top-up balance**: Your remaining purchased token balance is displayed below the usage meter. Click **Buy More** to purchase additional packs instantly.
- **Token top-ups**: If you exhaust your monthly AI tokens, purchase additional packs (500K tokens for $5). Top-up tokens are added instantly and do not expire. When your monthly budget is exhausted, AI features are temporarily unavailable but all other features (scheduling, tasks, reports, collaboration) continue working normally. Your budget resets on the first of each month.

### Settings (Admin/Manager)

Navigate to **Settings** to configure:

- **User management** -- Add, edit, or deactivate users. Assign roles (admin, executive, manager, member).
- **Team & Viewers** -- Manage your team members and invite client stakeholders as viewer accounts (see [Viewer Invites](#viewer-invites) below). Available on Consultant, SME, and Enterprise plans.
- **API keys** -- Generate and manage API keys for programmatic access. Revoking a key shows a styled confirmation modal before the key is deleted.
- **Webhooks** -- Configure outbound webhook endpoints. Deleting a webhook shows a styled confirmation modal.
- **Custom fields** -- Define organization-wide custom fields that appear on tasks and projects.
- **Notifications** -- Configure notification preferences per category (Agent & Proposals, Risks & Issues, Budget & Finance, Meetings, System Alerts, Deadlines) with independent in-app and email toggles. Includes email master toggle and digest frequency. System alerts are always delivered to admin users.
- **Language** -- Select your preferred display language (English, French, or Spanish). The change applies instantly without a page reload.
- **Time Zone** -- Set your IANA timezone (e.g., `America/Toronto`). All dates in the application are displayed in this timezone.

All eight Settings tabs (Profile, Team, Notifications, Display, Accessibility, API Keys, Webhooks, Danger Zone) fully support dark mode — toggle tracks, form panels, badges, code blocks, and the danger zone section all switch correctly when dark theme is active.

**Deep linking:** You can link directly to any Settings tab using a `?tab=` query parameter, e.g., `/settings?tab=notifications` or `/settings?tab=danger`. The default tab (Profile) omits the parameter for a clean URL.

### Viewer Invites

Paid plan users (Consultant, SME, and Enterprise) can invite external client stakeholders as **viewer accounts** at no extra charge, up to their plan's limit:

| Plan | Viewer Invite Limit |
|------|---------------------|
| Trial | 0 (not available) |
| Consultant | 5 viewers |
| SME | 20 viewers |
| Enterprise | Unlimited |

**Inviting a viewer:**

1. Go to **Settings → Team & Viewers**.
2. Click **Invite Viewer**.
3. Enter the invitee's email address and select which project(s) they should have access to.
4. Click **Send Invite**. The invitee receives an email with a link to create their free viewer account.

**What viewers can do:**

- View any project they have been explicitly invited to (read-only).
- Update RAID items (risks, actions, issues, decisions) that are assigned to them.

**What viewers cannot do:**

- Create or edit projects, tasks, schedules, or resources.
- Access projects they have not been invited to.
- Invite other users.

Viewer accounts do not count against your paid seat count and cannot be upgraded to full seats from the viewer invitation flow.

Destructive actions throughout the application (deleting integrations, change requests, intake forms, report templates, goals, lessons, API keys, and webhooks) use a consistent styled confirmation modal instead of the browser's native dialog, providing a cleaner experience that respects the application's design and dark mode.

### User Roles

| Role | Permissions |
|------|-------------|
| **Admin** | Full access to all features, user management, and settings. |
| **Executive** | Read-only portfolio view, dashboards, and reports. |
| **Manager** | Create and manage projects, schedules, resources, and workflows. |
| **Member** | View assigned projects, update tasks, log time. |

### Keyboard Shortcuts

| Shortcut | Action |
|----------|--------|
| Ctrl+K / Cmd+K | Open Command Palette |
| Arrow keys | Navigate between cells in Gantt or Table View |
| Enter / F2 | Enter edit mode on the focused cell (Gantt/Table) |
| Escape | Clear cell focus / cancel edit (Gantt/Table) |
| Ctrl+C (cell focused) | Copy focused cell value to clipboard (Gantt/Table) |
| Ctrl+V (cell focused) | Paste clipboard value into focused cell (Gantt/Table) |
| Ctrl+C (no cell focused) | Copy selected/active task(s) as row copy (Gantt/Table) |
| Ctrl+V (no cell focused) | Paste copied tasks as duplicates with "(copy)" suffix (Gantt/Table) |
| Ctrl+D | Duplicate selected/active task(s) in one step (Gantt/Table) |
| Double-click column resize handle | Auto-fit column width to content (Gantt/Table) |

---

## 23. Dark Mode, Language, and Time Zone

### Dark Mode

Click the **dark mode toggle** (sun/moon icon) in the TopBar to switch between light and dark themes. The choice is saved and applied automatically on your next visit. Every page in the application supports dark mode — including auth pages, public pages, dashboards, tools, and admin areas. This includes all 8 Settings tabs, the Admin page (role badges, stat icons, tier badges, search bar, AI usage table), and the Command Palette (modal, input, badges, results, empty state).

All status, severity, and category badges are fully styled for dark mode. Pages with comprehensive badge coverage include: Project Detail (context icons, progress bars, avatar rings), Notifications (severity badges, filter card), Portfolio (project status colors), Workflow (node types, execution status), Lessons Learned (impact badges, recommendation box), Reports (report type badges), Intake Forms (submission status badges), AI Insights (risk/impact/severity badges), and Account Billing (subscription status badges). Badges use translucent dark backgrounds (`dark:bg-*-900/30`) with appropriately lightened text so they remain readable without being garish.

Auth pages (Login, Register, Onboarding, ForgotPassword, ResetPassword) have dark-mode-styled error banners and success icons. The AgentProposals page has full dark mode coverage across its triage section, modal, table, tabs, filter pills, and autonomy cards. The TimesheetPage active tab and AgentActivityTab badges/rows are also dark-mode correct. A non-standard `gray-750` class (not valid in Tailwind v3) was replaced with `gray-700` across 13 files.

Additional component-level dark mode coverage includes: WorkloadHeatmap (heat colors, legend, resource pool badges), QuickActions (button variants), TaskPrioritizationPanel (priority/impact colors, AI badge, summary cards, score bars, banners), QueryInput (input styling, search icon), ChangeRequestDetail (status/category/priority colors, approval timeline, workflow selector), ChangeRequestList (hover state), ChangeRequestForm (modal, inputs, buttons), CustomizeDropdown (panel, labels, items, dividers), ErrorBoundary (full page error state), CustomFieldEditorModal (option button hover), IntakeFormDesigner (field type badge colors, form metadata card, labels, inputs, back button), IntegrationConfigModal (modal background, header, field labels, close button), SyncLogPanel (success/partial/failed status badges, panel background, header, sync button, log entries), ReportScheduleModal (inactive toggle track), ResourceLevelingPanel (header card, before/after toggle, adjustment and reassignment tables, error/success banners), IntakeReviewPanel (status badges, submission info, review actions, convert-to-project flow), MeetingResultPanel (priority/severity/type badges, tab bar, tables, decision/risk cards), ResourceForecastPanel (KPI summary cards, bottleneck callouts, burnout risk badges, empty state), AvailabilityCalendar (type color badges, calendar grid, form inputs, entries list, legend), WorkflowNodeEditor (labels, selects, inputs across all node types), WorkflowEditor (modal, form fields, approval steps, action buttons), IntakeSubmissionForm (header, form container, dynamic inputs, labels, buttons), CapacityChart (container, header, legend, empty state), ExecutionDetail (status color maps, timeline, node badges, error/output data), RebalanceSuggestions (type badges, confidence bar, cards, empty state), NetworkDiagramView (zoom controls, legend, diagram container), MonteCarloHistogram (legend, empty state), ResourceHistogram (container, header, dropdown, legend, empty states), SCurveChart (legend, empty state), BurndownMiniWidget (card, progress bars, skeleton), ResourceUtilizationWidget (card, avatar badges, resource info), CriticalityIndex (legend, empty state), PieChart (legend, empty state), BurndownChart (legend, empty state), ForecastComparisonChart (legend, empty state), TornadoDiagram (legend, empty state), VelocityChart (legend, hover tooltip, empty state), WidgetGrid (empty state card, grip icon), LineChart (empty state), DynamicChart (container card, heading, empty state), AIChatContext (context badge colors), BarChart (empty state), PortalLinkManager (full component dark mode), TaskActivityPanel (border, badge, input, text), TaskCardMobile (status/priority color maps), TemplatePicker (category colors, drop zone), ColumnPickerDropdown (trigger button, checkboxes), TemplateCustomizeForm (task list border, hover, checkbox), TimeTrackingTab (inactive tabs, checkbox), TaskFormModal (checkbox), ViewerInvitePanel (status badges), TimeLogForm (checkbox), CustomFieldsSection (checkbox), ResourcesTab (inactive tab), RAIDDetailPanel (fallback badge), and SaveAsTemplateModal (tag input).

**Dark mode & accessibility polish (July 2026):** ReportScheduleModal form inputs now render correctly in dark mode. The schedule toggle has proper screen reader support (`role="switch"`, `aria-checked`). Ten chart tooltip overlays are now visible in dark mode. Close buttons on IntegrationConfigModal and SyncLogPanel have `aria-label="Close"` for accessibility. A broken hover pattern (`hover:bg-gray-50 dark:bg-gray-900`) that caused table rows and buttons to appear permanently dark was fixed across 16 files. The dead "Apply" button on AI rebalance suggestions was removed. PrelaunchLandingPage is now lazy-loaded to reduce bundle size for non-kovarti.com users.

**UI polish batch 2 (July 2026):** Fixed unconditional `dark:bg-gray-800` and `dark:bg-primary-900/*` hover patterns that applied permanent dark backgrounds instead of hover-only styling across 14 files. Added missing `dark:border-gray-700` to light-only borders on Terms, Privacy, User Guide, Analytics, and saved views. Admin action buttons (retry, migrate, save) now have dark mode styling. Tables in backlog, EVM performance, revenue, and settings gained horizontal scroll (`overflow-x-auto`) for small screens. Responsive grid breakpoints were fixed in admin stats, intake review, and risk form panels. Z-index layering corrected so the AI chat panel sits below the TopBar. RAID detail panel no longer overflows on mobile. KanbanBoard swimlane headers scroll horizontally. Icon-only buttons across notifications, approvals, reports, standup, and narrative refresh gained `aria-label` attributes for screen reader accessibility.

**UI Audit Sprint 1 (July 2026):** Nine features that previously had no sidebar navigation entry (Monte Carlo, Scenario Modeling, Workflows, Report Builder, Intake Forms, Integrations, Agent Proposals) are now accessible from the sidebar under their respective sections (Manage and Insights). The breadcrumb system has a complete label map for all routes — short segments like "goals" and "query" are no longer incorrectly uppercased. KPI tiles on the dashboard are now proper links (keyboard-navigable with focus ring). The dashboard defaults to 4 widgets (KPI tiles, Projects table, Morning Briefing, Action Center) instead of 13 — additional widgets are available via the Customize dropdown. The "Last refreshed" timestamp now shows actual data age ("updated 4 min ago") instead of the render time. The PWA theme color matches the app's teal brand. A global keyboard focus ring is now visible across the entire application when tabbing. Dark mode links show an underline on hover for discoverability.

**Visual system unification (July 2026):** The application now uses a single warm neutral color temperature throughout — the Tailwind `gray` ramp is aliased to stone, eliminating the visible difference between sidebar and app chrome surfaces in dark mode. All hardcoded teal classes were replaced with the `primary` token so the brand color can be changed in one place. The landing page uses the same teal-to-cyan palette as the app. The onboarding page matches the login screen's stone-900 background and shows the Kovarti "K" mark. Trust line and footer text on the landing page meet WCAG AA contrast requirements.

**Copy, performance & navigation polish (July 2026):** The AI usage indicator in the sidebar now only appears when token consumption reaches 70% or higher — below that threshold it is hidden to reduce clutter. At ≥70% it shows "AI usage high" in amber; at ≥90% it shows "AI usage critical" in red, and clicking it opens the Account page. All loading and empty-state messages now use the typographic ellipsis character (…) for consistent, polished microcopy. The Projects page search is debounced (200ms) and the filtered list is memoised for snappier results on large project sets. You can now deep-link to any project tab using `?tab=schedule` (or `?tab=raid`, `?tab=budget`, etc.) in the URL. Pinned projects in the sidebar show a small calendar icon on hover — click it to jump straight to that project's schedule.

**Dashboard & projects density improvements (July 2026):** The dashboard KPI tiles were consolidated from six to four — "Budget Variance" and "Budget Utilization" merged into a single "Budget" tile, and "At-Risk Projects" folded into the "Open Risks" subtitle. The Projects page now has a table/card toggle in the header (your preference is remembered). Table mode shows sortable columns — click any header to sort by name, status, health, progress, methodology, or end date. The AI assistant panel defaults to closed so it doesn't consume screen space until you need it; click the floating button to open it. The My/All Projects scope toggle on the dashboard is always visible; when counts are the same the "All Projects" option is disabled rather than hidden.

**Command palette & keyboard shortcuts (July 2026):** The command palette (Ctrl+K / Cmd+K) is now a full command center. When opened, it shows your recent commands, quick actions (New Project, Log Time, Ask AI, Build Report), and "Go to..." navigation for every page. Typing a single character filters the command list; typing two or more characters searches projects, tasks, risks, and other entities. Press `?` anywhere in the app to open a keyboard shortcut cheat sheet. Chord shortcuts are available: press `g` then `d` for Dashboard, `g` then `p` for Projects, `g` then `n` for Notifications, or `g` then `s` for Settings. The Settings page is now accessible to all user roles (previously limited to admin, project manager, and PMO).

### Language

Open **Settings → Language** and choose from **English**, **French (Français)**, or **Spanish (Español)**. The interface updates immediately; no page reload is required.

### Time Zone

Open **Settings → Preferences** and enter your IANA timezone string (e.g., `America/New_York`, `Europe/Paris`). All task dates, due dates, and timestamps across the application will display in that timezone. Saved via `PUT /api/v1/users/me/preferences`.

---

## 24. Goals / OKR Tracking

The **Goals** page (sidebar link) lets teams track strategic Objectives and Key Results alongside project execution.

### Creating an Objective

1. Click **New Objective**.
2. Enter a title, description, owner, and time period (e.g., Q3 2026).
3. Save. The objective appears in the goals list.

### Adding Key Results

1. Open an objective.
2. Click **Add Key Result**.
3. Enter a title, target value, current value, and unit (e.g., "Revenue", 1000000, 750000, "USD").
4. Progress is calculated automatically as `current / target × 100%`.

### Linking to Projects

In the goal modal, use the **Project** dropdown to associate the goal with a project. The dropdown lists all available projects by name, replacing the previous free-text Project ID field. This surfaces the goal on the project overview so teams can see how their work maps to strategic goals.

---

## 25. Bulk CSV / Excel / XML Import

You can import tasks into any schedule from a CSV, Excel, or Microsoft Project XML file without entering them one by one.

1. Open a schedule and click **Import** in the toolbar.
2. Either **drag-and-drop** a `.csv`, `.xlsx`, `.xls`, or `.xml` file into the upload area or **paste CSV text** directly. Maximum file size is **5MB**.
3. For **multi-sheet Excel files**, a sheet selector dropdown appears — choose which sheet to import.
4. For **CSV/Excel files**, the **Column Mapping** step lets you match each column to a task field (name, start date, end date, estimated days, status, priority, assignee). Required: name. The **Preview** table shows parsed rows with validation warnings highlighted.
5. For **Microsoft Project XML (.xml)** files (MSPDI format), tasks are parsed automatically — no column mapping needed. The importer extracts task names, dates, durations, outline levels (hierarchy), percent complete, and predecessor links (FS/SS/FF/SF with lag). Tasks are created with their hierarchy preserved, and dependencies are wired up automatically. Maximum 500 tasks per import.
6. Click **Import** to create all valid tasks. A summary shows how many rows were imported and any rows skipped due to errors.

**Duplicate detection:** If a task with the same name and start date already exists in the schedule, the row is skipped and reported as a duplicate.

**Phase/Group as summary tasks:** If your spreadsheet has a Phase, Group, Category, or WBS column, the import creates summary (parent) tasks for each unique phase and nests the corresponding tasks underneath them.

**Resource auto-creation:** Any assignee names found in the imported data are automatically added to the Resources table if they don't already exist. New resources are created with default settings (40 hrs/week capacity, no role or department). The import summary shows how many resources were added (e.g. "15 tasks imported successfully. 4 resources added.").

**Encoding:** Files exported from Excel in Windows-1252 encoding (common on Windows machines) are automatically corrected. Characters like em dashes, smart quotes, and bullets that appear garbled in other tools will import correctly.

Accepted date formats: `YYYY-MM-DD` and `MM/DD/YYYY`. Unrecognised status or priority values default to `pending` and `medium` respectively.

---

## 26. Resource Management Page

The Resource Management page (`/resources`) provides a centralized view of resource utilization and capacity, as well as team management. Access it from the sidebar under the **Analyze** section.

1. Select a project from the **project selector** dropdown at the top.
2. Review the **summary cards**: Total Resources, Over-allocated count, Average Utilization, and Estimated Cost (shown when resources have hourly cost rates set).
3. Switch between four tabs:

### Team

A table listing all resources with columns for name, role, capacity, and cost rate. From this tab you can:

- Click **"Add Resource"** to create a new team member (fill in name, role, capacity hours/day, and hourly rate).
- Click the **edit** icon on any row to update a resource's details inline.
- Click the **delete** icon to remove a resource (with confirmation).

### Workload Heatmap

A table showing all resources with weekly utilization percentages rendered as colored cells:

| Color | Utilization Range |
|-------|-------------------|
| Green | Below 80% |
| Blue  | 80%–100% |
| Amber | 100%–120% |
| Red   | Above 120% |

Each row displays the resource name, role, average utilization, total cost (for resources with hourly rates), and per-week cells. Hover over a weekly cell to see the allocated hours, capacity, utilization percentage, and cost for that week.

### Resource Histogram

An SVG bar chart per resource showing daily demand hours alongside an 8-hour capacity line. Over-allocated days appear as red bars. Below the chart, an over-allocation summary lists the count and details of over-allocated days.

### Capacity Forecast

An 8-week bottleneck predictions table with columns for resource, week, demand, capacity, and severity. Below the table, AI-generated recommendations suggest actions to resolve upcoming bottlenecks.

---

## 26b. Resource Management Enhancements

The following nine capabilities extend the Resource Management page and team planning tools.

### Cost Rollup

Resources with an hourly cost rate (`$/hour`) automatically have costs calculated in the workload views:

- The **Workload Heatmap** shows a **Cost** column per resource with the total cost across the displayed weeks.
- Weekly cell tooltips include the cost for that specific week (allocated hours × hourly rate).
- The **Estimated Cost** summary card at the top of the page shows the aggregate cost across all resources.

Set a resource's cost rate in the resource edit form under **Cost Rate ($/hr)**.

### Assignment Conflict Detection

When assigning a resource to a task (via the assignments panel or quick-assign), the system checks for over-allocation. If the resource's total allocated hours across all overlapping assignments would exceed their weekly capacity, an advisory warning is returned:

> "Resource 'Jane Smith' would be allocated 56h/week against 40h capacity (140% utilization) during 2026-01-06 to 2026-03-31"

The assignment is still created — warnings are informational, not blocking. This helps project managers make informed decisions about temporary over-allocation.

### Skill Proficiency Levels

When adding or editing a resource, each skill now has a **proficiency level** from 1 (Junior) to 5 (Expert). Set the level using the dropdown next to each skill tag. If no level is set, the skill defaults to Mid (3).

Proficiency levels are used by the AI skill-match tool when recommending resources for tasks — a Senior-level skill match ranks higher than a Junior-level one, even if both have the same skill name.

### Cross-Project Workload View

The Workload Heatmap tab on the Resource Management page (`/resources`) now includes an **All Projects** option in the project selector dropdown. Selecting it shows each resource's combined demand across every project they are assigned to, making it easy to spot hidden cross-project over-allocation that would not appear when viewing a single project.

The underlying API endpoint is:
```
GET /api/v1/resources/workload
```
(no projectId required)

### Departments

Resources can be organized into departments (e.g., Engineering, Design, QA, Management, Operations, Marketing, Sales, Support):

1. When creating or editing a resource, select a **Department** from the dropdown.
2. On the Team tab of the Resource Management page, use the **Department** filter to view only a specific department.

Departments help large organizations navigate their resource pool without scrolling through everyone.

### Utilization Dashboard

A 12-week trend chart is available in the Resource Management page. It plots three lines per resource:

| Line | What it shows |
|------|---------------|
| **Planned** | Hours scheduled in task assignments |
| **Actual** | Hours logged by the resource via time entries |
| **Capacity** | Available hours per week from the resource's working schedule |

Use this chart to identify recurring patterns — for example, a resource who consistently logs more hours than planned may be under-estimated, or one whose actual hours are far below capacity may be idle.

### Gantt Quick-Assign

The Gantt chart includes a toggleable **Resource** column that enables inline resource assignment:

1. **Enable the column:** Open the column picker in the Gantt toolbar and toggle **Resource** on.
2. **View assignments:** Each task row shows resource chips (initials) for currently assigned resources.
3. **Add a resource:** Click the **"+"** button in the Resource cell. A searchable dropdown appears listing all available resources (excluding already-assigned ones). Select a resource to assign it instantly.
4. **Remove a resource:** Hover over a resource chip and click the **"×"** that appears.

Assignments use the task's existing start and end dates. An over-allocation warning appears if the assignment would exceed the resource's weekly capacity, but the assignment is still created (advisory, not blocking).

### Calendar Templates

Standard 5-day/8-hour schedules do not fit every team. Calendar templates let you define custom working weeks:

- **Built-in templates:** Standard 5×8, Compressed 4×10, Rotating 6×6.
- **Custom templates:** Define which days are working days and how many hours per day.

To manage templates, go to the **Calendar Templates** tab on the Resource Management page (`/resources`). To assign a template to a resource, open the resource's edit form and select a template from the **Working Schedule** dropdown.

When a resource has a template assigned, all capacity and workload calculations use the template's effective weekly hours rather than the flat capacity value.

### Timesheet Integration (Actual vs. Planned)

If a resource's profile is linked to a user account (via the **Linked User** field in the resource edit form), the workload views automatically show actual hours from that user's time entries:

- The Workload Heatmap displays an **Actual** row beneath the Planned row for each week.
- Cell color indicates variance:
  - **Green** — Actual hours are at or below planned.
  - **Amber** — Actual hours are 10–25% above planned.
  - **Red** — Actual hours are more than 25% above planned.
- The Utilization Dashboard's **Actual** series is populated from real time-log data rather than estimates.

To link a resource to a user, open the resource edit form and select the user from the **Linked User** dropdown. Only users in your organization appear in the list.

---

## 27. EVM Dashboard Page

The EVM Dashboard (`/evm`) provides a comprehensive earned value management view. Access it from the sidebar under the **Analyze** section.

> **Trial plan:** If you are on a trial plan, the EVM Dashboard displays a sample dashboard with demo data rather than your actual project metrics. An amber banner at the top of the page indicates this. Upgrade to a paid plan to unlock EVM metrics calculated from your real project budgets, costs, and schedule performance.

1. Select a project from the **project selector** dropdown.
2. Review the **KPI cards**: CPI, SPI, EV, PV, AC, and BAC. Values are color-coded (green when healthy, red when critical).
3. Review the **forecast cards**: EAC, ETC, VAC, and TCPI. Cards show red warning borders when thresholds are exceeded.
4. The **CPI/SPI Trend chart** plots CPI (blue line) and SPI (green line) over time with a 1.0 baseline reference and labeled axes.
5. The **Early Warnings** panel displays color-coded alerts:
   - **Red** — Critical issues requiring immediate attention.
   - **Amber** — Warnings to watch.
   - **Blue** — Informational notices.
6. The **Forecast Comparison** table shows multiple forecasting methods with their EAC values and variance from BAC.
7. When AI is enabled, the **AI Predictions** section displays:
   - AI-adjusted EAC with confidence range (low/high).
   - Overrun probability percentage.
   - Trend direction (improving, stable, or deteriorating).
   - Narrative summary in plain language.
   - Corrective actions with priority badges.

   > **Note:** AI Predictions are available on paid plans only and are not included in the trial sample dashboard.

---

## 28. Notifications Center Page

The full-page Notifications Center is available at `/notifications`. Access it from the sidebar ("Notifications" under Workspace) or by clicking "View all alerts" in the notification bell dropdown.

### Severity Summary Cards

At the top of the page, four clickable cards show counts for **Critical**, **High**, **Medium**, and **Low** notifications. Click any card to filter the list to only that severity level.

### Filtering

Use the filter panel to narrow the notification list:

- **Type** -- Filter by notification type: Risk, Budget, Schedule, Resource, and others.
- **Severity** -- Filter by severity level (or click a summary card above).

### Notification List

Each notification entry displays:

- A **severity color bar** on the left edge (red for critical, orange for high, yellow for medium, blue for low).
- A **type icon** matching the notification category.
- The **title** and **message** body.
- **Time ago** (e.g., "2 hours ago").
- **Type label** and **project name**.

### Managing Notifications

- Click the **mark read** button on any individual notification to dismiss it. The read state is saved to the server so it persists across page refreshes and sessions.
- Click **"Mark all read"** at the top of the list to mark all notifications as read at once.
- Click **"Load More"** at the bottom of the list to fetch additional notifications. The list loads in pages so the initial view stays fast even on accounts with many notifications.

---

## 29. Dashboard Widget Customization

The unified dashboard supports toggling widget sections on/off and drag-and-drop reordering:

1. Click **Customize** in the dashboard header to toggle widgets on/off.
2. **Drag to reorder** — hover over any widget to reveal a grip handle on the left, then drag it to a new position.
3. Click **"Reset to Default Layout"** at the bottom of the Customize dropdown to restore the default widget order, visibility, and scope.
4. Your preferences (enabled widgets, order, and scope) are saved to the server automatically and sync across devices. Changes appear instantly via localStorage cache.

Available sections: Morning Briefing, KPI Tiles, Portfolio Intelligence, Projects Table, Action Center, Issues Trend, Sprint Velocity, Milestones, Budget Watch, Activity Feed, Standup Summary.

Opt-in sections (disabled by default): Sprint Snapshot, Goals Progress, Team Workload.

---

## 30. Dashboard & Projects

The Dashboard and Projects pages provide a lean, action-oriented project management experience.

### Dashboard (`/dashboard`)

Access via the sidebar under **Plan → Dashboard**.

- **Scope Toggle** — Switch between "My Projects" and "All Projects" to control which data is displayed.
- **KPI Tiles** — 6 tiles showing Portfolio Health, Overdue Tasks, Open Risks, At-Risk Projects, Budget Variance, and Budget Utilization. Each has a colored status dot and click-through to drill-in pages. Health and Overdue tiles show 7-day trend arrows: green up arrow (improving), red down arrow (declining), or gray dash (stable).

#### Understanding Portfolio Health

Portfolio Health is a score from 0 to 100 that tells you how well your projects are going overall. It looks at three things for each active project:

  1. **Schedule progress (40% of the score)** — Are tasks getting done? A project at 60% complete scores better than one at 10%.
  2. **Budget (30% of the score)** — Are you spending within budget? High budget usage pulls the score down.
  3. **Overall status (30% of the score)** — Is the project active and moving, on hold, or cancelled? Active projects score highest.

Each project gets its own score, then they are averaged together to produce the portfolio-wide number. The result tells you:

  - **75--100 = Good** — Projects are on track.
  - **50--74 = Fair** — Some things need attention.
  - **Below 50 = At Risk** — Significant problems that need action.

Projects still in **planning** status are excluded. Until a project is active with real work happening, there is nothing meaningful to measure.

The **Open Risks** tile next to Portfolio Health counts how many active projects scored below 75. If you see "2 Open Risks," it means two projects are showing signs of trouble — either behind schedule, over budget, or both.

- **KPI Drill-In Pages** — Click any KPI tile to open a detailed drill-in page. Each page includes summary stat cards at the top (e.g., average health, total overdue, critical count), a sortable data table, and type-specific enrichments: Health and Overdue pages show a trend badge (improving/declining/stable); Health and Risks pages show a color-coded distribution bar; the Health table adds Schedule, Budget, and Risk sub-score columns with 30-day sparkline trends.
- **Portfolio Intelligence** — AI-generated health ring, risk chips, budget status, and key insights. Supports dark mode.
- **Action Center** — Two columns: "Today's Priorities" (deadline-driven items) and "AI Next Best Actions" (proposals with confidence % and risk level badges, critical/high notifications, at-risk projects with health score badges). This is the single source for AI-suggested next actions on the dashboard.
- **Projects Table** — Sortable table; clicking a row navigates to the project detail view (`/project/:id`).
- **Customize** — Toggle widgets on/off, drag-and-drop to reorder, and "Reset to Default Layout" to restore defaults. Preferences sync across devices. Opt-in widgets (Sprint Snapshot, Goals Progress, Team Workload) are available but disabled by default.

### Projects (`/projects`)

Access via the sidebar under **Plan → Projects**.

- **Filter Bar** — Search by name, filter by health band and status.
- **AI Portfolio Insights** — 3 insight tiles pulled from analytics summary, enriched with 7-day trend context (e.g., "Up from last week", "Completion rate is trending up").
- **Project Cards** — Grid of cards with health-based left borders, status/priority chips, and progress meters. Clicking a card navigates to `/project/:id` with full Gantt/Kanban/Calendar/EVM detail.
- **New Project** — Create from template via the template picker.

- **Left Panel** — Tabbed view: Tasks, Risks, Issues, Milestones, RAID, Documents. Each tab shows a filterable list with inline Add buttons.
- **Right Rail** — Sticky panel with Project Health ring (schedule/budget/risk sub-scores), AI Assistant card, and Activity Feed.

---

## 31. RAID Log

The RAID Log is a project-level register for Risks, Actions, Issues, and Decisions. Access it from the **RAID** tab on any project detail page (or via the RAID tab in the PM Project Detail view).

### Creating Records

The RAID log header contains four **Add** buttons, one per type:

- **+ Risk** — Opens the Risk form. Fill in title, description, severity (low / medium / high / critical), probability, impact, owner, and optional mitigation plan. Click **Save** to create. The record is assigned the next `R-NNN` ID automatically. When editing an existing risk, three fields offer a **"Suggest with AI"** button: **Mitigation Plan** (preventive strategies), **Trigger Condition** (early warning signs), and **Response Plan** (contingency actions). Click the button to have AI generate suggestions based on your organisation's lessons-learned knowledge base.
- **+ Issue** — Opens the Issue form. Issues have their own fields distinct from risks: title, description, severity, category, owner, root cause ("Why did this happen?"), impact assessment, workaround ("Temporary fix"), resolution plan ("Permanent fix"), and target resolution date. Probability is not shown since the issue has already occurred. Assigned an `I-NNN` ID.
- **+ Action** — Opens the Action form. Fill in title, description, owner, due date, and action type (Follow-Up / Decision Required / Information Only / Escalation). Assigned an `A-NNN` ID.
- **+ Decision** — Opens the Decision form. Fill in title, description, decided by, rationale, decision date, and alternatives considered. Assigned a `D-NNN` ID.

All forms include a **Source** field (Manual / AI Scan / Agent / Import) that is set automatically when records are created by the AI Scan or an agent.

**All team members** can raise RAID items — open identification of risks, issues, actions, and decisions is encouraged per PMI/PRINCE2 governance best practice.

### Triage Workflow

Items raised by non-PM roles (team members, QA, testers, DevOps, BAs) are created with status **Proposed** and require PM review before becoming active. Items raised by PMs, admins, scrum masters, risk managers, or PMO bypass triage and go straight to **Open**.

When a Proposed item is created, all project managers and owners receive a notification: *"New [Type] requires triage: [Title]"*. The PM reviews the item and either:

- **Promotes** it to `open` (or the appropriate starting status for its type)
- **Cancels** it with a reason if it is not valid

This keeps the active register curated while ensuring that threats identified by any team member are captured and reviewed.

### Views

The RAID tab supports three view modes, toggled from the toolbar:

- **Table view** (default) — Sortable grid with columns for checkbox, ID, Title, Type, Severity, Status, Owner, Score, and Date. Click any column header to sort ascending or descending. Click a **status badge** directly in the table to change it inline — a dropdown appears with the valid statuses for that record type, without needing to open the detail panel. Due date warnings appear as overdue/due-soon badges next to action and issue titles. On mobile, the table automatically renders as responsive cards.
- **Board view** — Kanban-style columns grouped by status. Drag cards between columns to change status. Each card shows the record ID, type indicator, severity badge, title, owner, and due warning. Only columns with items are shown.
- **Risk Matrix** — A 5×5 probability × impact heatmap for risk-type items. Cells are colour-coded from green (low risk score) to red (critical). Each cell shows the count of risks; click a cell to view details.

### Bulk Actions

Use checkboxes to select multiple RAID items, then use the sticky bulk action bar to:

- **Set Status** — Change the status of all selected items at once.
- **Set Severity** — Change the severity of all selected items at once.
- Click **Clear** to deselect all.

### Searching and Filtering

A collapsible filter panel in the toolbar provides:

- **Search box** — Filters records by title or description as you type.
- **Filter toggle** — Click the Filter button to reveal/hide filter dropdowns. A badge shows how many filters are active.
- **Type** dropdown — Show all types or filter to Risks, Issues, Actions, or Decisions only.
- **Status** dropdown — Filter by a specific status.
- **Severity** dropdown — Filter to a specific severity level.
- **Source** dropdown — Filter by how the record was created (manual, ai_scan, agent, import).
- **Clear all** — Resets all filters at once. Item count displayed.

Filters combine — you can, for example, show only open critical Risks created by AI Scan.

### Stats Row

At the top of the RAID log, a stats bar shows at-a-glance counts:

- **Open Risks** — Risks in `open` or `monitoring` status.
- **Open Issues** — Issues in `open` or `in_progress` status.
- **Open Actions** — Actions in `open`, `in_progress`, or `deferred` status.
- **Pending Decisions** — Decisions in `pending_decision` status.
- **Critical** — All items with critical severity.
- **Severity distribution** — A horizontal stacked bar chart showing the breakdown of critical/high/medium/low items with colour legend.

These counts update immediately whenever a record is created, updated, or cancelled.

### Tab Badge

The RAID tab header shows a count badge with the total number of open items (open risks + open issues + open actions + pending decisions), providing at-a-glance visibility without clicking into the tab.

### Slide-Out Detail Panel

Click any row in the RAID table to open the detail panel on the right side of the screen without leaving the page. The panel shows:

- The record's full header: sequential ID (e.g., `R-007`), type badge, current status pill, and severity chip.
- All fields for that record type, editable inline for users with the appropriate role.
- An **Updates** section — for team communication. Each update shows the author name, relative timestamp, and text. You can delete your own updates.
- An **Activity** section — a read-only audit trail showing every status change, field edit, cancel/reverse action, and update added/deleted event. Each entry shows the actor name, relative timestamp, and a description of what changed.

Close the panel by clicking outside it or pressing **Escape**.

### Providing Updates

At the bottom of the detail panel, type your update in the input box and press **Enter** or click the send button. The update appears immediately in the Updates section with your name and the current timestamp. An "Update added" entry is also logged in the Activity section for audit purposes.

To delete an update you posted, click the trash icon next to it. An "Update deleted" audit entry is logged automatically.

### Notifications

RAID items generate notifications to keep the team informed:

| Event | Who is notified |
|-------|-----------------|
| Owner assigned or reassigned | The new owner |
| Status changed | Owner + project managers (excluding the person who made the change) |
| Update posted | Owner + project managers (excluding the poster) |
| Severity escalated to high/critical | Project managers |
| New item created (triage) | Project managers |

Notifications appear in the bell icon at the top of the page and link directly to the RAID item.

### Cancelling a Record

To cancel a record (instead of deleting it — RAID records are never deleted):

1. Open the detail panel for the record.
2. Click **Cancel Record**.
3. Enter a mandatory cancellation reason in the prompt.
4. Confirm. The record status changes to `cancelled` and the reason is logged in the activity timeline.

Cancelled records remain visible in the log and can be found by filtering Status = cancelled. The sequential ID is not reused.

### Reversing a Decision (Admin Only)

If a Decision record has been marked `decided` and needs to be formally reversed:

1. Open the detail panel for the Decision record.
2. Click **Reverse Decision** (visible to admin users only).
3. Enter a mandatory reason for the reversal.
4. Confirm. Status changes to `reversed` and the reason is logged in the timeline.

Reversal is a formal governance action and cannot be undone through the UI.

### AI Scan

The **AI Scan** button in the RAID toolbar triggers a project-scoped analysis:

1. Click **AI Scan**.
2. The AI reads the current schedule, task statuses, overdue items, budget data, and existing RAID entries.
3. A preview panel shows suggested new Risks and Issues with titles, descriptions, and severity assessments.
4. Check the records you want to import and click **Import Selected**.
5. Selected records are created in the RAID log tagged as `source: ai_scan`.

AI Scan does not overwrite or modify existing records — it only proposes new ones.

### RAID Report

Click the **RAID Report** button in the RAID tab toolbar to generate a comprehensive, data-driven report of all open RAID items. This report does not use AI — it is built directly from your project's RAID data.

#### Generating a Report

1. Click **RAID Report** in the toolbar.
2. A modal opens with filter controls:
   - **Type** — Check or uncheck Risk, Issue, Action, and Decision to include or exclude each type.
   - **Severity** — Select which severity levels to include (critical, high, medium, low).
   - **Owner** — Choose a specific owner from the dropdown, or leave blank for all owners.
3. Click **Generate Report**.

#### Report Sections

The generated report contains four sections:

1. **Summary Dashboard** — Four cards (one per RAID type) showing the count of open items with a severity breakdown (how many are critical, high, medium, or low).
2. **All Items Table** — A complete table of all RAID items matching your filters, with columns for ID, Title, Type, Severity, Status, Owner, and Date.
3. **Overdue Actions** — A highlighted list of Action and Issue items that are past their due date or target resolution date, sorted by how overdue they are. Use this to quickly identify items that need immediate attention.
4. **Key Mitigations** — A summary of active mitigation plans for open risks, so stakeholders can see what preventive measures are in place.

#### Download, Email, and Schedule

- **Download HTML** — Click the Download button to save the report as a standalone `.html` file. Share it as an email attachment, print it, or archive it for governance records.
- **Email Report** — Enter comma-separated email addresses and click Send. The report is delivered as a branded HTML email to all recipients.
- **Schedule Recurring** — Set up automatic RAID report delivery on a daily, weekly, or monthly cadence. Choose the day of week (or day of month), time, and recipients. View and delete existing schedules from this tab. Schedules use a `raid-report::` prefix to keep them separate from status report schedules.

**Trial users:** A **sample report** is shown with realistic demo data so you can preview the format. An amber banner identifies it as sample data. The Download, Email, and Schedule options are locked — upgrade to a paid plan to generate RAID reports from your real project data.

---

## 32. My Work

The **My Work** page (`/my-work`) is the first page you see after logging in. It shows all tasks assigned to you across every project in one place, so you do not need to open each project individually to find your work.

### Task Buckets

Tasks are grouped into six collapsible sections:

| Section | What it shows |
|---|---|
| **Overdue** | Tasks past their due date that are not yet complete |
| **Due Today** | Tasks due today |
| **Due This Week** | Tasks due within the next 7 days |
| **In Progress** | Tasks you have started with no imminent due date |
| **Upcoming** | Not-started tasks with a future due date beyond this week |
| **Recently Completed** | Tasks you completed in the last 14 days |

Each section header shows a count of how many tasks it contains. Empty sections are hidden automatically. If you have no assigned tasks at all, a message is shown.

### Reading the Task List

Each row shows:

- A **colored priority dot** (red = critical, orange = high, yellow = medium, gray = low)
- The **task name**
- The **project name**, which links to the project detail page
- The **due date**, shown as a relative label (e.g., "2 days ago", "Today", "Aug 22")
- A **status chip** matching the color scheme used throughout the app

Click any task row to go directly to that project's Schedule tab with the task selected.

### Collapsing and Expanding Sections

Click any section header to collapse or expand it. This is useful if one bucket is large and you want to focus on another, such as **Overdue** or **Due Today**.

---

## Tips

- **Save often** -- Always click Save after modifying schedules or tasks. Unsaved changes are lost on page refresh.
- **Use the Command Palette** -- Ctrl+K is the fastest way to navigate anywhere in the application.
- **Check notifications** -- The bell icon alerts you to approvals, delays, and assignment changes.
- **Leverage AI** -- Use AI Query (under Mjuzi AI in the sidebar) for quick data lookups, and AI Task Breakdown when starting a new project.
- **Set baselines early** -- Create a baseline as soon as the initial plan is approved, before work begins.
- **Review EVM weekly** -- SPI and CPI trends provide early warning of schedule and cost problems.

---

## Need Help?

- **In-app help** -- Navigate to the **Help** page from the sidebar, or open the **TopBar user dropdown** (your avatar/name in the top-right corner) and click **Help & Support**. Both links open the same support resources.
- **Email support** -- Contact the support team directly at [support@kpbc.ca](mailto:support@kpbc.ca).
- **Contextual support links** -- "Need help? Contact support" links appear on the **login page**, **404 page**, and **error pages**. These mailto links pre-fill the subject and body with your current page URL and timestamp so the support team can diagnose faster.
- **Error reporting** -- If you encounter a crash (error boundary), a "Report this issue" link lets you email the error details directly to support.
- **Administrators** -- See the [Admin Manual](./ADMIN_MANUAL.md) for system configuration and deployment.
- **API access** -- Generate an API key in Settings to integrate with external tools.
