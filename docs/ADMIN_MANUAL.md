# PM Assistant -- Admin Manual

This manual is for **system administrators** who manage users, projects, and platform configuration for PM Assistant, an enterprise project management platform.

---

## 1. Roles and Access

| Role          | Access                                                              |
|---------------|---------------------------------------------------------------------|
| **admin**     | The Kovarti platform admin only (see below). Never a company member. |
| **executive** | Read-only portfolio view, analytics dashboards, KPI summaries.      |
| **manager**   | Create/manage projects, assign members, run reports, approve tasks. |
| **member**    | View and work on assigned projects, log time, update tasks.         |

Managers operate within projects they own or are assigned to. Members participate in their assigned work.

**The company owner works as PMO (October 2026).** Whatever role the owner has, the server gives them a PMO's permissions inside their company (`utils/companyOwner.ts` → `permissionRole`, applied in `authMiddleware` for cookie and API-key/Claude sign-ins, and sent as `role` by `/auth/login` and `/auth/me`; `accountRole` is their own role, shown as "your role"). Never during the admin's Support view; guests are never elevated.

**"Admin" means the Kovarti platform admin — and nothing else (October 2026).** The platform admin is the account with the `admin` role **and no company**: it owns nothing and has no projects. It reaches the admin pages (all companies, plans, users and password resets, revenue, logs, waitlist, feedback, the AI kill switch and skills) and can open a read-only, recorded **Support view** into one company. Company owners **cannot** give anyone the admin role: it isn't in Settings → Team, and the server refuses it ("Admin is reserved for the Kovarti platform team…"). The owner's own role can't be changed by anyone else, and a member removed from a company never keeps the admin role. The account is created by hand on the server (`seed-admin.sql`); never give it a company. Before October 2026 the admin pages only checked the role, and the company invite list offered "Admin" — that is how a company member could have become a platform admin.

---

## 2. User Management

### Creating Users
- Navigate to **Settings > Users > Add User**.
- Provide name, email, role, and initial password.
- Users receive an email invitation if SMTP is configured.

### Editing Users
- Update role, display name, email, or deactivate accounts.
- Role changes take effect on the user's next request (JWT re-issued on login).

### Password Management
- Admins can trigger a password reset email or set a temporary password.
- Enforce password complexity via `PASSWORD_MIN_LENGTH` and `PASSWORD_REQUIRE_SPECIAL` env vars.

### Users Table Columns

The **Admin > Users** table displays 14 sortable columns. Click any column header to sort ascending/descending.

| Column | Description |
|--------|-------------|
| User | Full name, email, username |
| Role | Color-coded role badge |
| Tier | Subscription tier badge (Trial, Consultant, SME, Enterprise) |
| Organization | Multi-tenant organization name (or "none") |
| Signed up | Account creation date |
| Login status | Verified / **Never confirmed** / Pending login / Expired token |
| Last login | Most recent login timestamp |
| Projects | Number of projects owned |
| AI Usage | Token consumption progress bar with percentage (current month vs budget) |
| AI Budget | Per-user override or "tier default" (inline-editable) |
| Subscription | Current subscription status badge (active, trialing, past_due, canceled, none) and period-end date |
| Status | Active/Inactive toggle |
| Actions | Reset PW, Unlock (for stuck login tokens), View subscription event history |

**Filters:** Text search (name, email, username, organization), role dropdown, tier dropdown, status dropdown, subscription status dropdown.

**Never confirmed sign-ups (October 2026).** Someone who filled in the sign-up form but never clicked "confirm your email" (so never signed in) is labelled **Never confirmed** — on Users, on the Tenants list when the company's owner is one, and on Operations. They are left out of the user counts (Operations: **Total Users**, per company and in total); the Total Users card shows how many there are underneath ("+ N never confirmed (not counted)"). Nothing is deleted: if they confirm later they become a normal account and trial. Rule: `constants/neverConfirmed.ts` (email not verified and never logged in).

### Subscription Event History

Click the **history icon** in a user's Actions column to open the **Subscription Event History** modal. It lists every subscription lifecycle event for that user in reverse-chronological order:

| Field | Description |
|-------|-------------|
| Event | Type of event (tier_change, cancellation, renewal, payment_failure, topup_purchase, trial_started, trial_converted) |
| From → To | Previous tier and new tier (where applicable) |
| Amount | Revenue amount in the account currency (for payment events) |
| Date | Timestamp of the event |

**API:** `GET /api/v1/admin/users/:id/subscription-events` (admin only).

### Login Status & Unlock

Login status badges indicate email verification and login token state:

| Status | Meaning |
|---|---|
| **Verified** (green) | Email verified, no pending login token. Normal state. |
| **Unverified** (gray) | Email address not yet verified. |
| **Pending login** (yellow) | A login verification token has been issued and is awaiting confirmation. |
| **Expired token** (red) | The login verification token has expired. User cannot complete login. |

When a user has a pending or expired login token, an **Unlock** button appears in the Actions column. Clicking it clears the login verification token so the user can attempt login again.

**API:** `POST /api/v1/admin/users/:id/clear-login-token` (admin only).

### Deleting Users
- Deactivate accounts before deletion to preserve audit history.
- Deleted users are soft-deleted; their audit trail entries remain intact.

---

## 3. Project Administration

### Creating Projects
- **Projects > New Project** -- set name, description, start/end dates, and budget.
- Assign a project manager (must have `manager` role).
- Optionally apply a **project template** to pre-populate tasks and milestones.
- The creator is **automatically added as project owner** in the project members list.

### Managing Members
- Add or remove members from a project's **Team** tab.
- Set per-project roles: **owner**, **manager**, **editor**, **viewer**.

### Project-Level Access Control

Project membership is enforced on all project-scoped API routes. Only members of a project can access its data. Non-members receive a `404 Not Found` response (to prevent information leakage).

| Project Role | Read | Write (create/edit) | Delete own items | Delete others' items | Admin (manage members) |
|---|---|---|---|---|---|
| **owner** | Yes | Yes | Yes | Yes | Yes |
| **manager** | Yes | Yes | Yes | Yes | No |
| **editor** | Yes | Yes | Yes | No | No |
| **viewer** | Yes | Time entries on assigned tasks only; RAID items they own; comments on assigned tasks | No | No | No |
| **Non-member** | 404 | 404 | 404 | 404 | 404 |

**Global role bypasses:** A `pmo` (and the company owner, who works as PMO) can access every project **in their own company** without membership. Users with the `executive` role have read-only access to their company's projects. A project in another company answers "not found" to everyone (October 2026). The platform `admin` has no company and sees customer projects only through the read-only Support view.

**Viewer time logging:** Viewers can log time entries on tasks assigned to them and edit their own time entries. They cannot delete time entries or modify schedule data (tasks, dates, assignments). Schedules are fully read-only for viewers — all editing controls are hidden in the UI.

**Viewer sidebar:** Viewers and team_members see a reduced sidebar: role-restricted items (Clients, Portfolio, Resources, Meeting Intelligence, Change Requests, Workflows, Intake, Integrations, Analytics, EVM Dashboard, Simulation, Scenario Modeling, Report Builder, AI Proposals) are left out of their menu, and typing one of those addresses opens their Dashboard. The menu and the router use one role-to-pages map (`src/client/src/constants/roleRoutes.ts`). The server still decides what data each person can read.

> **Important:** Project roles (owner/manager/editor/viewer) are separate from global user roles (admin/executive/project_manager/team_member/etc.). A user needs both: a global role with sufficient scope *and* a project role with sufficient access.

### Pinned Project Links

Each project supports a set of pinned links (e.g., Confluence pages, Figma files, Jira boards) accessible to all project members.

