# PM Assistant

**Enterprise Project Management Platform with Agentic AI**

A full-featured, production-grade project management SaaS application combining traditional PM methodologies (CPM, EVM, Agile) with an autonomous AI agent system. 14 specialized agents continuously monitor projects, reason about issues via Claude, and propose (or auto-execute) corrective actions — all with human-in-the-loop governance, confidence scoring, and full audit trails. Built with Fastify, React, and the Anthropic Claude SDK.

**Live:** [https://pm.kpbc.ca](https://pm.kpbc.ca)

---

## Table of Contents

- [Tech Stack](#tech-stack)
- [Quick Start](#quick-start)
- [Feature Overview](#feature-overview)
- [Architecture](#architecture)
- [Project Structure](#project-structure)
- [MCP Server](#mcp-server)
- [Development Commands](#development-commands)
- [Environment Variables](#environment-variables)
- [API Documentation](#api-documentation)
- [License](#license)

---

## Tech Stack

| Layer | Technology |
|-------|-----------|
| **Backend** | Fastify 5 + TypeScript, Node.js 22 |
| **Frontend** | React 18 + Vite + Tailwind CSS + Zustand |
| **Database** | MySQL / MariaDB |
| **AI** | Anthropic Claude SDK (optional, via `AI_ENABLED` env var) |
| **Auth** | JWT (access + refresh tokens) with HttpOnly cookies; OAuth 2.1 with PKCE for MCP; project-level membership enforcement |
| **Real-time** | WebSocket + Server-Sent Events (SSE) |
| **Billing** | Stripe |
| **Validation** | Zod |
| **API Docs** | OpenAPI / Swagger |
| **MCP** | Model Context Protocol server for Claude Desktop and Claude Web |
| **Deployment** | LiteSpeed (static assets) + Passenger (Node.js API) on TMD Hosting |

---

## Quick Start

### 1. Install Dependencies

```bash
npm install
cd src/client && npm install && cd ../..
```

### 2. Environment Setup

```bash
cp env.example .env
```

Edit `.env` with your database credentials, JWT secrets, and optional integrations. See [Environment Variables](#environment-variables) for the full list.

### 3. Start Development

```bash
npm run dev
```

This starts both the Fastify API server and the Vite dev server concurrently.

- **Application:** http://localhost:5173
- **API:** http://localhost:3001
- **Swagger Docs:** http://localhost:3001/documentation
- **Health Check:** http://localhost:3001/health — returns database connectivity, memory usage, and overall system status (200 OK / 503 DEGRADED)

**Default login:** `admin` / `admin123`

---

## Feature Overview

### Project & Schedule Management
- Full CRUD for projects, tasks, and schedules
- **Methodology-aware projects** (Waterfall / Agile / Hybrid) -- controls default view, tab ordering, readiness bar steps, and context cards
- Multiple views: Gantt chart, Kanban board, Calendar, Table (with MS Project-style column picker and saved views)
- Gantt drag-and-drop rescheduling (move and resize task bars)
- Gantt interactive dependency drawing: drag from connector dots on task bar edges to another task to create FS/SS/FF/SF links visually (MS Project-style)
- Gantt inline grid editing: click any cell in the left panel to edit directly (name, dates, duration, %, priority, assignee, status, predecessors) with Tab navigation across cells and rows; default visible columns reduced to 6 essentials so Task Name is always legible; Task Name column is resizable (250px default); left panel scrolls horizontally when extra columns are enabled
- Gantt column header sort (asc/desc/none, hierarchy-preserving), copy/paste cells (Ctrl+C/V), indent/outdent (Tab/Shift+Tab), bar progress drag
- Gantt quick search (Ctrl+F) with type-ahead filtering, filter panel (status, priority, assignee, date range, progress), and saved views (columns, sort, zoom via localStorage)
- Gantt multi-select bars: click/Ctrl+click/Shift+click bars to select, blue highlight + box-shadow, bulk drag-move all selected bars together
- Gantt zoom-to-fit: auto-selects zoom level to fit all tasks in the viewport
- Gantt float/slack visualization: hatched yellow extensions on non-critical bars showing available float days (requires critical path enabled)
- Gantt row striping: alternating row backgrounds in both left panel and timeline for improved readability (dark mode aware)
- Gantt resource avatars: assignee initials circles on task bars with deterministic color palette
- Gantt drag-to-create: click-drag on empty timeline area to create a task with pre-filled start/end dates and auto-detected parent
- Gantt resource overallocation warnings: toggle to highlight bars with overlapping assignments (amber border + warning dot), with count badge
- Gantt minimap: 200×80px overview panel in bottom-right showing colored task rectangles with draggable viewport indicator
- Task hierarchy with summary task auto-calculation
- Multi-dependency support: up to 20 predecessors per task (FS/SS/FF/SF + lag), stored in a `task_dependencies` junction table
- MS Project-style predecessor notation (e.g. "3FS+2d,5SS,7") with health badges and inline editing in both Gantt and Table views; **Successor column** (Succ) shows dependent tasks in the same format — read-only, hidden by default, available in both Gantt and Table column pickers
- Recurring tasks (daily, weekly, biweekly, monthly) with auto-generation
- Unified customizable dashboard with scope toggle (My Projects / All Projects), KPI tiles with enriched drill-in pages (summary cards, trend badges, distribution bars, sparklines), issues trend chart, milestones, budget watch, and widget visibility persistence
- Real-time presence indicators showing who is viewing a project

### Critical Path Method (CPM)
- Forward and backward pass computation
- Critical path identification and highlighting
- Float/slack calculation
- Network diagram visualization

### Baseline Management
- Create, compare, and track schedule baselines
- Variance analysis between baseline and current schedule

### Earned Value Management (EVM)
- PV, EV, AC, SPI, CPI, EAC, ETC, VAC, TCPI metrics
- S-curve visualization
- Performance forecasting with trend analysis
- Dedicated EVM Dashboard page (`/evm`) with KPI cards, forecast cards, CPI/SPI trend chart, early warnings, forecast comparison table, and AI predictions

### Resource Management
- Resource pool with roles, capacity, and cost rates
- Workload heatmap visualization
- Resource leveling algorithm
- Resource optimization suggestions
- Resource availability calendar (vacation, holiday, unavailable, reduced hours)
- Dedicated Resource Management page (`/resources`) with a **Team** tab (full resource table with create, edit, and delete) plus workload heatmap, resource histogram, and capacity forecast analytics tabs

### DAG Workflow Engine
- Declarative directed acyclic graph workflows
- Six node types: trigger, condition, action, approval, delay, agent
- Event-driven triggers: status_change, progress_threshold, date_passed, task_created, priority_change, assignment_change, dependency_change, budget_threshold, project_status_change
- Task lifecycle events (create/update) automatically fire matching workflows
- Project-level events (budget changes, status changes) trigger workflows via `evaluateProjectChange()`
- Actions: update_field, log_activity, send_notification (creates real notifications), invoke_agent
- Agent nodes with retry logic and configurable backoff
- 15-minute overdue-task scanner triggers `date_passed` workflows automatically
- Persistent execution with per-node status tracking
- Approval gates that pause execution pending human review
- Condition branching with field-based operator evaluation
- Full audit integration

### Approval Workflows & Change Requests
- Multi-level approval chains
- Change request tracking with impact analysis
- Status lifecycle management

### Sprint / Agile Management
- Sprint planning with backlog grooming
- Kanban sprint board
- Burndown and velocity charts
- Sprint retrospective support

### Time Tracking & Timesheets
- Per-task time entry logging
- Weekly timesheet views with inline "Log Time" form (project/schedule/task dropdowns, date, hours, description) for creating entries without leaving the page
- Actual vs. estimated comparison

### Custom Fields
- Per-project custom field definitions
- Text, number, date, select, and multi-select types

### File Attachments
- Upload and attach files to tasks and projects
- Version history tracking

### Monte Carlo Simulation
- Schedule risk analysis via Monte Carlo simulation
- Probability distribution for project completion dates

### AI Features (requires `AI_ENABLED=true`)
- **Auto-Reschedule** -- AI-driven schedule optimization
- **Natural Language Queries** -- Ask questions about project data in plain English
- **Natural Language Workflow Builder** -- Describe automations in plain English, AI generates a complete DAG workflow definition for review and editing
- **Meeting Intelligence** -- Automated meeting minutes and action item extraction
- **Lessons Learned** -- AI-assisted capture, edit, delete, and retrieval of project lessons; edit opens pre-filled modal, delete uses a styled confirmation modal; "Load More" pagination on the Lessons Learned page
- **AI Task Estimation** -- Suggests estimated duration for new tasks using historical completed-task data + Claude reasoning; sparkles button in task form
- **Task Prioritization** -- Intelligent priority scoring
- **Predictive Intelligence** -- Forecast delays, cost overruns, and risks
- **Task Slip Predictor** -- Identifies which tasks are likely to slip with confidence scores and reasons
- **Scope Creep Detector** -- Compares current state against baselines to flag unauthorized scope growth
- **Status Report Generator** -- AI-generated status reports with copy/download, email delivery, and recurring schedules (daily/weekly/monthly)
- **Anomaly Detection** -- Proactive alerts for unusual patterns
- **Cross-Project Intelligence** -- Insights across the portfolio
- **What-If Scenario Modeling** -- Simulate schedule and resource changes

### Agentic System (requires `AGENT_ENABLED=true`)
- **Agentic Proposals** -- Agents autonomously detect issues, reason about root causes via Claude, and propose concrete recovery actions for human approval
- **Schedule Recovery Agent** -- Detects schedule delays, reasons about root cause, proposes task date/resource changes
- **Scope Creep Detection Agent** -- Monitors task growth, estimate increases, and change requests against baselines; alerts when scope creep is detected
- **Budget Intelligence Agent** -- Analyzes EVM metrics (CPI, SPI, VAC, EAC), identifies root causes of cost deviations via Claude reasoning, proposes corrective actions
- **Resource Optimization Agent** -- Detects over-allocated (>100%) and under-utilized (<40%) resources, identifies bottleneck roles, proposes rebalancing actions via Claude reasoning
- **Cross-Project Intelligence Agent** -- Portfolio-level analysis: identifies systemic risks, common patterns, resource contention, and cascading delays across all active projects
- **Risk Escalation Agent** -- Runs last in each scan; detects compound risks where 2+ agents flag the same project (e.g., schedule delay + budget overrun + resource bottleneck), escalates to management
- **Stakeholder Communication Agent** -- Auto-generates stakeholder status reports with executive summaries, key highlights, risks/concerns, upcoming milestones, and recommended actions
- **Project Hygiene Agent** -- Detects stale tasks (14+ days), missing dates/estimates, unassigned tasks, abandoned sprints, and zero-progress in-progress tasks
- **Dependency Risk Agent** -- Analyzes task dependency graphs to detect blocked chains, bottleneck tasks (3+ dependents), and long dependency chains (depth > 5)
- **Lessons Learned Agent** -- Auto-extracts lessons when projects reach 90%+ completion or are completed; stores lessons for RAG retrieval and future project improvement
- **Predictive Alerting Agent** -- Pattern-based early warnings using velocity trends, progress-vs-time trajectory, risk accumulation, and similar project comparison
- **Autonomous Execution (SME/Enterprise)** -- Agents with proven track records (30+ days, 20+ proposals, 80%+ acceptance, zero rollbacks) can be promoted to auto-execute low-risk, high-confidence proposals
- **Confidence Scoring** -- Weighted confidence (data quality + historical accuracy + model certainty) controls what agents can propose
- **Proposal Lifecycle** -- pending -> approved/rejected -> executed/rolled_back with full audit trail
- **Emergency Kill Switch** -- Global, per-agent, and per-project agent shutdown via API with audit logging
- **Rate Limiting** -- Per-agent and all-agent rate limits prevent alert fatigue (3/agent/24h, 10/all/24h)
- **Circuit Breakers** -- Per-agent circuit breakers open after 3 consecutive failures, auto-retry after cooldown
- **Degradation Handling** -- Graceful scope reduction when Claude API or database is unhealthy
- **Feedback Loop** -- Users rate proposal outcomes; feedback improves future confidence scores
- **Agent Memory Layer** -- Persistent memory across sessions: session, project, role, and reflection memory types with TTL expiry. Agents store reflections after each action (what was decided, why, outcome). Memory API: `GET/POST/DELETE /api/v1/agent/memory`
- **Agent Proposals UI** -- Dedicated page (`/agent`) for managers/admins to review, approve/reject, execute, rollback, and rate agent proposals with full reasoning and action detail; "Load More" pagination for large proposal lists

### Reporting & Analytics
- Custom report builder with saved templates; KPI, chart, and table sections render correctly with proper data shapes; SQL injection protection on groupBy; regular users can delete their own templates; report designer properly saves sections on template update
- Portfolio dashboard with 6 KPI cards (Total Projects, Active, On Track, At Risk, Budget Allocated, Budget Spent), status filter pills, project health cards with progress bars and budget utilization, and Dashboard/Timeline toggle
- **Portfolio Analytics** — cross-project CPI/SPI comparison table with sparkline trends, burndown trend sparklines per project, and sortable project comparison matrix (health, CPI, SPI, budget %, progress, tasks)
- Portfolio-level analytics and executive dashboards
- Project health scoring
- Exportable reports
- Scheduled report delivery via email (daily/weekly/monthly CSV)

### Dashboard Widgets
- **Next Best Actions** -- AI-synthesized action cards from proposals, notifications, and at-risk projects with priority ranking; confidence percentage badges, risk level badges (color-coded by severity), and health score badges for at-risk projects
- **Health Trends** -- Daily health score snapshots with SVG sparklines per project (migration 038, `project_health_history` table, daily cron at 03:00)
- **Sprint Snapshot** -- Active sprints with day progress, task completion, and velocity trend (opt-in)
- **Goals Progress** -- Objectives sorted by urgency with progress bars and status badges (opt-in)
- **Team Workload** -- Per-resource task counts with overload indicators (opt-in)
- **Clickable Recent Activity** -- Click notifications to navigate to linked entities; marks as read automatically; filter pills (All/Agent/Risk/Budget/Meeting/System) with date grouping (Today/Yesterday/Earlier)
- **Customizable layout** -- Toggle widget sections on/off via Customize dropdown; drag-and-drop reordering with grip handles; size-aware layout (third-width widget grouping); preferences persisted to server (syncs across devices) with localStorage as instant cache; "Reset to Default Layout" button

### Dashboard & Projects
- **Dashboard** (`/dashboard`) -- Monitoring cockpit with 6 clickable KPI tiles (with status dots and 7-day trend arrows), scope toggle (My Projects / All), Portfolio Intelligence banner (with trend context), Action Center (priorities + AI next-best-actions with confidence/risk/health badges), sortable Projects Table, Issues Trend chart, Milestones, Budget Watch, and Activity Feed (with filter pills and date grouping). Drag-and-drop widget reordering with server-persisted preferences. Full dark mode support.
- **Projects** (`/projects`) -- Filterable project card grid with health-based card borders, search/filter bar, AI portfolio insights panel, and inline New Project via template picker. Clicking a card navigates to `/project/:id` with full Gantt/Kanban/Calendar/EVM detail.
- Shared PM components in `src/client/src/components/pm/`, types in `src/types/pm.ts`
- Opt-in widgets available: Sprint Snapshot, Goals Progress, Team Workload (disabled by default)

### Notifications
- In-app notification center
- Full-page Notifications Center (`/notifications`) with severity summary cards (Critical, High, Medium, Low), type/severity filters, and full notification list with mark-read controls; "Load More" pagination for large notification lists
- Individual mark-as-read calls the server API so read state persists across page refreshes
- Real-time WebSocket push notifications
- Server-persisted per-category notification preferences with independent in-app and email toggles (6 categories: Agent & Proposals, Risks & Issues, Budget & Finance, Meetings, System Alerts, Deadlines)
- Email notifications for critical/high severity events (respects per-category email preference)
- Daily and weekly email digests (overdue tasks, upcoming deadlines, unread count)
- Trial reminder emails: daily cron at 09:00 sends 3-day, 1-day, and expired-trial notices via Resend; Redis-backed dedup prevents duplicate sends
- **Viewer Invite Flow** — Consultant/SME/Enterprise users can invite client stakeholders as free viewer accounts (5 / 20 / unlimited invites per tier respectively); viewers get read-only access scoped to the inviting user's projects
- **Feature gating** — Trial accounts are restricted from advanced features (exports, EVM, Monte Carlo, etc.); `requireTier`/`requirePaidTier` middleware enforces tier checks server-side on protected routes

### Client / Stakeholder Portal
- External-facing read-only project views with progress, budget, milestones, and recent activity
- Scoped access for stakeholders with configurable permissions per link
- Milestone timeline and completed-task feed replace placeholder sections

### Intake Forms
- Configurable intake form builder
- Submission review and approval workflow

### Project Templates
- Save and apply project templates
- Pre-configured task structures and workflows

### External Integrations
- Jira, GitHub, Slack, and Trello integration adapters
- Bi-directional sync support (partial — adapter framework implemented)

### Webhooks
- Configurable outbound webhooks for project events
- Retry logic and delivery logs

### API Key Management
- API key generation and revocation
- Per-key rate limiting and scope control

### Auth & Public Route Rate Limiting
- Per-IP rate limiting on login, register, forgot-password, reset-password, and email verification
- Per-IP rate limiting on waitlist join and count endpoints
- Prevents brute-force attacks and abuse on unauthenticated routes

### Immutable Audit Ledger
- Hash-chain integrity for all audit records
- Tamper-evident logging of every mutation
- Full audit trail with actor, action, and timestamp

### Policy Engine
- Configurable policy rules evaluated on project events
- Automated enforcement of organizational standards

### Billing (Stripe)
- Subscription management with tiered pricing (Trial / Consultant / SME / Enterprise), feature comparison matrix, usage equivalents, and sidebar token usage indicator
  - **Trial:** Free, 14 days, 3 projects, 25K AI tokens/month, basic PM features only
  - **Consultant:** $19/mo ($190/yr), unlimited projects, 500K AI tokens/month, all features, 5 viewer invites
  - **SME:** $39/mo ($390/yr), unlimited projects, 1.5M AI tokens/month, all features, 20 viewer invites
  - **Enterprise:** $79/mo ($790/yr), unlimited projects, 5M AI tokens/month, all features, unlimited viewer invites
- Usage-based billing support
- Stripe Checkout and customer portal integration

### Progressive Web App (PWA)
- Installable on desktop and mobile (standalone display mode)
- App-shell caching with Workbox (precaches all static assets)
- Runtime caching: API calls use NetworkFirst (5-min TTL, 10s timeout), static assets use CacheFirst (30-day TTL)
- Auto-updates service worker silently on new deployments
- Offline banner indicator when connection is lost
- Apple mobile web app support (meta tags for iOS home screen)

### Mobile-Optimized Views
- Bottom navigation bar for mobile devices
- Card-based mobile task list with quick status cycling
- Mobile-friendly timesheet with day-by-day card layout
- Responsive schedule views (auto-switches to mobile on small screens)
- Touch-gesture support for Gantt chart: bar drag (move/resize), progress drag, and drag-to-create via single-finger touch events
- Hamburger menu on the public landing page for mobile navigation

### Styled Confirmation Modals
- Reusable `ConfirmModal` component replaces all native `window.confirm()` calls
- Used across: Integrations, Change Requests, Intake Forms, Settings (API keys, webhooks), Report Builder, Goals, and Lessons Learned pages

### Dark Mode
- Full dark theme coverage across all 41 pages and shared components with Tailwind `dark:` classes
- Toggle in the TopBar; preference persisted in `themeStore` (localStorage)

### Project Milestones
- Tasks flagged as milestones (`is_milestone`) render as diamonds on the Gantt chart

### Multi-Dependency Support
- Up to 20 predecessors per task, each with its own type (FS/FF/SS/SF) and lag days
- Stored in `task_dependencies` junction table with `ON DELETE CASCADE`
- API: `dependencies[]` array on create/update payloads (`dependencyId`, `dependencyType`, `lagDays`)
- MS Project-style comma-separated row-number notation in Table view and Gantt left panel (e.g. "3FS+2d,5SS,7"); same format in CSV export
- Dependency health badges per predecessor: green (completed), yellow (in progress), red (overdue)
- Gantt arrows drawn per predecessor, color-coded by health status
- Task form modal: multi-predecessor UI with add/remove rows, type dropdown, and lag field per entry
- Inline predecessor editing in Table view with comma-separated syntax and validation
- Server-side validation per dependency: self-reference, circular, cross-schedule, existence, and 20-predecessor limit (400 errors)
- Orphan cleanup via `ON DELETE CASCADE` — deleting a task removes all its dependency records automatically

### Kanban WIP Limits
- Per-column Work-In-Progress limits on the Kanban board
- Limits stored in localStorage; columns visually flag when the limit is exceeded

### Comment @Mentions
- `@username` autocomplete in task comment input
- Mentioned users receive in-app notifications automatically

### Global Search
- Full-text search across 9 entity types: projects, tasks, RAID items, goals, lessons learned, resources, change requests, sprints, and task comments
- Enriched results with contextual fields: priority and assignee for tasks, severity and record ID for RAID items, progress for goals
- Optional filters: `type` (comma-separated entity types), `project` (scope to project ID), `status` (filter by status)
- Response includes result count and query timing (`total`, `queryMs`)
- All entity queries run in parallel with graceful per-entity fallbacks

### Bulk Import (CSV / Excel)
- Upload CSV or Excel (.xlsx, .xls) files to import tasks into a schedule
- Multi-sheet Excel support with sheet selector
- Column mapping UI with preview before import is committed
- Duplicate detection (same name + start date skipped)
- 5MB file size limit (client and server enforced)
- Schedule existence validation before import

### Gantt PDF Export
- Print-friendly Gantt export via `window.print()`; triggered from the schedule toolbar

### MS Project XML Export (MSPDI)
- Export project data as MSPDI XML compatible with MS Project and ProjectLibre
- Includes tasks (WBS, outline levels, durations, milestones, predecessors), resources, and assignments
- Endpoint: `GET /api/v1/exports/projects/:id/export?format=xml`
- "Export XML" button on the Project Detail page

### Goals / OKR Tracking
- Objectives and Key Results with progress tracking and nested hierarchy
- OKRs can be linked to projects via a project dropdown (replaces the previous free-text Project ID input) for portfolio alignment

### Time Zone Support
- Per-user timezone preference; all dates displayed in the user's local timezone
- Preference stored server-side and applied on the frontend

### Multi-Language (i18n)
- English, French, and Spanish translations
- Locale selection in user settings; active locale managed via `localeStore` and `useTranslation` hook

### Accessibility + Adaptive UI
- User-configurable accessibility preferences (high contrast, font size 12-24px, reduced motion, text simplification level)
- Server-persisted preferences via `accessibility_preferences` JSON column (migration 034)
- CSS custom properties applied via AccessibilityProvider React context
- Settings page "Accessibility" tab with toggles and sliders
- AI text simplification (mild/strong) via Claude-powered rewriting
- Flesch-Kincaid reading level analysis (algorithmic, no LLM required)
- ReadingLevelBadge component for visual reading difficulty indicators

### Favourite / Pinned Projects
- Star icon on project cards to toggle favourites; favourited projects sort to top
- "Pinned" sidebar section showing up to 5 favourite projects as quick-access links
- `user_favourite_projects` junction table (migration 058), `GET/POST/DELETE` API endpoints
- `GET /api/v1/projects` enriched with `isFavourite` flag per project

### WebSocket Reconnection
- Exponential backoff with jitter (1s base, 30s max, +/-30%, 20 max attempts)
- `ConnectionStatus` indicator in TopBar: green (connected, auto-fades), amber (reconnecting), red (disconnected + Reconnect button)
- `useConnectionState()` hook and `reconnectNow()` exported for programmatic use

### Unified Dashboard
- Single customizable dashboard replaces 5 role-based dashboards (Executive, PM, ScrumMaster, Finance, Risk)
- Scope toggle: "My Projects" vs "All Projects" (appears when user has fewer projects than portfolio total)
- 9 togglable widget sections: KPI tiles, Portfolio Intelligence, Projects table (with health score column), Issues Created vs Resolved chart, Milestones, Budget Watch, Recent Activity, Next Best Actions, Health Trends
- 3 new backend endpoints: `GET /api/v1/dashboard/overdue-tasks`, `issues-trend`, `milestones` with scope filtering
- `?scope=portfolio` support on `/projects` and `/analytics/summary` for cross-role portfolio views

### Multi-Agent Collaboration
- Memory context helper: agents access past reflections and cross-agent insights during reasoning
- InterAgentQueryService: agents query other agents' latest scan results
- InsightAssemblyService: combines multi-agent outputs into unified project health narratives
- Scan orchestrator stores per-project results in `agent_memory` table (24h TTL)
- Scope and budget analysis generators enriched with historical memory context

### Intelligent Dashboard Narratives
- NarrativeService: role-aware plain-language project/portfolio summaries via Claude
- `GET /api/v1/narratives/project/:id` and `GET /api/v1/narratives/portfolio` endpoints
- AISummaryBanner enhanced with AI narrative section (toggleable via accessibility settings)
- Fallback text when AI is unavailable

---

## Architecture

```
                    +-----------+
                    | LiteSpeed |  (static assets: HTML, CSS, JS, images)
                    +-----+-----+
                          |
              +-----------+-----------+
              |                       |
        /api/* routes           static files
              |
     +--------v--------+
     |  Passenger (Node) |
     +--------+---------+
              |
     +--------v---------+
     |   Fastify Server  |
     |  (TypeScript API) |
     +--------+---------+
              |
    +---------+---------+
    |         |         |
    v         v         v
  MySQL    Claude    Stripe
 (MariaDB)  (AI)   (Billing)
```

- **Frontend** is a Vite-built React SPA served as static files by LiteSpeed. Production bundle uses manual chunk splitting (`vendor-react`, `vendor-query`) defined in `vite.config.ts` to improve cache efficiency.
- **Backend** is a Fastify app running under Passenger, handling all `/api/v1/` routes.
- **Analytics & SEO** — GA4 (measurement ID `G-F99Q92ED7M`) is loaded in `index.html` (hardcoded, no env var). `index.html` also includes Open Graph and Twitter Card meta tags. `public/robots.txt` and `public/sitemap.xml` are included for search engine indexing.
- **Repository layer** (`BaseRepository` + entity repos) centralizes SQL and row mapping for core entities; services keep business logic.
- **Structured metrics** via `MetricsService` (request counts, latency percentiles, AI token usage). Admin endpoint: `GET /api/v1/metrics`.
- **Request context** propagated via `AsyncLocalStorage` — request ID included in all log entries.
- **WebSocket** connections are managed by `@fastify/websocket` for real-time updates.
- **MCP Server** runs as a separate process, exposing PM tools via the Model Context Protocol.

---

## Project Structure

```
pm-assistant-generic/
├── src/
│   ├── server/                  # Fastify backend
│   │   ├── routes/              # 50+ route modules (8 domain subdirectories)
│   │   ├── services/            # Business logic & AI services
│   │   │   └── agents/          # Agentic pipeline (reasoning, proposals, execution)
│   │   ├── middleware/          # Auth, rate limiting, policies, request context
│   │   ├── database/            # Repositories, migrations, connection pool
│   │   └── config.ts            # Environment-based configuration
│   ├── client/                  # React frontend (Vite)
│   │   ├── src/
│   │   │   ├── pages/           # 30+ page components
│   │   │   ├── components/      # Reusable UI components
│   │   │   ├── hooks/           # Custom React hooks
│   │   │   ├── services/        # API client layer
│   │   │   └── stores/          # Zustand state stores
│   │   └── vite.config.ts
│   └── shared/                  # Shared types, schemas, utilities
├── mcp-server/                  # MCP server for Claude integration
│   ├── server.ts                # MCP tool definitions & handlers
│   └── package.json
├── demo-agent/                  # CLI demo agent
│   ├── agent.ts
│   └── package.json
├── scripts/                     # DB backup/restore, deployment
├── env.example                  # Environment variable template
├── package.json
└── tsconfig.json
```

---

## MCP Server

The MCP (Model Context Protocol) server exposes 83 tools across 15 groups and 6 read-only resources. Tools are **role-filtered** — each user only sees tools their role permits.

**Tool Groups:** Projects, Schedules, Tasks, Sprints, Resources, Time Tracking, Approvals, Reports, AI Insights (health, risks, budget, spend-to-date, burn rate, EVM, Monte Carlo, risk mitigations, meeting summaries), Auto-Reschedule, Intake, Custom Fields, Integrations, Admin, Templates.

**Resources:** `project://{id}/summary`, `project://{id}/tasks`, `project://{id}/risks`, `project://{id}/financials`, `project://{id}/schedule`.

**Roles:** `admin`, `executive`, `project_manager`, `team_member`, `scrum_master`, `finance_officer`, `risk_manager`, `pmo`, `ba`, `qa`, `tester`, `devops`, `claude_sme` — see `mcp-server/src/permissions.ts` for the full permission matrix.

**Auth:** OAuth 2.1 with PKCE (HTTP mode) or API key (STDIO mode). Role is resolved from the user's database record, not inferred from scopes.

**External Access:** API key Bearer auth and OAuth2+PKCE supported on `/mcp`. Rate limiting applies to both `/api/v1/*` and `/mcp` routes. All tool invocations are logged to `mcp_tool_invocations` for analytics. Admin endpoint: `GET /api/v1/admin/mcp-analytics`.

See [`docs/MCP_EXTERNAL_AGENTS.md`](docs/MCP_EXTERNAL_AGENTS.md) for connection guide and `mcp-server/` for tool definitions.

---

## Development Commands

```bash
# Development
npm run dev                  # Start API + client concurrently
npm run server:dev           # Start Fastify server only (with nodemon)
npm run client:dev           # Start Vite dev server only

# Build
npm run build                # Build server + client for production
npm run build:server         # TypeScript compile (server)
npm run build:client         # Vite build (client)

# Production
npm run start                # Start compiled server (serves API + static)

# Database
npm run db:migrate           # Run database migrations
npm run db:seed              # Seed initial data

# Testing (42 test files, 440 tests — agents, core services, policy engine, permissions)
npm run test                 # Run tests (Vitest)
npm run test:unit            # Run unit tests once

# Code Quality
npm run lint                 # ESLint check
npm run lint:fix             # ESLint auto-fix
npm run type-check           # TypeScript type check (no emit)
```

---

## Environment Variables

Copy `env.example` to `.env` and configure:

| Variable | Description | Required |
|----------|-------------|----------|
| `DB_HOST` | MySQL host | Yes |
| `DB_PORT` | MySQL port (default: 3306) | Yes |
| `DB_USER` | MySQL username | Yes |
| `DB_PASSWORD` | MySQL password | Yes |
| `DB_NAME` | MySQL database name | Yes |
| `JWT_SECRET` | Secret for signing access tokens | Yes |
| `JWT_REFRESH_SECRET` | Secret for signing refresh tokens | Yes |
| `COOKIE_SECRET` | Secret for cookie signing | Yes |
| `PORT` | API server port (default: 3001) | No |
| `AI_ENABLED` | Enable AI features (`true` / `false`) | No |
| `ANTHROPIC_API_KEY` | Anthropic API key (required if AI enabled) | No |
| `STRIPE_SECRET_KEY` | Stripe secret key | No |
| `STRIPE_WEBHOOK_SECRET` | Stripe webhook signing secret | No |
| `RESEND_API_KEY` | Resend API key for transactional email | No |

Generate secrets with:

```bash
openssl rand -base64 32
```

---

## API Documentation

Interactive Swagger documentation is available at `/documentation` when the server is running.

All API endpoints are versioned under `/api/v1/`. Endpoint groups (50+ route modules):

| Group | Prefix | Purpose |
|-------|--------|---------|
| Auth | `/api/v1/auth` | Login, register, refresh, logout, password reset |
| Projects | `/api/v1/projects` | Project CRUD and membership (paginated: `?limit=&offset=`) |
| Users | `/api/v1/users` | User management |
| Schedules | `/api/v1/schedules` | Schedule and task management (tasks paginated: `?limit=&offset=`) |
| Sprints | `/api/v1/sprints` | Sprint lifecycle (paginated: `?limit=&offset=`) |
| Resources | `/api/v1/resources` | Resource pool (paginated: `?limit=&offset=`) |
| Time Entries | `/api/v1/time-entries` | Time tracking |
| Custom Fields | `/api/v1/custom-fields` | Custom field definitions and values |
| Attachments | `/api/v1/attachments` | File upload and management |
| Notifications | `/api/v1/notifications` | In-app notification center |
| Portal | `/api/v1/portal` | Stakeholder portal |
| Intake | `/api/v1/intake` | Intake form builder and submissions |
| Templates | `/api/v1/templates` | Project templates (paginated: `?limit=&offset=`) |
| Integrations | `/api/v1/integrations` | Third-party integrations |
| Webhooks | `/api/v1/webhooks` | Outbound webhook management |
| Workflows | `/api/v1/workflows` | DAG workflow engine (+ `POST /generate` for AI generation) |
| Approvals | `/api/v1/approvals` | Change request approval chains |
| Report Builder | `/api/v1/report-builder` | Custom report templates |
| AI Reports | `/api/v1/ai-reports` | AI-generated narrative reports |
| AI Budget | `/api/v1/ai/budget` | Per-tier AI token budget, usage, and top-up balance |
| AI Task Estimation | `/api/v1/ai/estimate-task` | AI-powered task duration estimation |
| Stripe | `/api/v1/stripe` | Multi-tier billing, subscriptions, and token top-ups |
| API Keys | `/api/v1/api-keys` | API key management |
| Audit | `/api/v1/audit` | Immutable audit ledger |
| Policies | `/api/v1/policies` | Policy engine rules |
| Search | `/api/v1/search` | Full-text search (9 entity types, filters: type/project/status) |
| Bulk | `/api/v1/bulk` | Bulk operations |
| Portfolio | `/api/v1/portfolio` | Portfolio overview, analytics, resources |
| Analytics | `/api/v1/analytics` | Portfolio analytics summary |
| Alerts | `/api/v1/alerts` | Proactive alert feed |
| Predictions | `/api/v1/predictions` | AI health, risk, budget predictions |
| Intelligence | `/api/v1/intelligence` | Cross-project intelligence |
| EVM Forecast | `/api/v1/evm-forecast` | Earned value forecasting |
| Monte Carlo | `/api/v1/monte-carlo` | Monte Carlo simulation |
| Network Diagram | `/api/v1/network-diagram` | Precedence diagram layout |
| Burndown | `/api/v1/burndown` | Sprint burndown data |
| Resource Leveling | `/api/v1/resource-leveling` | Histogram and leveling |
| Resource Optimizer | `/api/v1/resource-optimizer` | AI resource optimization |
| Auto-Reschedule | `/api/v1/auto-reschedule` | AI reschedule proposals |
| NL Query | `/api/v1/nl-query` | Natural language queries |
| AI Scheduling | `/api/v1/ai-scheduling` | AI task breakdown |
| Mjuzi Chat | `/api/v1/ai-chat` | Persistent conversational AI assistant |
| Task Prioritization | `/api/v1/task-prioritization` | AI task ranking |
| Meeting Intelligence | `/api/v1/meeting-intelligence` | Transcript analysis |
| Lessons Learned | `/api/v1/lessons-learned` | Retrospective knowledge base |
| Learning | `/api/v1/learning` | AI learning feedback |
| Exports | `/api/v1/exports` | Data export (CSV, PDF, MSPDI XML) |
| Agent | `/api/v1/agent` | Agent scheduler, health, and kill switch |
| Agent Proposals | `/api/v1/agent/proposals` | Proposal lifecycle (list, approve, reject, execute, feedback) |
| Agent Autonomy | `/api/v1/agent/autonomy` | Tier 3 autonomy configuration, promotion/demotion |
| Agent Log | `/api/v1/agent-log` | Agent activity log |
| RAG | `/api/v1/rag` | Semantic search |
| WebSocket | `/api/v1/ws` | Real-time updates |
| MCP | `/mcp` | MCP HTTP transport proxy |
| Goals / OKR | `/api/v1/goals` | Objectives and Key Results CRUD |
| Task Import | `/api/v1/schedules/:id/import` | Bulk CSV task import |
| User Preferences | `/api/v1/users/me/preferences` | Timezone and locale preferences |
| Admin Tenants | `/api/v1/admin/tenants` | Multi-tenant org management (list, update, provision, migrate) |
| Admin Users | `/api/v1/admin/users` | User listing with login status, unlock stuck login tokens, subscription status |
| Admin Revenue | `/api/v1/admin/revenue` | MRR, subscriber counts by tier (Trial/Consultant/SME/Enterprise), churn, top-up revenue, trial conversion, trend data (admin only) |
| Admin Subscription Events | `/api/v1/admin/users/:id/subscription-events` | Per-user subscription lifecycle event history (admin only) |
| Admin MCP Analytics | `/api/v1/admin/mcp-analytics` | MCP tool invocation stats — group by tool/user/day, success rate, latency (admin only) |

---

## License

MIT