| Method | Endpoint | Min Role | Description |
|--------|----------|----------|-------------|
| `GET` | `/api/v1/projects/:projectId/links` | viewer | List all pinned links for the project |
| `POST` | `/api/v1/projects/:projectId/links` | editor | Create a new pinned link |
| `PUT` | `/api/v1/projects/:projectId/links/reorder` | editor | Reorder pinned links |
| `PUT` | `/api/v1/projects/:projectId/links/:linkId` | editor | Update a pinned link |
| `DELETE` | `/api/v1/projects/:projectId/links/:linkId` | editor | Delete a pinned link |

All endpoints require project membership enforced by `requireProjectAccess`.

### Archive (and, on some plans, Delete)
- **Archive is the normal way to retire a project.** The project's Manager or Owner presses **Archive project** on its card in the Projects list; it leaves the active views and every record is kept. **Unarchive** brings it back.
- **Delete** permanently removes the project. It is offered only on single-user plans (trial and consultant), only to the project's Owner, from **Edit project → Delete Project** (they type the project name to confirm; an audit entry is created). Team plans (SME and Enterprise) cannot delete projects at all — the server refuses with "Archive the project instead." The sample project can never be deleted.
- Kovarti support never deletes or archives a customer's project.

### Rate Card
- **Settings → Rate card** holds hourly cost rates by role, each with a start date (`rate_card`, tenant migration T063 — one card per company database). Admins, PMO, project managers and the company owner see and change it; the tab is hidden from everyone else and the API answers 403.
- A resource is costed from the card only when its form says **Use rate card** (`resources.use_rate_card`); every existing resource started on its own rate, so no cost changed when this shipped. A role with no card rate yet falls back to the resource's own rate.
- Costs use the rate in force for the week the work happened. Two lines for the same role and start date are refused.

### Company Holidays and Working Calendars
- **Settings → Company holidays** holds one holiday list for the company; every project's working calendar treats those dates as days off. The company owner, an admin or PMO can add or remove dates; others see the list read-only.
- Each change shows a preview first — how many tasks would move in how many active projects — and nothing is saved until **Apply**. Applying moves tasks in every affected plan and records a line in each plan's Schedule History (Undo puts the dates back; the holiday stays).
- A project's Manager/Owner can add its own days off, or mark a company holiday (or a Saturday) as a working day for that project only, from **Working calendar** in the schedule toolbar.
- Holidays differ by province and company, so the list starts empty.
- One-time clean-up after the first deploy with working calendars: `dist/server/scripts/moveTasksOffDaysOff.js` (see DEPLOYMENT_GUIDE.md checklist).


### People, line managers, the month lock and sponsors (October 2026)
These are company settings the owner looks after; Kovarti support never changes them.
- **Who manages the people list.** Project managers keep adding and editing ordinary people on **Resources → Team** (**Add person**, skills, rates, availability, import). Only the **company owner or a PMO** may: choose or change someone's **line manager**; change the email of someone who signs in (or add a person whose email belongs to a login); delete someone who signs in, or remove their login; link or unlink a person's login (only to a login of the same company). Nobody but the owner can change the owner's own record. Rule: `services/peopleRights.ts`.
- **Line manager.** Every person has one: the person who approves their weekly timesheet. If none is chosen it is the company owner. It can be changed but not removed. The owner also sees, in their approvals queue, any sheet that has no approver.
- **Month lock.** Hours lock month by month: a month closes on the **5th of the following month** (in the company's time zone). After that nobody can add, change, move or delete hours on a day in that month. Submitting and approving hours already entered still works. The day is fixed in the code (`MONTH_LOCK_DAY` in `WeeklyTimesheetService.ts`); there is no setting and no unlock screen.
- **Sponsor.** Each project can name a sponsor (Edit project → Sponsor, by the project's Manager/Owner): a company user, who is added to the project as a Viewer, or a person with an email but no login. Nothing reaches the sponsor automatically — the PM escalates a RAID item with **Send to sponsor**.

### Sample Project (optional since October 2026)
- Every company database is created by the tenant migrations, which include the read-only sample "Sample Web App Development" (`T033`, project id `demo-sample-webapp`, every row id starting `demo-`). **New companies have it removed straight after provisioning** (`tenantProvisioner.ts` → `SampleProjectService.remove`), so they start clean.
- **Existing companies keep their sample** until their owner or a PMO presses **Remove…** in **Settings → Sample project**. **Load** re-runs the seed (INSERT IGNORE, so it is safe twice). The setup wizard offers the same Load as "Explore a sample project first".
- Who may: the company owner or a PMO (`/api/v1/sample-project`, `…/remove`, `…/load`); everyone else gets 403. Kovarti support never loads or removes it for a customer (admin is read-only on customer data).
- Removing deletes, in one transaction, every row pointing at the sample project, its schedules, its tasks or its example people (found through `information_schema`), then the seed's own `demo-` rows. Nothing without a `demo-` link is touched. The append-only audit ledger is never deleted from. An example person the company's own work uses (a real task assigned to them, a booking, a RAID owner) is **kept** with their rows, and the page names them.
- While loaded, the sample is excluded from company-wide totals (portfolio, dashboard, budgets/EVM, capacity and workload, Team Planner, briefing, alerts, reports).
- **No weekend dates (October 2026).** The seed's fixed dates put some tasks, sprints, meetings, a timesheet line, expenses, risk dates and a time-off block on Saturdays/Sundays. `T081_sample_no_weekends.sql` moves each to the Friday before, in every company (sample rows only). **Load** runs the seed and then its fixes (`SampleProjectService.SAMPLE_FIX_FILES`: T076 spend, T081 weekends), so a reloaded sample matches.

---

## 4. System Configuration

### Environment Variables

Key variables in `.env` (never commit secrets):

| Variable              | Purpose                                     |
|-----------------------|---------------------------------------------|
| `DATABASE_URL`        | MySQL/MariaDB connection string             |
| `JWT_SECRET`          | Token signing secret                        |
| `COOKIE_SECRET`       | Session cookie signing secret               |
| `AI_ENABLED`          | Enable/disable Claude AI features (`true`/`false`) |
| `ANTHROPIC_API_KEY`   | Anthropic API key (required if AI enabled)  |
| `STRIPE_SECRET_KEY`   | Stripe billing integration                  |
| `SMTP_HOST` / `SMTP_PORT` | Outbound email configuration            |
| `CORS_ORIGIN`         | Allowed CORS origins                        |
| `BASE_URL`            | Public-facing URL of the application        |
| `MULTI_TENANT_ENABLED` | Enable database-per-customer multi-tenancy (`true`/`false`) |

### AI Features Toggle
- Set `AI_ENABLED=true` and provide `ANTHROPIC_API_KEY` to enable AI-powered features (task suggestions, risk analysis, natural language queries).
- When disabled, all AI endpoints return a 503 with a descriptive message.

### Server Settings
- **Fastify** listens on `PORT` (default 3001) behind **Nginx** in production, run as the `pm-app` systemd service.
- Static assets are served directly by Nginx from `/opt/pm-app/client-dist`; API routes proxy to Fastify.
- CSP headers are managed by Helmet (currently in report-only mode).
- **Health Snapshot Cron** — A daily job (`pm-cron@health-snapshot`) runs at 03:00 UTC to snapshot each active project's health score into the `project_health_history` table (migration 038). This data powers the Health Trends sparklines on the dashboard. A manual trigger is available at `POST /api/v1/predictions/health/snapshot` (admin only).
### Scheduled jobs — where they are defined

Scheduled work does **not** run inside the app. It runs as systemd timers on each
server, invoked as `node dist/server/scripts/runCronJob.js <job-name>`. The old in-process
scheduler (`startCronTasks` in `cronManager.ts`) was never called and was removed on
2026-10-08; `cronManager.ts` now only holds the `forEachTenant` helper and the overdue scan.

The unit files live in **`deploy/systemd/`** in the repository and are installed and
enabled by every `deploy.sh` run, which then fails the deploy if any expected job is not
enabled afterwards. Adding a job needs three things: the job module, a `case` in
`runCronJob.ts`, and a `.timer` file in `deploy/systemd/`.

> **History.** Before 2026-09-18 these were set up by hand, once per machine, and
> recorded nowhere. Staging was configured when the move to systemd happened on
> 2026-07-14; production never was, so production ran **no scheduled jobs at all** for
> two months. Nothing reported it: the app logs "Cron jobs managed externally via
> systemd timers" on startup and never checked. `AlertService.checkCronJobsRunning()`
> is now the standing check — every job records `cron:last:<job>` in Redis when it runs,
> and a job that goes quiet, or has no record at all, raises an alert.

Run one by hand: `sudo systemctl start pm-cron@<name>.service`
**Scheduled automations, calendar sync, storage sync** (`pm-cron@scheduled-automations` every 5 min, `pm-cron@calendar-sync` and `pm-cron@storage-sync` every 15 min; Oct 2026). Until then they existed only in the in-process scheduler, which nothing starts, so they never ran. Every job must have both a `runCronJob.ts` case and a timer file (guard: `__tests__/scripts/scheduledJobsWired.test.ts`); `deploy.sh` installs and enables every timer it finds.

**Weekly PM review** (`pm-cron@pm-weekly-review`, Oct 2026) fires every hour Thursday–Saturday UTC but only does work for a company in the hour when it is **Friday 07:00 in that company's time zone**; a repeat firing in the same week does nothing.

Inspect: `systemctl list-timers 'pm-cron@*'` and `journalctl -u pm-cron@<name>.service`

- **Trial Reminder Cron** — A daily job (`pm-cron@trial-reminder`) runs at 09:00 UTC to send trial expiry reminder emails. It sends emails at the 7-day, 3-day and 1-day warnings, and on expiry. It only ever touches free-tier trials (`subscription_tier = 'trial'`) — a paying customer is never told their trial is expiring, and the expired-trial downgrade in the same job carries the same restriction so it cannot lock out an account that has paid. Emails use a polished dark-themed HTML template matching the Kovarti brand (teal accent bar, logo, status badge, gradient CTA button, reassurance info points, responsive layout, dark-mode CSS, Outlook VML fallback). Redis-backed deduplication prevents repeat sends: each reminder is keyed as `trial-reminder:{userId}:{type}` with a 30-day TTL. Implementation: `src/server/services/scheduling/trialReminderJob.ts`, template: `buildTrialEmailHtml()` in `EmailService.ts`.
- **Pending Payment Sweep** — Daily at 09:30, `src/server/services/scheduling/pendingPaymentJob.ts`. Looks after accounts stuck in `incomplete` (chose a paid plan, never completed checkout). For each one it asks Stripe directly whether the payment in fact succeeded and activates the account if so — this is the backstop behind `POST /stripe/reconcile`, which the client calls when someone returns from checkout, and it exists because a dropped webhook would otherwise lock out a customer who has paid. Genuinely unpaid signups get one reminder email after 2 days (Redis key `pending-payment-reminded:{userId}`) and the empty account is deactivated after 14 days, unless it already owns a provisioned workspace, in which case it is left for a human. An account that cannot be verified with Stripe is never acted on.

### Tier ENUM and Feature Gating

The subscription tier is stored as a `tier` ENUM column on both the `users` table (single-tenant) and the `organizations` table (multi-tenant). Valid values are: `trial`, `consultant`, `sme`, `enterprise`.

**Migration 067** automatically migrates all existing data from the old tier names:

| Old value | New value |
|-----------|-----------|
| `free` | `trial` |
| `pro` | `consultant` |
| `business` | `sme` |
| `consultant` | `enterprise` |

**`requirePaidTier` middleware** blocks trial users from accessing advanced features. Any route decorated with this middleware returns `403 Forbidden` when the requesting user is on the `trial` tier. Paid tiers (consultant, sme, enterprise) pass through without restriction. When such a refusal answers a change (not a page load), the app opens the **Part of a paid plan** window with **View Plans** (October 2026); page loads stay quiet.

---

## 5. Billing and Subscriptions (Stripe)

### Plans

Three paid tiers are available, each with monthly and annual billing:

| Tier | Monthly | Annual | AI Tokens/mo | Viewer Invites |
|------|---------|--------|--------------|----------------|
| Consultant | $19 | ~$190 | 500,000 | 5 |
| SME | $39 | ~$390 | 1,500,000 | 20 |
| Enterprise | $79 | ~$790 | 5,000,000 | Unlimited |

Trial accounts are free, limited to 14 days, 3 projects, and 5K AI tokens (~10 AI chats to explore Mjuzi). Consultant Basic ($19/mo) includes core PM features plus resource management, reports, and workflow automation — but no AI. Consultant Pro ($29/mo) adds all AI features with 500K tokens/month. Annual billing saves ~17%.

> **Viewer invites:** Viewer accounts are free — invited viewers do not need a subscription. The invite limit is per paid account (Basic: 5 / Pro: 15 / SME: 20 / Enterprise: unlimited).

Map Stripe price IDs to app tiers via env vars:
- `STRIPE_CONSULTANT_NEW_MONTHLY_PRICE_ID`, `STRIPE_CONSULTANT_NEW_ANNUAL_PRICE_ID`
- `STRIPE_SME_MONTHLY_PRICE_ID`, `STRIPE_SME_ANNUAL_PRICE_ID`
- `STRIPE_ENTERPRISE_MONTHLY_PRICE_ID`, `STRIPE_ENTERPRISE_ANNUAL_PRICE_ID`

### Token Top-Ups

Users can purchase additional AI token packs at any time: **500,000 tokens for $5** per pack (1-20 packs per purchase). Top-up tokens are added instantly, do not expire, and are consumed only after the monthly tier allowance is exhausted. Configure via `STRIPE_TOPUP_PRICE_ID`.

**Endpoints:**
- `POST /api/v1/stripe/create-topup-session` — creates Stripe checkout for token purchase
- `GET /api/v1/stripe/topup-balance` — returns remaining top-up tokens and purchase history

### Managing Subscriptions
- View active subscriptions under **Settings > Billing**.
- Upgrade, downgrade, or cancel subscriptions from the Stripe billing portal.
- Stripe webhooks (`/api/webhooks/stripe`) handle payment events and top-up fulfillment automatically.

### AI Budget Administration

Admins can override per-user AI token budgets from the **Admin > Users** page:
- The **AI Budget** column shows each user's current budget (custom override or "tier default").
- Click the value to inline-edit. Set a custom budget or clear to revert to tier default.
- **API:** `PATCH /api/v1/admin/users/:id/budget` with body `{ budget: number | null }`.

Tier budget defaults are displayed on the **Admin > Configuration** page under "Tier Budget Defaults". These are configured via env vars (`AI_TIER_BUDGET_TRIAL`, `AI_TIER_BUDGET_CONSULTANT`, `AI_TIER_BUDGET_SME`, `AI_TIER_BUDGET_ENTERPRISE`).

### Revenue Dashboard

Navigate to **Admin > Revenue** (`/admin/revenue`) for a real-time financial overview of all subscriptions and billing activity. This page is visible to admin users only.

**Key Metrics (top row):**

| Metric | Description |
|--------|-------------|
| MRR | Monthly Recurring Revenue — sum of all active monthly subscriptions plus annuals normalized to monthly |
| Subscribers by Tier | Counts of active subscribers at Trial, Consultant, SME, and Enterprise tiers |
| Churn Rate | Percentage of subscribers who cancelled in the current calendar month |
| Top-Up Revenue | Total one-time revenue from AI token top-up purchases (current month) |
| Trial Conversion | Percentage of trials that converted to a paid subscription |

**Revenue Trend Chart:** A 12-month bar chart showing MRR by month, broken down by tier, powered by `subscription_events` data.

**Recent Events Feed:** A live feed of the latest subscription lifecycle events across all users — tier upgrades/downgrades, cancellations, renewals, payment failures, and top-up purchases — with user name, event type, amount, and timestamp.

**API:** `GET /api/v1/admin/revenue` (admin only). Returns MRR, subscriber counts by tier (trial/consultant/sme/enterprise), churn rate, top-up revenue, trial conversion rate, monthly trend data, and recent events.

### subscription_events Table

Every subscription lifecycle event is persisted to the `subscription_events` table by `StripeService`. This drives both the Revenue Dashboard and the per-user event history modal.

| Column | Description |
|--------|-------------|
| `id` | UUID primary key |
| `user_id` | FK to users table |
| `event_type` | `tier_change`, `cancellation`, `renewal`, `payment_failure`, `topup_purchase`, `trial_started`, `trial_converted` |
| `from_tier` | Previous subscription tier (nullable) |
| `to_tier` | New subscription tier (nullable) |
| `amount_cents` | Revenue amount in cents (0 for non-payment events) |
| `currency` | ISO 4217 currency code (e.g., `usd`) |
| `stripe_event_id` | Stripe event ID for deduplication |
| `metadata` | JSON blob for additional context |
| `created_at` | Timestamp of the event |

### Stripe Dashboard
- Use the Stripe Dashboard for invoice management, refunds, and payment method issues.
- Ensure `STRIPE_WEBHOOK_SECRET` is set for webhook signature verification.

### Billing Route Scope
- The billing routes (`create-checkout-session`, `billing-portal`) use `requireScope('read')` so that all authenticated users — including those with the `team_member` role — can manage their own subscriptions.
- This is intentional. Do not change these routes to require `write` scope.

---

## 6. API Key Management

### Generating Keys
- **Settings > API Keys > Generate** -- create keys scoped to specific permissions.
- Available scopes: `read`, `write`, `admin`.
- Keys are shown once at creation; store them securely.

### Rate Limiting
- Default rate limits: 100 requests/minute per key.
- Configure via `API_RATE_LIMIT` and `API_RATE_WINDOW` env vars.

### Revoking Keys
- Revoke compromised or unused keys immediately from **Settings > API Keys**.
- Revocation is instant; in-flight requests with the revoked key will fail.

---

## 7. Authentication

### JWT Dual-Token Strategy
- **Access token:** HTTP-only cookie (`access_token`), 15-minute expiry.
- **Refresh token:** HTTP-only cookie (`refresh_token`), 7-day expiry.
- Both cookies use `secure: true` in production, `sameSite: 'lax'`.

### Login Flow
1. User submits credentials to `POST /api/v1/auth/login`.
2. Server validates password (bcrypt) and issues both tokens as HTTP-only cookies.
3. Access token is sent with every request automatically via cookies.
4. When the access token expires, the client calls `POST /api/v1/auth/refresh` to get a new pair.

### Logout
- `POST /api/v1/auth/logout` clears both cookies.

### Security Requirements
- `JWT_SECRET`, `JWT_REFRESH_SECRET`, and `COOKIE_SECRET` must each be at least 32 characters.
- All three secrets must be different from each other (validated at startup).

---

## 8. Audit Trail

### Viewing the Audit Ledger
- **Settings > Audit Trail** -- browse the immutable, append-only audit log.
- Every create, update, delete, and auth event is recorded with timestamp, user, and action.

### Hash-Chain Integrity
- Each audit entry includes a SHA-256 hash linking it to the previous entry. Entries are added one at a time per company (since 2026-10-08).
- **History written before 8 October 2026 may show "broken" at an early entry.** That is not tampering: two changes saved at the same moment used to link to the same earlier entry. To check only the history since the fix, verify with `?since=2026-10-09`.
- Run the integrity check via **Settings > Audit Trail > Verify Integrity** (`GET /api/v1/audit/verify`). Since 2026-10-08 the whole-company check is for the company's PMO/owner only, reads the history 1,000 entries at a time and may be run 10 times per 10 minutes; a single project's count needs access to that project.

### Search and Filter
- Filter by date range, user, action type, or resource.
- Export audit logs as CSV for compliance reporting.

---

## 8b. Database Indexes

The following custom indexes exist beyond the default primary/foreign key indexes:

| Index | Table | Column(s) | Purpose |
|-------|-------|-----------|---------|
| `idx_tasks_end_date` | `tasks` | `end_date` | Speeds up the overdue task scan (`pm-cron@overdue-scan`, every 15 minutes) |
| `idx_wfe_started`, `idx_wfe_workflow_started` | `workflow_executions` | `started_at`; `workflow_id, started_at` | Workflow run history list (took 7 s on staging without it) — T084 |
| `idx_audit_created`, `idx_audit_project_entity` | `audit_ledger` (company + shared) | `created_at`; `project_id, entity_type, created_at` | Audit lists and summary by date / by type — T084, 130 |
| `idx_tasks_created_at`, `idx_tasks_status_updated`, `idx_tasks_milestone_end` | `tasks` | as named | Dashboard issues trend, resolved trend, milestones — T084 |
| `idx_projects_name` | `projects` | `name` | Project by name (Slack) — T084 |
| `idx_time_date` | `time_entries` | `date` | Timesheet compliance and coaching jobs — T084 |
| `idx_raid_activity_created` | `raid_activity_log` | `created_at` | Morning briefing — T084 |
| `idx_memory_type_created` | `agent_memory` (shared, and each company's own table) | `memory_type, created_at` | Admin agent statistics (counted across companies since 2026-10-09), reflection clean-up — 130, T087 |
| `idx_memory_entity_type_created` | `agent_memory` (each company) | `entity_id, memory_type, created_at` | Admin agent-after-agent pairs — T087 |
| `idx_projects_demo` | `projects` | `is_demo` | "Projects I can read" as three indexed lookups (created by me / member / sample) instead of one query that read every project — T086 |
| `ft_projects_search`, `ft_tasks_search`, `ft_goals_search` | `projects`, `tasks`, `goals` | FULLTEXT `name, description` | Global search (word match, `MATCH … AGAINST` in boolean mode) — T085 |
| `ft_lessons_learned_search`, `ft_change_requests_search`, `ft_project_risks_search` | `lessons_learned`, `change_requests`, `project_risks` | FULLTEXT `title, description` | Global search — T085 |
| `ft_sprints_search` | `sprints` | FULLTEXT `name, goal` | Global search — T085 |
| `ft_resources_search` | `resources` | FULLTEXT `name, role, email` | Global search — T085 |
| `ft_task_comments_search` | `task_comments` | FULLTEXT `text` | Global search — T085 |

The search word indexes rely on the MariaDB defaults on both servers: `innodb_ft_min_token_size = 3` (shorter words are not indexed) and the built-in InnoDB stopword list (on). `routes/core/search.ts` assumes the same values (`FT_MIN_WORD`, `FT_STOPWORDS`); if either server setting is ever changed, change those constants too and rebuild the word indexes (drop and re-add them).

The efficiency guard (`src/server/__tests__/utils/efficiencyGuard.test.ts`) fails a build that filters a growing table on a column with no index.

---

## 9. Policy Engine

### Configuring Rules
- There is no screen for policies in the app; they are created and listed through the API (`/api/v1/policies`). The project compliance report shows how often they were checked.
- Rules trigger on project or task events.
- Example rules: auto-assign reviewers, enforce mandatory fields, block status transitions without approvals.

### Rule Structure
- Each rule has a **trigger** (event type), **conditions** (field checks), and **actions** (status change, notification, assignment).
- Rules execute in priority order; first matching rule wins unless configured to chain.

---

## 10. Workflow Management

### DAG Workflow Engine
- Create directed acyclic graph (DAG) workflows on the **Workflows** page (sidebar → Manage → Workflows; PMs, PMOs and executives).
- Six node types: trigger, condition, action, approval, delay, agent.
- Define stages, transitions, and approval gates visually or via JSON.

### Event-Driven Triggers
- Workflows fire automatically on task events (create, update, priority change, assignment change, dependency change).
- Project-level triggers fire on budget threshold crossings and status changes.
- An overdue-task scanner (`pm-cron@overdue-scan`, every 15 minutes) detects past-due tasks and fires `date_passed` triggers. **It only runs when `AGENT_ENABLED=true`, which is currently off on staging and production — so `date_passed` triggers do not fire today.** The interval is set by the timer file in `deploy/systemd/`; `AGENT_OVERDUE_SCAN_MINUTES` is no longer read.

### Monitoring Executions
- View workflow runs on the **Workflows** page → **Executions** tab.
- Track which stage each item is in, who approved, and time spent per stage.

### Approval Gates
- Configure stages that require one or more approvers before progressing.
- Approvers are notified via email and in-app notifications.

### Agent Nodes
- Agent nodes invoke registered AI capabilities (e.g., auto-reschedule) inline within a workflow.
- Support retry logic with configurable backoff.
- Use template variables (e.g., `{{task.scheduleId}}`) to pass task context to agents.

---

## 10b. Agent System Administration

### Environment Variables

| Variable | Description | Default |
|----------|-------------|---------|
| `AGENT_ENABLED` | Switches on the two jobs that need it: the nightly checks (`pm-cron@agent-scan`) and the overdue-task scan (`pm-cron@overdue-scan`). **Off (`false`) on staging and production** — so neither does any work today. Every other scheduled job runs regardless. | `false` |
| `AGENT_DELAY_THRESHOLD_DAYS` | Minimum delay days to flag (slipping-tasks check) | `3` |
| `AGENT_BUDGET_CPI_THRESHOLD` | CPI below which the budget check alerts | `0.9` |
| `AGENT_MC_CONFIDENCE_LEVEL` | Monte Carlo confidence level the schedule-risk check uses | `80` |
| `AGENT_CRON_SCHEDULE`, `AGENT_OVERDUE_SCAN_MINUTES` | **Not used.** Timing comes from the timer files in `deploy/systemd/` (nightly checks 02:00 UTC, overdue scan every 15 minutes). Shown on Admin → Configuration but changing them does nothing. | — |
| `AGENT_BUDGET_OVERRUN_THRESHOLD` | **Not used.** The budget check no longer asks AI for an overrun probability, so this threshold is never compared. | `50` |

### Kill Switch (Emergency Stop)

The kill switch stops agent work without restarting anything. **Since 2026-10-10 it is saved in the shared database** (`agent_kill_switch`, migration 133), so it reaches the nightly agent run (a separate scheduled job) as well as work started from the app, and it **stays as you left it across restarts**. Before that it lived in the web app's memory: the nightly run never saw it, and every restart turned it back on.

It is checked at the start of every nightly scan, for each project and each check in it, and before every agent capability runs. If the saved state can't be read, agents don't run (an emergency stop fails safe). Agent ids for the nightly checks: `auto-reschedule-v1` (slipping tasks), `budget-burn-rate` (budget), `monte-carlo-v1` (schedule risk); the whole scan is `scan_orchestrator`.

**API Endpoints:**

```bash
# View current state (platform admin only — it lists stopped projects of every company)
GET /api/v1/agent/kill-switch

# Disable all agents globally (admin scope required)
POST /api/v1/agent/kill-switch  {"action": "disable"}

# Re-enable all agents
POST /api/v1/agent/kill-switch  {"action": "enable"}

# Disable a specific agent — one of: scan_orchestrator (the whole nightly scan),
# auto-reschedule-v1 (delays), budget-burn-rate (budget), monte-carlo-v1 (forecast)
PUT /api/v1/agent/kill-switch/agent/:agentId  {"disabled": true}

# Disable agents for a specific project — give its company: project ids repeat across
# companies (every sample project is demo-sample-webapp), so the stop is saved per company
PUT /api/v1/agent/kill-switch/project/:projectId  {"disabled": true, "companyId": "<company id>"}
```

All kill switch changes are recorded in the audit ledger with the admin's user ID.

### Monitoring Agent Health

**`GET /api/v1/agent/health`** returns:
- `status` — `healthy` or `degraded`
- `claudeApiStatus` — `available` or `unavailable`
- `databaseStatus` — `{ healthy, latencyMs }`
- `circuitBreakers` — per-agent breaker state and failure count
- `killSwitch` — global enabled state and disabled agents list (the stopped projects are only in the admin's `GET /agent/kill-switch`)
- `recommendedScanScope` — `full`, `reduced`, `critical_only`, or `none`
- `costs.today` — tokens used, estimated USD, invocation count
- `pendingProposals` — count of proposals awaiting review

**`GET /api/v1/agent/costs`** returns cost breakdown by agent with optional `?since=` and `?until=` date filters.

### Circuit Breakers

Each agent has an independent circuit breaker:
- **Closed** (normal): agent runs normally
- **Open** (after 3 consecutive failures): agent is blocked, retries after 1 hour
- **Half-open** (retry attempt): one execution allowed; success closes breaker, failure re-opens with 24h cooldown

Circuit breakers reset automatically — no manual intervention needed unless the root cause persists.

### Rate Limiting

Proposal creation is rate-limited to prevent alert fatigue:
- 3 proposals per agent per project per 24 hours
- 10 proposals across all agents per project per 24 hours
- 10 proposals per agent per project per 7 days
- 30 proposals across all agents per project per 7 days

### Nightly checks (October 2026)

**On staging since 2026-10-07; off on production.** `AGENT_ENABLED=true` was set on staging after a full manual run finished inside the time limit (206 s for 17 companies, one with 547 projects; no AI calls, no task changes). Production stays off until the user says so — switching it on also starts the 15-minute overdue scan (`date_passed` workflow triggers).

With `AGENT_ENABLED=true` the nightly job runs three checks for every active project — no AI, nothing changed, the project's PM gets one alert per plan or project until they've read it:

| Check | What it does |
|-------|-------------|
| Slipping tasks (`auto-reschedule-v1`'s delay detection) | Tasks behind where their working days say they should be; points the PM to AI Reschedule for proposed dates |
| Budget | Cost performance (CPI, VAC) from EVM, using the real spend (labour + expenses) |
| Schedule risk (`monte-carlo-v1`) | The P80 finish later than the plan's end, in working days |

**Big companies and the 5-minute limit (October 2026).** Every scheduled job has 5 minutes (`TimeoutStartSec=300`) for all companies. The scan therefore takes each company's projects **scanned longest ago first** (`agent_scan_state`, tenant migration `T083`) and starts no new project — and no Monte Carlo — after 3 minutes; the rest go first the next night (`projectsDeferred` in the scan's stats). **Monte Carlo** — tens of seconds per plan — runs **once a week per project** at most (`MONTE_CARLO_EVERY_DAYS`); a PM's **Run AI Analysis** on the Agent Activity tab always does all three checks for that project. Found on staging: a 547-project test company made the full scan run past 10 minutes.

**Who gets the alert.** The project's PM, or its creator — if that login still exists in the company; otherwise the **company owner** if that login exists; otherwise nobody (`services/scheduling/alertRecipient.ts`). A PM whose account was removed used to make the alert fail.

Twelve earlier agents (schedule recovery, scope creep, budget intelligence, resource optimization, cross-project intelligence, risk escalation, stakeholder communication, project hygiene, dependency risk, lessons learned, predictive alerting, meeting follow-up) were removed on 2026-10-04 — they duplicated Schedule Review, the Team Planner, EVM, status reports, Lessons and the Morning Briefing, and their AI output was unreliable. Planned replacement: PM playbooks (`docs/playbooks/`). The AI Proposals inbox stays for them.

### Autonomous Execution (Tier 3)

Not offered in the app (October 2026): agents only suggest and the project's PM decides; acting by themselves is a long-term goal. The API still accepts promotion per project, by that project's Manager/Owner only — company-wide settings are ignored.

**API:**
- `GET /api/v1/agent/autonomy` — list autonomy configs
- `GET /api/v1/agent/autonomy/:agentId/eligibility` — check promotion eligibility
- `PUT /api/v1/agent/autonomy/:agentId` — promote/demote on one project (`projectId` required; that project's PM)

---

## 11. Integrations

### Jira
- **Settings > Integrations > Jira** -- provide Jira URL, email, and API token.
- Sync projects, issues, and statuses bidirectionally.
- Map PM Assistant statuses to Jira statuses in the configuration panel.

### GitHub
- Connect via OAuth or personal access token.
- Link repositories to projects; sync issues, PRs, and commit references.

### Slack
- Install the PM Assistant Slack app via OAuth.
- Configure channel notifications for project events (task created, status changed, approvals needed).

### Microsoft Teams
- Notification-only, same event catalog as Slack — no two-way sync.
- Reuses the **same Azure AD app registration** as the OneDrive/SharePoint
  connector (`MICROSOFT_CLIENT_ID`/`MICROSOFT_CLIENT_SECRET` — nothing new to
  set on the server). The app registration itself needed additional API
  permissions added in the Azure portal: `ChannelMessage.Send`,
  `Team.ReadBasic.All`, `Channel.ReadBasic.All`, and `offline_access` (for
  refresh tokens), alongside whatever OneDrive already had. Also register the
  callback redirect URI `{APP_URL}/api/v1/teams/callback` in the app's auth settings.
- **A customer's Microsoft 365 tenant admin must grant consent** the first
  time anyone at their organization connects — there is no simpler no-consent
  path the way Slack's webhook is (Microsoft is retiring Teams' old webhook
  connectors). If a customer reports Connect failing or silently not working,
  this is the first thing to check: their admin needs to approve the app's
  permissions, either by clicking through the consent screen themselves or
  via the Azure portal's admin-consent flow.
- Access tokens expire after about an hour; the app refreshes them
  automatically before every notification using the stored refresh token. If
  a customer's connection ever needs to be re-authorized (refresh token
  revoked or expired), the fix is the same as any OAuth integration:
  disconnect and reconnect.

### Teams meeting transcripts (Meeting Intelligence → From Teams, Oct 2026)
- Same Azure app registration and the same redirect URI (`{APP_URL}/api/v1/teams/callback`) as the Teams channel connection — nothing new on the server.
- **Add these delegated API permissions in the Azure portal** (Microsoft Graph): `Calendars.Read`, `OnlineMeetings.Read`, `OnlineMeetingTranscript.Read.All` (and `User.Read`, `offline_access`). `OnlineMeetingTranscript.Read.All` needs admin consent, so each customer's Microsoft 365 admin approves Kovarti once; the PM gets that link from the tab (**Copy link for your IT admin**, Microsoft's admin-consent page for this app).
- Each PM connects their own account and only ever sees their own meetings. Kovarti reads transcripts after the meeting; it never joins or records one. Transcription must have been switched on in the meeting.
- If a PM sees "Not allowed — ask the organizer", Teams is refusing the transcript to that user (commonly: not the organizer). Nothing to fix on our side.
- Sites without `MICROSOFT_CLIENT_ID` don't show the From Teams tab at all (production today).

### Sync Management
- View sync status and last sync time under each integration.
- Trigger manual sync or configure auto-sync intervals.

---

## 12. Webhooks

### Configuring Outbound Webhooks
- **Settings > Webhooks > Add Webhook** -- provide a target URL and select event types.
- Events: `task.created`, `task.updated`, `project.created`, `sprint.completed`, etc.
- Each webhook includes an HMAC signature header for verification.

### Delivery Logs
- View delivery history, response codes, and retry status.
- Failed deliveries retry up to 3 times with exponential backoff.

---

## 13. Notifications

- **Settings > Notifications** -- configure system-wide notification preferences.
- Notification channels: in-app, email, Slack (if integrated).
- Admins can set mandatory notifications (e.g., security alerts) that users cannot disable.

---

## 14. Resource Management

- **Resources > Pool** -- define team members, their skills, and availability.
- **Capacity Planning** -- view resource allocation across projects by week/month.
- Identify over-allocated resources and rebalance assignments.
- Generate resource histograms and workload reports.

---

## 15. Report Templates

- **Reports > Templates** -- create reusable report templates with custom fields, filters, and layouts.
- Built-in templates: project status, burndown, velocity, budget forecast.
- Schedule automated report generation and email delivery.
- **AI Status Reports** -- users can generate AI-powered project status reports via `POST /api/v1/status-reports/generate` and schedule recurring delivery via `POST /api/v1/status-reports/schedule`. Schedules use the existing `report_schedules` table with `templateId = "status-report::<projectId>"`. Requires `AI_ENABLED=true` for AI generation (falls back to template otherwise) and `RESEND_API_KEY` for email delivery. Gated by `requirePaidTier`.

---

## 16. Intake Forms

### Configuring Forms
- **Settings > Intake Forms** -- design forms for project requests with custom fields.
- Set required fields, dropdown options, and validation rules.

### Reviewing Submissions
- Submissions appear under **Intake > Pending Review**.
- Approve to create a project automatically, or reject with comments.

---

## 17. Project Templates

- **Settings > Templates** -- create and manage reusable project templates.
- Templates capture task structure, milestones, workflow assignments, and default settings.
- Apply templates when creating new projects to ensure consistency.

---

## 18. MCP Server (Model Context Protocol)

### Setup
- The MCP server enables Claude Desktop and Claude Web to interact with PM Assistant data.
- Configure the MCP endpoint in Claude Desktop's `claude_desktop_config.json`:

```json
{
  "mcpServers": {
    "pm-assistant": {
      "command": "node",
      "args": ["path/to/mcp-server/dist/index.js"],
      "env": {
        "PM_API_URL": "https://your-domain.com/api",
        "PM_API_KEY": "your-api-key"
      }
    }
  }
}
```

### Available Operations
- The MCP server exposes project, task, sprint, resource, and reporting tools.
- Claude can query project status, create tasks, log time, and generate reports via natural language.

### What a Claude connection may do (October 2026)
- A Claude connection acts as the person who connected it, **with exactly their role's rights**: a viewer or team member can read; a project manager can read and change their projects; nobody gets admin rights through Claude except the Kovarti platform admin. When a person's role changes, their existing connection follows the new role straight away (every key is limited to its owner's role on each request), and the connection's key is re-issued with the new rights at its next renewal.
- Revoking the connection's key (Settings → API Keys) ends it for good: its refresh token is revoked too, and a renewal is refused if the key was revoked, the person was deactivated or must change their password, or is no longer in the company they connected from (2026-10-09). Claude then has to be connected again. Needs control-plane migration 131 (`oauth_tokens.organization_id`) before the MCP server is deployed.
- The sign-in page Claude opens (2026-10-09): only a registered Claude client and its own registered return address get a code; 10 tries a minute per address and a 15-minute lock after 5 wrong passwords for one name; people who must change their password, haven't verified their email, or whose guest access ended are refused, as in the app. The company owner's Claude is offered a PMO's tools, as the owner has in the app.
- **The MCP journal no longer holds secrets** (2026-10-09): it logs method and path only. Before, every request's headers (bearer keys `kpm_…`), query and body (the sign-in password, token-exchange codes and refresh tokens) went to `journalctl`. After deploying, consider rotating keys that were in use, and trimming old MCP journal entries on both servers (`sudo journalctl --vacuum-time=…`).
- Deploying: the MCP server is separate — `bash deploy.sh <env> --mcp` deploys it (the app needs its own deploy).

### API keys and admin screens (October 2026)
- A request made with an API key or Claude connection that changes something on an admin screen (`/api/v1/admin/*`, the waitlist launch email) needs a key with the `admin` right; changing company members or guests needs `write`. A key can never change a password or delete an account. Signed-in use is unchanged.

### Embeddings (Mjuzi search) — migration 134
- Control-plane migration **134** adds `embeddings.org_id` (whose row it is: `''` = the shared knowledge base). On a multi-company server it deletes company rows written before it (lessons, meeting notes, documents — derived data that can't be attributed to a company); prod had none on 2026-10-10 (only 849 knowledge-base rows), staging 4 meeting rows. Each is embedded again when it is next saved, or run `npx tsx src/server/scripts/backfillEmbeddings.ts` (it goes company by company and writes each row under its company). Search now only ever sees the caller's company plus the shared knowledge base. The knowledge base rows are kept as they are.

---

## 19. Tenant Management (Multi-Tenant)

When `MULTI_TENANT_ENABLED=true`, the platform uses a **database-per-customer** architecture. Each organization gets its own tenant database (`pmassist_t_<slug>`), with a shared control-plane database (`pmassist`) storing users and organizations.

### Admin Panel — Tenants Tab

Navigate to **Admin Panel > Tenants** to view and manage all organizations. This tab is visible only to admin users.

**Table columns:**

| Column | Description |
|--------|-------------|
| Organization | Name and slug |
| Owner | Full name and email of the org owner |
| Users | Current user count / max users limit |
| Tier | Subscription tier badge (trial, consultant, sme, enterprise) |
| Status | Active/Inactive toggle — deactivated orgs cannot log in |
| Provisioned | Green check if tenant DB exists; red retry button if provisioning failed |
| Created | Organization creation date |
| Actions | Run pending tenant migrations |

### Managing Tenants

- **Toggle Active/Inactive** — Click the toggle in the Status column. Deactivated tenants cannot authenticate. All cached user→org lookups are invalidated on change.
- **Retry Provisioning** — If a tenant database failed to provision (red X), click the **Retry** button to re-run `provisionTenantDatabase()`. This creates the database and runs the baseline migration.
- **Run Migrations** — Click **Migrate** to apply any pending tenant migrations to a provisioned org's database. Returns the count of migrations applied.

### API Endpoints

| Method | Endpoint | Purpose |
|--------|----------|---------|
| `GET` | `/api/v1/admin/tenants` | List all organizations with owner info and user counts |
| `GET` | `/api/v1/admin/tenants/:id` | Get single org details including table count |
| `PATCH` | `/api/v1/admin/tenants/:id` | Update org settings (name, isActive, maxUsers, tier [trial/consultant/sme/enterprise], status, trialEndsAt) |
| `POST` | `/api/v1/admin/tenants/:id/provision` | Retry tenant database provisioning |
| `POST` | `/api/v1/admin/tenants/:id/run-migrations` | Run pending tenant migrations |

All endpoints require admin role authentication.

---

## 19a. Branding

- **Logo (Oct 2026):** the **Enso K** — a K inside an open brush circle — shared by Kovarti and its parent company, Kaizen Project & Business Consultants Inc. Full colour is navy `#0f1b33` with a sky-blue `#0ea5e9` circle. The app's own colours stay teal; only the logo is shared.
- **In the app** it is one component, `src/client/src/components/ui/KovartiMark.tsx` (single colour, follows the text colour), used by the sidebar, sign-in, onboarding and the public pages; a test fails if the old lightbulb mark comes back.
- **Static files** in `src/client/public/`: `pwa-icon.svg` (browser tab), `pwa-192x192.png` / `pwa-512x512.png` (installed app), `apple-touch-icon.png`, `og-image.png` (the picture shown when a kovarti.com link is shared). The installed-app theme colour is navy.
- **Feature tour video (Oct 2026):** the home page's **Watch the 80-second tour** button (`src/client/src/components/landing/TourVideo.tsx`) plays `public/videos/kovarti-tour-vertical.mp4` on phones and portrait screens and `kovarti-tour-wide.mp4` elsewhere (narrated, AI voice). To replace the tour, overwrite those files (and the `.jpg` posters) with the same names; masters are in the owner's `Downloads/Kovarti-Feature-Tour`.
- **LinkedIn:** company page linkedin.com/company/kaizen-pbc; Kovarti is a Showcase page under it (linkedin.com/showcase/kovarti).
- **Master files** (wordmarks, LinkedIn logos and banners, every logo option considered) are kept outside the repo in the owner's `Downloads/Kovarti-Brand` folder.

## 20. Analytics

### Google Analytics (GA4)
- Measurement ID **G-46RCPEQRE5**, loaded by `src/client/src/components/CookieConsentBanner.tsx` only after the visitor clicks **Accept** on the cookie banner (Decline = no tracking).
- **Live site only** (Oct 2026): analytics and the cookie banner run on `kovarti.com` / `www.kovarti.com` and nowhere else — staging, local runs, tests and the demo-video recorder no longer land in the reports. The host list is `ANALYTICS_HOSTS` in that file.
- Reports: analytics.google.com (Realtime, Acquisition, Pages and screens). No environment variable or server-side configuration is needed.

---

## 21. Backup and Maintenance

### Database Backups
Backups are automatic — nothing to arrange with a hosting provider, and no cPanel
involved (the database runs on the application servers themselves).

- Every night at 02:30 UTC, every database is dumped, checked for readability, and
  copied to a second machine.
- Local copies are kept 7 days; the off-machine copies 30 days.
- A backup that stops running raises an alert, so silence is not mistaken for health.
- Full detail, including how to set up the off-machine destination on a new server:
  see **Backups** in `DEPLOYMENT_GUIDE.md`.

### Automatic clean-up of history tables
The nightly `pm-cron@data-retention` job (03:30 UTC) deletes old rows, in batches of 5,000, in each company's database and the shared one. Days kept (environment variable → default):

| What | Variable | Default |
|---|---|---|
| Webhook deliveries | `RETENTION_WEBHOOK_DAYS` | 30 |
| Failed-job queue (resolved/failed) | `RETENTION_DEAD_LETTER_DAYS` | 30 |
| Read notifications | `RETENTION_NOTIFICATION_DAYS` | 90 |
| API key usage log | `RETENTION_API_LOG_DAYS` | 90 |
| MCP tool calls | `RETENTION_MCP_INVOCATION_DAYS` | 90 |
| Finished workflow runs (and their steps) | `RETENTION_WORKFLOW_RUN_DAYS` | 90 (since 2026-10-08) |
| Agent activity log | `RETENTION_AGENT_LOG_DAYS` | 180 (since 2026-10-08) |
| Automation runs (Insights show the same 90 days) | `RETENTION_AUTOMATION_RUN_DAYS` | 90 (since 2026-10-08) |
| Integration sync log | `RETENTION_SYNC_LOG_DAYS` | 30 (since 2026-10-08) |
| AI usage log | `RETENTION_AI_USAGE_DAYS` | 400 (since 2026-10-08) |

Kept on purpose: the audit history, timesheets, tasks, RAID and task history, project health history, AI memory change log, and people's Mjuzi conversations.

### Restoring
```bash
# From the copy held on the machine itself
zcat /var/backups/pm-app/<date>/pmassist.sql.gz | sudo mariadb pmassist

# From the off-machine copy, if that machine is gone
ssh ubuntu@<other-server> 'cat /var/backups/pm-prod/<date>/pmassist.sql.gz' \
  | zcat | sudo mariadb pmassist
```
Each customer has their own database (`pmassist_t_*`), backed up and restorable
individually — one customer's data can be recovered without touching anyone else's.

**Check a restore actually works** — do this occasionally rather than assuming:
```bash
sudo /usr/local/bin/pm-backup.sh --verify
```
This restores into a throwaway database and reports what came back. Until
2026-09-18 nobody had ever confirmed a restore worked.

### Secret Rotation
- Rotate `JWT_SECRET` and `COOKIE_SECRET` periodically per your security policy.
- After rotation, all active sessions are invalidated; users must re-authenticate.

### Health Monitoring
- **`GET /health`** -- returns overall status (`OK` or `DEGRADED`), database connectivity with response time, memory usage (RSS, heap used, heap total), uptime, and environment. Returns HTTP 200 when healthy, 503 when degraded.
- **`GET /api/v1/agent/health`** -- returns agent system health: Claude API status, database latency, circuit breaker states, kill switch state, recommended scan scope, daily cost tracking, and pending proposal count.
- Memory status shows `WARN` if heap usage exceeds 90% of heap total.
- Monitor API latency, error rates, and database connection pool usage.
- Set up alerts for repeated failures or degraded performance.
- **The platform admin account has no company (Sep 2026).** It runs the business from the admin pages and owns no project data; opening a project page takes it to the admin pages. Any other account without a company sees "You're not part of a company yet". Company data is only ever read or written in a company's own database — never the shared one (company features answer `no_company` otherwise). The admin never changes customer data; a read-only, logged **Support view** into one chosen company is planned for troubleshooting.
- **Support view (Sep 2026):** to troubleshoot a customer, open **Admin → Companies** and click **View as support** on their row. Give a reason (the company sees it) and your password. For 30 minutes the app shows that company's workspace exactly as they see it, **read-only** — the server refuses every change — under an amber banner with the time left and **Exit support view**. Every visit is recorded in the company's own audit trail and listed for its owner in **Settings → Support visits**. The admin never changes customer data; if something must be fixed, the customer (or their PM) does it.
- **Dreaming is switched off (Sep 2026):** it read users' AI conversations across the platform; the platform doesn't read customers' conversations.
- **Admin statistics are platform-wide (Sep 2026):** feature usage, Mjuzi chat counts, webhook deliveries and the failed-job queue add up every company's own database (counts only). They used to read old copies in the shared database, frozen since July.
- **Old shared copies retired (Sep 2026):** migration 124 renamed 58 leftover copies of company tables in the shared database to `_retired_*` (data kept; rename back to undo). They will be dropped after a quiet period. A test fails if code ever points the shared database at one again.
- **Log retention (Sep 2026):** server logs are kept for **90 days, at most 2 GB** per server (`deploy/journald/pm-retention.conf`, installed and checked by every deploy). Logs can contain customer details such as email addresses, so less is kept for less time; 90 days covers any realistic investigation.
- **Plan settings alert (Sep 2026):** every plan we sell (Trial, Consultant Basic/Pro, SME, Enterprise) needs its price row and an on/off setting for every plan-gated feature — a missing setting silently counts as *off*. The alert check emails `ALERT_EMAIL` (critical) naming any gap. The list of plans and features lives in `src/server/constants/planFeatures.ts`; a test checks the migrations seed all of them. (Production's SME, Enterprise and Trial plans had no feature settings until migration 122; "Import from a document (AI)" was refused on every plan until 123.)
- **Server-error alert (Sep 2026):** every HTTP 500 is counted in Redis by route (`utils/serverErrorWatch.ts`). The alert check (systemd timer `pm-cron@alert-check`, every 5 minutes) emails `ALERT_EMAIL` when there have been **3 or more** in the current or previous hour (critical at 20+), naming the routes, with a 30-minute cooldown. The old check used an in-memory error *rate* that the timer process could never see, so it never fired.
- **AI costs (Sep 2026):** every AI call is recorded in `ai_usage_log`, tagged with its feature (or the calling service) and priced by model — before, only ~30% of calls were, and the per-user budget was measured from that. Routine jobs (dashboard predictions, summaries, insights, narratives) use the cheaper `AI_MODEL_LIGHT` (Haiku 4.5, ~⅓ the price); Mjuzi chat, reports and suggestions stay on `AI_MODEL`. Dashboard predictions: the numbers (health scores, risk counts, budget — rules only, free) are recalculated right after any saved change in the organisation (`utils/portfolioChanges.ts` counter) and reused otherwise; the AI highlights are asked only by the Portfolio Intelligence panel, only when the numbers came out different, and only after 2 quiet minutes (a burst of edits = one call). Refresh button forces it (at most every 10 minutes per person). **Account-wide limit** `AI_MONTHLY_CAP_USD` (default $100/month; counted in Redis `ai:spend:YYYY-MM`) stops all AI — background jobs included — once reached, with an alert email at 80% and at the limit. Anthropic's console (Usage → by API key) remains the authoritative bill.
- **Accounts with no organisation** (e.g. a platform admin) get an empty Morning Briefing instead of a server error — they have no project database.
- **Post-deploy smoke account (production):** a dedicated test customer in its own organisation, used to log in and open the dashboard after every production deploy (read-only). Credentials are kept outside the repository.

---

## Troubleshooting

| Issue                        | Resolution                                                    |
|------------------------------|---------------------------------------------------------------|
| Users cannot log in          | Check credentials, token expiry, cookie domain, HTTPS config. If a user is stuck with an expired login token, use the **Unlock** button on Admin > Users or call `POST /api/v1/admin/users/:id/clear-login-token`. |
| API returns 503              | Verify Fastify is running: `sudo systemctl status pm-app`; logs with `journalctl -u pm-app`. |
| AI features not working      | Confirm `AI_ENABLED=true` and valid `ANTHROPIC_API_KEY`.      |
| Agents not running           | Check `AGENT_ENABLED=true`; check the kill switch via `GET /api/v1/agent/kill-switch` (it is saved, so it stays off after a restart until someone turns it back on). |
| Kill switch left on          | Re-enable via `POST /api/v1/agent/kill-switch {"action":"enable"}`. |
| Agent circuit breaker open   | Check error rate at `GET /api/v1/agent/health`; breaker auto-retries after 1h/24h. |
| Stripe webhooks failing      | Verify `STRIPE_WEBHOOK_SECRET`; check Stripe event logs.      |
| Integrations not syncing     | Check API tokens/credentials; review sync logs.               |
| Audit integrity check fails  | Investigate potential data tampering; restore from backup.     |
| Health snapshots not appearing | Verify `AGENT_ENABLED=true`; run manual snapshot via `POST /api/v1/predictions/health/snapshot`; check `project_health_history` table. |
| Tenant provisioning failed   | Check DB user has `CREATE DATABASE` privileges; retry via Admin > Tenants > Retry button or `POST /api/v1/admin/tenants/:id/provision`. |
| Tenant tab shows no orgs     | Verify `MULTI_TENANT_ENABLED=true` in `.env` and at least one organization exists in the `organizations` table. |

For detailed logs, check `./logs/` or your hosting provider's log viewer.

---

## References

- [User Guide](./USER_GUIDE.md) -- Projects, tasks, and day-to-day usage.
- [Deployment Guide](./DEPLOYMENT_GUIDE.md) -- Server setup and deployment.
- [Security Guide](./SECURITY_GUIDE.md) -- Security configuration and best practices.
- [API Documentation](./API_DOCS.md) -- REST API reference.
