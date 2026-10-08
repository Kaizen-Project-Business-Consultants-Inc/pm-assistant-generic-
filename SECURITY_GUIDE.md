# PM Assistant -- Security Implementation Guide

A comprehensive reference for the security architecture of the PM Assistant application.

---

## Table of Contents

1. [Authentication](#1-authentication)
2. [OAuth 2.1 (MCP / Claude Web)](#2-oauth-21-mcp--claude-web)
3. [API Keys](#3-api-keys)
4. [Scope-Based Authorization](#4-scope-based-authorization)
5. [Password Security](#5-password-security)
6. [Security Headers](#6-security-headers)
7. [CORS](#7-cors)
8. [Content Security Policy (CSP)](#8-content-security-policy-csp)
9. [Cookie Security](#9-cookie-security)
10. [Input Validation](#10-input-validation)
11. [Rate Limiting](#11-rate-limiting)
12. [Audit Ledger](#12-audit-ledger)
13. [Policy Engine](#13-policy-engine)
14. [Webhook Security](#14-webhook-security)
15. [Stakeholder Portal Access](#15-stakeholder-portal-access)
16. [Development vs Production](#16-development-vs-production)
17. [Deployment Checklist](#17-deployment-checklist)
18. [Privacy Policy and Third-Party Data Processors](#18-privacy-policy-and-third-party-data-processors)
19. [Testing](#19-testing)
20. [Related Files](#20-related-files)

---

## 1. Authentication

The application uses a dual-token JWT strategy:

- **Access token** -- short-lived JWT delivered as an `HttpOnly` cookie (`access_token`).
- **Refresh token** -- longer-lived JWT stored as an `HttpOnly` cookie, used to rotate access tokens without requiring the user to re-authenticate.

Both tokens are configured with `secure: true` in production and `sameSite: 'lax'` to prevent CSRF while allowing standard navigation flows.

Authentication is enforced by the `authMiddleware` pre-handler hook, which verifies the JWT from the cookie and attaches the decoded user to `request.user`.

### Deactivated User Rejection

After JWT validation (or API key validation), the middleware checks the user's `is_active` status in the database. Deactivated users receive a `401 Account deactivated` response immediately, even if their JWT or API key is otherwise valid. This check uses Redis caching (5-minute TTL) to avoid a database query on every request.

### Registration Email — Fire-and-Forget

After a user registers, the verification email is sent in a **fire-and-forget** manner (`.catch()` swallows delivery errors). Registration succeeds and a 201 response is returned regardless of whether the email is delivered. This design prevents email service outages (Resend downtime, DNS issues, etc.) from blocking new user signups. If a user does not receive their verification email, they can request a new one via `POST /api/v1/auth/resend-verification` (rate-limited to prevent abuse).

---

## 2. OAuth 2.1 (MCP / Claude Web)

An OAuth 2.1 authorization code flow is implemented in the MCP server (`mcp-server/src/oauth/`) to allow Claude Web and other MCP clients to authenticate on behalf of users:

- **Authorization endpoint** -- renders a consent/authorize page.
- **Token endpoint** -- exchanges authorization codes for access tokens.
- **Client registration** -- managed via `clientsStore.ts`; clients are validated per-request.

This enables per-user scoped access when the PM Assistant is used as a remote MCP tool.

---

## 3. API Keys

API keys provide programmatic access for integrations, CI/CD pipelines, and external agents.

| Property | Details |
|---|---|
| **Format** | `kpm_<40 hex chars>` |
| **Storage** | SHA-256 hash stored in the database; raw key shown only at creation |
| **Scopes** | `read`, `write`, `admin` (hierarchical) |
| **Rate limit** | Per-key configurable; default 100 requests/minute |
| **Expiration** | Optional `expires_at` date |
| **Usage logging** | Every request is logged with method, URL, status code, response time, and IP |

Keys are resolved globally in the `onRequest` hook (`plugins.ts`). If a valid `Bearer kpm_*` token is found, the request is tagged with `apiKeyId`, `apiKeyScopes`, and `apiKeyRateLimit` for downstream middleware.

---

## 4. Scope-Based Authorization

The `requireScope` middleware (`src/server/middleware/requireScope.ts`) gates individual routes:

```
admin  >  write  >  read
```

- **Signed-in users:** the role's rights (`constants/roleScopes.ts` `ROLE_SCOPES` — the single list).
- **API key users (including Claude connections):** the key's rights **limited to the owner's current
  role** (`effectiveScopes`) — a key never does more than its owner can, even one made before the role was
  lowered. A key's `admin` includes write and read; `*` means "whatever the role allows".
- **Claude (MCP OAuth) keys** are issued with the person's role rights at connection and on every renewal
  (`mcp-server/src/oauth/roleScopes.ts`, a checked copy of the server list). Until October 2026 every
  Claude key got read + write + admin regardless of role (audit critical #2).
- **`admin` is Kovarti platform work only:** every route that asks for it also requires the platform admin
  (`platformAdminOnly` / `requirePlatformAdmin`). Proposal Execute/Undo need the project's Manager/Owner
  (`write`); revoking an API key needs only `read` and touches your own keys only.
- Guards: `__tests__/middleware/claudeKeyScopes.test.ts`, `requireScope.test.ts`.

Usage in a route:

```typescript
fastify.get('/projects', { preHandler: [authMiddleware, requireScope('read')] }, handler);
fastify.post('/projects', { preHandler: [authMiddleware, requireScope('write')] }, handler);
```

### Stripe Billing Routes — Intentional Read Scope

`POST /stripe/create-checkout-session`, `POST /stripe/create-topup-session`, and `POST /stripe/billing-portal` are gated with `requireScope('read')` rather than `requireScope('write')`. This is intentional: all authenticated users, including those whose API keys carry only the `read` scope (e.g., the default `team_member` role), need to be able to manage their own billing, subscription, and token top-up purchases without requiring elevated write access. These routes do not modify project data, so the lower scope is appropriate.

### Your Own Settings — Intentional Read Scope (October 2026)

`PUT /users/me/profile`, `/me/view-preferences`, `/me/notification-preferences`, `/me/preferences` (time zone, language), `/me/accessibility` and `/me/dashboard-preferences` need only `requireScope('read')`: every signed-in person — team member, viewer and executive included — saves their **own** settings. Each handler writes only `request.user.userId`'s row; there is no user id in the path, and the request body is validated field by field, so an id in it is ignored. Until 2026-10-08 five of them needed `write`, so read-only roles got a 403 (on every page load for screen settings). Guard: `__tests__/routes/ownSettingsSave.test.ts`.

---

## 4b. Project-Level Access Control

The `requireProjectAccess` middleware (`src/server/middleware/requireProjectAccess.ts`) enforces **project-scoped** access. While `requireScope` controls *what actions* a user can perform globally, `requireProjectAccess` controls *which projects* a user can access and at what level.

### Two-Layer Authorization

Every project-scoped route runs both middlewares in sequence:

```typescript
fastify.get('/:scheduleId/tasks', {
  preHandler: [requireScope('read'), requireProjectAccess('viewer')],
}, handler);
```

1. **`requireScope`** — Can this user role perform read/write/admin actions at all?
2. **`requireProjectAccess`** — Is this user a member of this specific project with sufficient project role?

### Project Role Hierarchy (Sep 2026)

**Rule: only a project's Manager or Owner (or an admin/PMO) changes project data.** The Editor role was removed — anyone still holding it is read-only (ranked with Viewer; migration T057 renames stored editors to viewer).

```
owner  >  manager  >  viewer   (editor = viewer)
```

| Project Role | Read | Change project data | Manage team | Make Owners / remove members / delete project |
|---|---|---|---|---|
| **owner** | Yes | Yes | Yes | Yes |
| **manager** | Yes | Yes | Add members, change Viewer/Manager roles | No |
| **viewer** (and legacy editor) | Yes | Only the owner-scoped exceptions below | No | No |
| **Non-member** | No (404) | No | No | No |

**Owner-scoped exceptions (user-approved):**
- **RAID item owner** — may update **only that item's status**, add progress updates and comment on it; may edit/delete only their own progress updates. Everything else on the item (and creating, cancelling, importing, AI scan) is Manager/Owner. Enforced by `raidItemGate` in `routes/collaboration/risks.ts`; the PM may edit/delete anyone's progress update.
- **Time entries** — any project member logs and edits **their own** time; others' entries need Manager/Owner; the entry's task/schedule must belong to the project.
- **Sprints standups/retro/votes and meeting action items** — own items only (Phase 2, see below).

**Fail closed:** a change (`minRole` above viewer) whose project cannot be determined is refused with **400 `project_unknown`** — it used to skip the check, which is how the bulk tools (schedule id in the body) went unchecked. Routes that carry ids in the body pass a `resolve` function (e.g. `projectsOfSchedules`); **every** project a request names must pass.

**Wrong-project (IDOR) checks:** a task in the URL must belong to the URL's schedule (`schedules.ts` hook); a RAID item to the URL's project (`risks.ts` hook); a calendar/exception to its project/calendar; a project member to the URL's project; a time entry's task to its schedule and project; task-prioritisation's schedule to its project.

**Team management:** only an Owner (or admin/PMO) can grant Owner or change an Owner's role; a project always keeps at least one Owner (409 `last_owner`).

**Screens** use the caller's **project** role from `GET /projects/:projectId/members/me` → `{ role, canEdit, canManageOwners }` (`useProjectRole`), not the organisation role.

**Guard test:** `src/server/__tests__/middleware/routePermissionGuard.test.ts` fails the build if a write route has no project check and is not listed as non-project data or as a Phase-2 route; it also fails on any `requireProjectAccess('editor')`.

**Teams meeting transcripts (Oct 2026):** delegated Microsoft Graph read permissions only (`Calendars.Read`, `OnlineMeetings.Read`, `OnlineMeetingTranscript.Read.All`), per user — a PM sees only their own meetings. Tokens are stored on the user's own integration row and masked in API responses. The OAuth `state` is a random one-time value kept in Redis for 10 minutes (`utils/oauthState.ts`), and the callback also requires the same Kovarti user to be signed in, so a forged state cannot attach someone's Microsoft account to another user. Listing, who's who and analysing are the project's Manager/Owner only. The same one-time state now protects every account-connect sign-in — Slack, Teams channels and Google Calendar used to put the user id in the state and trust it on return (a made-up state could attach someone's account to another user); `oauthStateGuard.test.ts` fails the build if that pattern returns. Storage connectors already used their own one-time store.

**Phase 2 (done, Sep 2026):** sprints (PM changes the sprint, its tasks, points, start/complete, retro conversion, DoR/DoD checklists; any member posts their **own** standups, retro notes and votes via `ownWorkScope`), meeting action items (PM creates/edits/reassigns/cancels; the assignee marks their own done/in progress/reopened and adds notes), meeting intelligence (analyse, apply, send-to-RAID: PM; schedule must be in the project), file attachments (add/replace: PM or the RAID item's owner; delete: PM; reading needs project access), lessons learned (edit/elevate/rate/delete: the lesson's project PM; library use open; seed: admin/PMO), workflows (project workflows: PM; organisation-wide: admin/PMO; running on a task also needs PM of the task's project), resource assignments (PM of the task's project; the resource pool itself is organisation data), resource requests (raise/edit/submit/cancel: PM; approve/reject/fulfil: admin/PMO), storage connectors (PM; connector must be the project's), calendar task links (project member), RAID/status reports (schedule/email: PM; generate: member), portal link edit (PM), agent proposals (approve/reject/execute/rollback: PM; feedback: member), what-if scenarios (PM), AI context config (project: PM; org: admin/PMO; user: yourself). **Mjuzi and alert actions** act as the user: `AIActionExecutor.checkProjectWrite` requires Manager/Owner for any tool that changes a project and refuses changes spanning two projects. The guard test's Phase-2 list is now empty and must stay so.

**Reading other projects (Sep 2026, phase 1 of 2).** Inside one organisation a person reads only the projects they created, are a member of, or the sample project; admin/PMO/executive read all (`constants/roles.ts GLOBAL_READ_ROLES`, `ProjectService.findAccessible`, `utils/readableProjects.ts`). Closed so far: `?scope=portfolio` no longer widens the dashboard, analytics summary or Morning Briefing for other roles; Mjuzi's read tools (`AI_READ_TOOLS` → `checkProjectRead`; lists via `findAccessible`) and the chat's project context (`chatContextMember`); plain-English questions (`NLQueryService` tools run per user); knowledge search drops other projects' meeting notes (lessons stay shared by decision); report builder and scheduled reports filter every section to the runner's projects; AI anomaly and cross-project overviews use the asker's projects; full project export needs project access; storage-connector reads need project access and folder browsing needs Manager/Owner. **Phase 2 (done, Sep 2026):** every per-project read route checks the project (`requireProjectAccess('viewer')` or a resolver): predictions, forecasts, burndown, network diagram, EVM, narratives, member list, standup, sprints and their boards/retros/standups, DoR/DoD checklists, agent proposals (list filtered to readable projects), workflows (organisation-wide ones readable by all; a project's by its members; execution logs need a workflow), resource requests (list filtered; pending/summary for admin/PMO), a task's time entries, custom field values, report schedules (owner, admin/PMO, or the project's members), action-item summary, favourites, Monte Carlo, AI reports/instant reports/strategic scan/task estimation/AI scheduling (project in the body). IDs nested in a URL must belong to its project: task/epic/baseline/scenario in schedules, automations, documents. Mjuzi's memory, versioned memory and "dreaming" are admin/PMO only. Resource screens show a person's hours on every project but other projects' names/tasks/costs only to their members (merged as "Other projects"; global workload costs hidden from non-admins). Also fixed: another user's **integration** (settings can hold outside-service keys) and **API key usage log** were readable by id — now owner/admin only. `__tests__/middleware/routeReadGuard.test.ts` fails the build on any new GET without a project check unless listed in `READ_OK` with a reason, checks the read-POSTs by name, and bans the `?scope=portfolio` widening and `findAll()` in Mjuzi's tool runner.

**Subscription check for team members (Sep 2026 fix):** the write-time subscription check (`middleware/requireSubscription.ts`) looked only at the person's own record. Members invited after their organisation paid were created with `subscription_status='none'` (direct invites) or without the trial end date (invite links), so every change they made was refused with "Your trial has ended". Now every join path uses `utils/memberSubscription.ts` (`memberSubscriptionFromOrg`), the check falls back to the organisation's plan for non-owner members (`orgSubscriptionAllowsMembers`: active paid, past due, or unexpired trial), and migration `120_member_subscription_from_org.sql` repairs existing members. The organisation owner is still judged by their own record.

**Why the gaps existed (for the record):** the check was added on 4 Jul 2026 route by route (opt-in); later routes (bulk tools 15 Jul, bulk delete 5 Sep, many others) never got it; the middleware silently passed when it couldn't find a project; nothing tested for it.

### An item id in the URL belongs to the project in the URL (Oct 2026)
Access is checked on the project/schedule in the URL, so a child id in the same URL must belong to
it. Plugin-level preHandler hooks do this for every route that names an item: RAID items (`risks.ts`),
documents (`documentIntelligence.ts`, added 2026-10-05 — edit/delete/reprocess/read of another
project's document were open), automations, tasks/epics/baselines/scenarios under a schedule
(`schedules.ts`). Task comments are deleted only on their own task (`WHERE id = ? AND task_id = ?`);
"save project as template" needs the project's Manager/Owner. Guard: `__tests__/routes/childInProject.test.ts`
fails when a new `/:projectId/…/:xId` route file has no such check.

### People list — risky changes are the owner's or a PMO's (Oct 2026)
`services/peopleRights.ts` (user decision 2026-10-05, "Option B"): project managers manage ordinary
people, but only the company owner or a PMO may choose/change a line manager (= timesheet approver),
change the email of someone who signs in (an email change re-links the person to a login), add a person
whose email is a login, delete people who sign in, or remove a login ("Also remove their login" — which
had silently done nothing: it read the company off `request.user`, which doesn't carry it). Nobody does
these to the owner's own record. 403 with a plain message; routes POST/PUT/DELETE `/resources`,
bulk-delete and import all call the checks. The same `request.user` mistake also broke the Invite
button (people in your own company were told they belonged to "another company") and the inviter's
name in invite emails — fixed; guard: no code reads `request.user.fullName/email/organizationId`.
Tests: `__tests__/routes/peopleRights.test.ts`.

### Platform admin = admin role AND no company (Oct 2026)
"Admin owns nothing." The only platform admin is the account with role `admin` and no company
(`utils/platformAdmin.ts` `isPlatformAdmin`; client `isPlatformAdmin` in `stores/authStore.ts`). Every
platform route — `routes/admin/*`, the support-visit switch in `tenantResolver`, the all-company
feedback list, the AI kill switch and skills (`platformAdminOnly` next to `requireScope('admin')`) —
checks that, never the bare role. `authMiddleware` records `hasCompany` from the user row (unknown =
has a company, so the check fails closed). Company owners can't grant `admin`: invite and role change
use `COMPANY_ASSIGNABLE_ROLES` (`constants/roles.ts`) and answer 400 with a plain message;
`UserService.create/update` refuse `role: 'admin'`; the owner's role can't be changed; a removed member
never leaves with `admin`. System alerts go only to the platform admin. Found 2026-10-04 (full audit):
until then a company owner could make a member `admin`, which passed every platform check. Guards:
`__tests__/middleware/platformAdminGuard.test.ts`, `__tests__/routes/orgAdminRole.test.ts`.

### Support view — platform admin access to customer data (Sep 2026)
The platform admin never changes customer data. To troubleshoot, the admin opens a **Support view**
visit into ONE company:
- **Password again + a reason** (10–500 characters; the company sees it). Rate-limited (5 per 15 min).
- **Read-only, enforced on the server:** during a visit `tenantResolver` refuses every non-GET request
  (`support_read_only`), and `authMiddleware` makes the admin a read-only `executive` inside that company.
- **30 minutes**, one visit at a time; the `support_session` cookie is httpOnly, secure, SameSite=Strict.
  Signing out or Exit ends it.
- **Recorded twice:** the shared `support_sessions` table and that company's own tamper-evident audit
  ledger (`support.view.started` / `support.view.ended`). If the company's ledger can't record the start,
  the visit is cancelled. The company owner/PMO sees every visit in **Settings → Support visits**.
- Admin pages keep working during a visit; the admin's own profile and notifications stay the admin's.

Accounts with no company (the platform admin) never read or write company data outside a visit: company
routes answer `no_company` (see ADMIN_MANUAL).

### Global Role Bypasses

| Global User Role | Bypass Behavior |
|---|---|
| `admin`, `pmo` | Full access to all projects (no membership required). `admin` is the platform admin only and has no company, so in practice this is PMO. |
| `executive` | Read-only access to all projects (write/admin denied) |
| All other roles | Must be a project member with sufficient project role |

### Security Design

- **404 for non-members** — prevents information leakage. An attacker cannot distinguish "project exists but I have no access" from "project does not exist."
- **403 for insufficient role** — returned only to confirmed members who lack the required project role.
- **Project ID extraction** — the middleware resolves the project from `params.projectId`, `params.scheduleId` (via DB lookup), `params.id` (on `/api/v1/projects` routes), or `request.body.projectId`.
- **Handler-level checks** — for routes where `projectId` must be resolved from an entity lookup (e.g., `PUT /:id`, `DELETE /:id`), the `checkEntityProjectAccess` utility (`src/server/middleware/checkEntityProjectAccess.ts`) performs the same authorization checks inside the handler after the entity is fetched. This supports owner-vs-others role differentiation (e.g., editor can delete own expense, manager needed for others').
- **Auto-owner on creation** — when a project is created, the creator is automatically added as `owner` in `project_members`.

### Protected Routes

The middleware is applied to all project-scoped routes across:

- **Core:** projects, schedules, sprints, project members, portal links, pinned project links
- **Resources:** expenses, time entries, custom fields, resource assignments
- **Collaboration:** meetings, RAID/risk items, approval workflows, document intelligence
- **Reporting:** status reports, report schedules

**Pinned project links** (`/projects/:projectId/links`) follow the standard two-layer pattern: `requireScope('read'/'write')` + `requireProjectAccess('viewer'/'editor')`. The list endpoint is viewer-accessible; create, reorder, update, and delete require editor. Non-members receive 404.

Routes without a project context (e.g., `GET /projects` list, `GET /timesheet` for the current user) are not affected — the middleware skips when no projectId can be extracted.

---

## 5. Password Security

- Passwords are hashed with **bcrypt** before storage (`UserService.ts`).
- Password reset uses a time-limited, single-use email token.
- Raw passwords are never logged or returned in API responses.

---

## 6. Security Headers

The server registers **Helmet** (`@fastify/helmet`) which sets the following headers:

| Header | Value |
|---|---|
| `X-Content-Type-Options` | `nosniff` |
| `X-Frame-Options` | `DENY` (via `frameguard`) |
| `X-DNS-Prefetch-Control` | `off` |
| `X-Powered-By` | Removed (`hidePoweredBy`) |
| `Strict-Transport-Security` | `max-age=31536000; includeSubDomains; preload` (production only) |
| `Cross-Origin-Opener-Policy` | `same-origin` |
| `Cross-Origin-Resource-Policy` | `cross-origin` |
| `Referrer-Policy` | `strict-origin-when-cross-origin` |
| `Permissions-Policy` | Camera, microphone, geolocation, payment, USB disabled |

Client-side `<meta>` tags in `index.html` mirror several of these headers as a defense-in-depth measure.

---

## 7. CORS

CORS is configured in `plugins.ts` with environment-aware origin validation:

```
Allowed origins:
  - localhost:*        (any port, development convenience)
  - CORS_ORIGIN env    (production domain)
  - claude.ai / *.anthropic.com / *.claude.ai  (MCP access)
  - All origins        (development mode fallback)
```

Credentials are enabled. Allowed methods: `GET`, `POST`, `PUT`, `DELETE`, `OPTIONS`. The `Mcp-Session-Id` header is both allowed and exposed for MCP transport.

---

## 8. Content Security Policy (CSP)

CSP is enforced via Helmet with environment-specific behavior:

| Mode | Behavior |
|---|---|
| **Development** | `report-only` -- violations logged but not blocked |
| **Production** | Enforced -- violations blocked |

Key directives:

```
default-src   'self'
script-src    'self' (+ 'unsafe-eval' 'unsafe-inline' in dev; 'unsafe-inline' in prod)
style-src     'self' 'unsafe-inline' https://fonts.googleapis.com
img-src       'self' data: blob: https:
connect-src   'self' (+ localhost in dev; wss: in prod)
font-src      'self' https://fonts.gstatic.com
object-src    'none'
frame-src     'self' https://checkout.stripe.com https://js.stripe.com
```

---

## 9. Cookie Security

Cookies are registered via `@fastify/cookie`:

```typescript
{
  secret: config.COOKIE_SECRET,
  parseOptions: {
    httpOnly: true,
    secure: config.NODE_ENV === 'production',
    sameSite: 'lax',
  }
}
```

- `httpOnly` prevents JavaScript access (XSS mitigation).
- `secure` ensures cookies are only sent over HTTPS in production.
- `sameSite: 'lax'` mitigates CSRF while allowing top-level navigations.

---

## 10. Input Validation

All API endpoints use **Zod v4** schemas for runtime request validation:

- Route parameters, query strings, and request bodies are validated before handlers execute.
- Invalid input returns a structured 400 error with field-level details.
- Schemas are co-located with their route files for maintainability.

Validation is applied across the main server routes and all MCP tool handlers (`mcp-server/src/tools/`).

### Bad input is a 400, never a 500 (guards)

A malformed request must get a plain-English 4xx, not "Internal server error" (a 500 also hides real faults in the logs). Three tests keep it that way (extended 2026-10-07 after a sweep fixed 35 more routes):

- `src/server/__tests__/middleware/validationErrorGuard.test.ts` — scans every route file: a handler that `.parse()`s the request may not turn a `ZodError` into a 500. It now catches `reply.code(500)` as well as `status(500)`, and also scans routes declared with a generic (`fastify.post<{ Body: … }>('/x', …)`). Fix: `if (error instanceof z.ZodError) return sendValidationError(reply, error);` in the catch, or use `safeParse`.
- `src/server/__tests__/routes/emptyBodyErrors.test.ts` — drives real routes with Fastify `inject`: empty or partial bodies (resource-request reject/fulfil, link reorder, sprint tasks/points, custom fields, status-report render/Word export) and upload routes sent JSON or nothing (attachments, document upload, import-document) must answer 4xx with a `message`. Upload routes check `request.isMultipart()` before `request.file()`; adding a task twice to a sprint is a 409.
- `src/server/__tests__/routes/listLimitParams.test.ts` — list routes read `limit`/`offset` through `clampPagination` (`schemas/paginationSchema.ts`), so `?limit=abc&offset=-5` falls back to the defaults instead of reaching SQL as `LIMIT NaN`. The test fails if one of those routes goes back to `parseInt(limit)`.

### Optimistic Locking

The project update endpoint (`PUT /projects/:id`) supports an optional `expectedUpdatedAt` field. When provided, the server compares it against the current `updatedAt` timestamp in the database. If they differ (another user saved in the meantime), the server returns **409 Conflict** with `{ error: 'Conflict', message: 'Modified by someone else', serverUpdatedAt }`. The client displays a "Someone else saved — Refresh" message instead of silently overwriting.

---

## 10a. Output Sanitization

All user-facing HTML rendering uses **DOMPurify** on the client side to prevent XSS:

- **Project Brief** (`ProjectBriefCard.tsx`) — Markdown is parsed to HTML via `marked` (GFM mode) in `renderMarkdown.ts` and sanitized via `DOMPurify.sanitize()` before insertion with `dangerouslySetInnerHTML`. Links get `target="_blank" rel="noopener noreferrer"` added post-parse.
- **Status Report Modal** (`StatusReportModal.tsx`) — AI-generated HTML status reports are sanitized via `DOMPurify.sanitize()` before rendering.
- **Output sanitization only** — DOMPurify at every render site (ProjectBriefCard, StatusReportModal, QueryPage) is the security boundary. Server-side input stripping (`stripDangerousHtml`) was removed from the project create/update path because it mutated stored user text (data loss) and was bypassable (SVG payloads, nested tags, entity encoding). The correct approach is to store text verbatim and sanitize on output. **Notifications** are scoped per-user via `WebSocketService.sendToUser()` — notification events are delivered only to the target user's WebSocket connections, preventing sensitive data (user names, project names, decisions) from leaking to other clients.
- **WebSocket connection limits** — Per-user cap of 5 concurrent WebSocket connections (oldest closed on overflow) and 2,000 global cap prevent resource exhaustion. Ping/pong keepalive (30s interval, 10s timeout) terminates stale connections.

---

## 11. Rate Limiting

Rate limiting operates at two levels:

1. **Per-API-key** -- Each API key has a configurable `rate_limit` (default 100 req/min). The in-memory `rateLimiter` middleware tracks usage per key and returns `429 Too Many Requests` with `Retry-After` when exceeded. Response headers include:
   - `X-RateLimit-Limit`
   - `X-RateLimit-Remaining`
   - `X-RateLimit-Reset`

2. **Global / security middleware** -- The `securityMiddleware` hook runs on every request for additional request-level checks.

---

## 12. Audit Ledger

The audit ledger (`AuditLedgerService.ts`) provides an immutable, append-only record of all significant actions:

- **SHA-256 hash chain** -- Each entry stores `prevHash` and its own `entryHash`, creating a tamper-evident chain. Since 2026-10-08 entries join the chain one at a time per company (`AuditLedgerRepository.appendLinked`: an in-process queue per company plus a MariaDB named lock `audit_chain:<db>` shared with the scheduled jobs, held from reading the last hash to the insert). Before that, two changes saved at the same moment both linked to the same entry and the chain forked (about 68,000 of 154,000 entries on staging), so a whole-chain check failed at the first fork. Old forks are left as they are: the ledger is append-only and rewriting it would defeat its purpose.
- **Database triggers** prevent `UPDATE` and `DELETE` on the audit table.
- **Actor tracking** -- Every entry records `actorId`, `actorType` (`user`, `api_key`, `system`), and `source` (`web`, `mcp`, `api`, `system`).
- **Queryable** -- Entries can be filtered by project, entity, actor, action, and date range.

This provides a forensic-grade trail suitable for compliance audits and incident investigation.

---

## 13. Policy Engine

The policy engine (`PolicyEngineService.ts`) provides pre-action governance gates:

- **Policies** define an `actionPattern`, a `conditionExpr` (field + operator + value), and an `enforcement` level.
- **Enforcement levels**:
  - `log_only` -- record the evaluation, allow the action.
  - `require_approval` -- block until an approver authorizes.
  - `block` -- deny the action outright.
- **Evaluation context** includes actor, role, entity, project, and arbitrary data (e.g., budget impact, days to deadline).
- Every evaluation is persisted for audit purposes.

Example use case: block any task reassignment where `budget_impact > 10000` unless approved by a project admin.

---

## 14. Webhook Security

Outbound webhooks (`WebhookService.ts`) are secured with HMAC signatures:

- Each webhook registration generates a unique secret (32-byte random hex).
- Deliveries are signed so the receiver can verify authenticity.
- Failed deliveries increment a `failure_count`; the service tracks `last_status_code` for monitoring.

---

## 14a. AI suggestions and workflows stay inside their project (Oct 2026)

Found in the 2026-10-03 agent review; fixed before any agent was switched on.

- **Workflows run only on their own project.** `dagWorkflow/index.ts` `appliesTo`: a workflow saved for a project is skipped for other projects' task changes, project changes and agent proposals (it used to match on trigger type alone, so project A's workflow could change project B's tasks or approve B's proposals). Company-wide workflows (no project) can only be created by a company admin. Inside a project's workflow, steps can't name another project: `executeAction(…, scope)` notifies, runs agents and auto-approves only on the workflow's project (`auto_approve_proposal` skips a proposal from elsewhere).
- **Agents never act by themselves without the PM.** `AutonomyService.canAutoExecute` only honours a Tier 3 setting for that exact project; company-wide settings are ignored. `PUT /agent/autonomy/:agentId` requires a `projectId` and the Manager/Owner of that project (was: any admin, for all projects). The Autonomy tab no longer shows promote/demote (autonomy is a long-term goal; agents only suggest).
- **Slack can't approve or reject proposals.** The buttons let anyone in the channel decide, recorded as the integration owner. Messages now link to Kovarti, where the PM check applies; old buttons reply with that link.
- **Knowledge search (rag-context-v1) is per project.** Agents receive `context.projectId` from the registry; the search returns meeting notes only from that project (none without one). `RagService.buildContextString` now requires the readable-projects set.
- Tests: `DagWorkflowService.test.ts` (another project's events skipped; company-wide still runs), `dagWorkflowScope.test.ts`, `AutonomyService.test.ts`, `ragAgentCapability.test.ts`.

## 14b. Security lows from the 2026-10-04 audit (Oct 2026)

- **Expired guests really lose access.** `guestGuard` was a global `onRequest` hook, which runs before route authentication — it never saw a user, so guest limits and the expiry date did nothing. It now runs inside `authMiddleware` on both the cookie and the API-key/Claude path (the key path now loads `is_guest`/`guest_expires_at`). An expired guest gets 401 (the app signs them out); sign-in and session refresh refuse them with "Your guest access has expired…". Sign-out still works.
- **Live updates stay inside the company.** A WebSocket connection remembers its company (`orgId`/`dbName` from the request that opened it). `presence:join` is checked inside that company for every role (`WebSocketService.canJoin`): PMO/executive → the project exists in their company; everyone else → a project they can see (`findByIdForUser`); no company → refused. (Admin/PMO/executive used to skip the check, and the membership check ran outside any company.) `broadcast` without a project now sends nothing — it used to go to every connected client in every company.
- **Links, parents and epics stay in one plan.** `ScheduleService.validateSameScheduleRef` refuses a parent or epic that isn't a task in the same schedule (create and edit; AI task actions go through the same service). `PUT /bulk/tasks` checks a predecessor or parent id is in the row's schedule before writing it.
- **Smaller holes.** No time can be logged on the sample project (`sample_read_only`); `POST /alerts/execute-action` needs a write key and the AI plan; flagging a line on a weekly timesheet requires that task to be on that sheet.
- Tests: `__tests__/security/auditLows.test.ts`, `WebSocketService.test.ts`, `bulkUpdateRollup.test.ts`, `WeeklyTimesheetService.test.ts`.

## 14c. The company owner has a PMO's permissions (Oct 2026)

User decision on the audit: the owner may do everything a PMO can inside their company. One rule (`utils/companyOwner.ts` `permissionRole`): `authMiddleware` looks up `organizations.owner_user_id` with the user row (cookie and API-key paths) and sets `request.user.role = 'pmo'` for the owner (`accountRole` keeps their own). So every existing PMO check — project access (`GLOBAL_FULL_ACCESS`), company-wide workflows, AI context settings, resource requests, Team Planner, scopes — applies to the owner with no per-route changes. Not applied during the platform admin's Support view (that stays a read-only executive) and never to guests or the platform admin. `/auth/login` and `/auth/me` send the same role so the app's menus match. Tests: `__tests__/utils/companyOwner.test.ts`.

**Global roles only reach projects that exist in their company.** PMO/executive (and so the owner) skipped the project check, so another company's project id passed and the route answered with an empty result (no data crossed — each company has its own database — but "OK" instead of "not found"). `checkProjectRoleFor` and `checkEntityProjectAccess` now look the project up in the caller's company first and answer 404 if it isn't there. Found by the staging suite (`weekly-review.spec.ts` "another company is refused") right after the owner change.

**Caches are per company.** The real reason that check still passed: the project cache (`CachedRepository`, 5 minutes) keyed entries by project id only, so a project cached while company A used it was returned to company B asking for the same id. Keys now carry the company (`utils/companyCacheKey.ts`), as do the EVM AI cache and the "already notified" markers of the deadline and schedule-review jobs (every company's sample project shares the same ids). Exploiting the old key needed another company's project UUID (not guessable); the sample's shared id was the realistic case. Test: `__tests__/database/cachedRepositoryTenant.test.ts`.

## 14c-2. Shared AI tables and the audit check (Oct 2026)

Found by the 2026-10-08 efficiency check and fixed the same day:

- **Mjuzi memory** (`agent_memory`, `/api/v1/memory`, `/api/v1/agent/memory`) is one table for every company with no company column. The routes allowed admin **or PMO**; since the company owner works as PMO, any owner could list, change or delete other companies' memories. Now the Kovarti platform admin only (`platformAdminOnly`: role admin and no company — these two paths are exempt from the company check so that account can reach them); the Memory Browser tab is hidden for everyone else. A guard now also refuses new bare `role === 'admin'` checks in `routes/ai` and `routes/agent`. Moving memory into each company's own database is a separate, planned change.
- **AI settings** (`ai_context_configs`, `/api/v1/context/config/:scope/:scopeId`, history) are shared too, keyed by scope id. A PMO/owner could read or change another company's organisation settings, or read any user's, by passing its id. Now the id must be the caller's own company (`request.tenantOrg`, or the account's company on a single-company install), a user of it, or a project they can open (other ids answer 404).
- **Audit verify** (`GET /api/v1/audit/verify`): any signed-in user could check the whole chain, which loaded every entry into memory. Now one project's count needs access to that project; the whole chain needs PMO/owner, is read 1,000 entries at a time, and it and the compliance export are rate-limited (10 per 10 minutes).

Tests: `routes/crossCompanyAiSettings.test.ts`, `routes/auditVerifyAccess.test.ts`.

**Workflow loop stopped** (2026-10-08): the seed workflow "Auto-complete on 100%" re-triggered itself (66,000 runs in 82 minutes on staging; prod had it switched on in every company). Now: progress/date triggers fire on the change only; `update_field` skips a value already set; workflows started by workflows stop at depth 3 (`runAsWorkflow` / `workflowDepth` in the request context); the task route no longer runs workflows a second time. Tests: `services/workflowLoop.test.ts`.

**Heavy actions are rate-limited per person** (2026-10-08): imports, exports, downloads, Word reports, Monte Carlo, AI risk scan, bulk links, knowledge-base rebuild, waitlist and log downloads use `heavyActionLimit(action, limit)` (`middleware/rateLimiter.ts`; in-memory per server, per user, else per IP; 429 with `Retry-After`). Limits per 10 minutes: 5 admin actions, 10 simulate/scan/AI import, 20 imports and bulk changes, 30 Word/exports, 60 bulk link/unlink (Undo uses them) and file downloads, 120 sprint readiness, 300 single-project export (Export my data fetches every project one at a time and stops with a message rather than a file with gaps). The app does not retry a 429. The efficiency guard fails a new heavy route without a gate and a limit.

## 14d. Clients (project groups) — who may do what (Oct 2026)

Before October 2026 any member with write scope could create, rename or delete project groups and move ANY project in the company into one. Now (`routes/core/projectGroups.ts`): managing the client list (create, update, delete, reorder) and emailing a client report need the role `pmo` or `project_manager` (the company owner works as PMO); assigning/unassigning a project needs that project's Manager/Owner (`checkProjectRoleFor(…, 'manager')`). The client RAID view and client report (`ClientService`) include only projects the viewer can open (`readableProjectIds`), never archived ones or the sample, and change nothing. Project create/update and template apply check the client exists before writing (400 otherwise). Tests: `__tests__/services/ClientService.test.ts`, `emptyBodyErrors.test.ts`.

## 15. Stakeholder Portal Access

The stakeholder portal (`PortalService.ts`, `src/server/routes/portal.ts`) provides limited external access:

- Access is granted via a single-use or time-limited **portal token**.
- Portal sessions are scoped to **read-only** access on specific project data.
- No JWT session or API key is required -- the token itself is the credential.

---

## 16. Development vs Production

| Aspect | Development | Production |
|---|---|---|
| CSP | Report-only | Enforced |
| `script-src` | Includes `'unsafe-eval'` for HMR | No `'unsafe-eval'` |
| HSTS | Disabled | Enabled (1 year, preload) |
| Cookies | `secure: false` | `secure: true` |
| CORS | All origins allowed as fallback | Strict origin validation |
| Logging | Verbose security logging | Minimal |

---

## 17. Deployment Checklist

Before deploying to production, verify the following:

- [ ] `NODE_ENV` is set to `production`
- [ ] `COOKIE_SECRET` is a strong random value (minimum 32 characters)
- [ ] `JWT_SECRET` is a strong random value, different from `COOKIE_SECRET`
- [ ] `CORS_ORIGIN` is set to the exact production domain
- [ ] HTTPS is terminated by the reverse proxy (LiteSpeed / Nginx)
- [ ] Database credentials are not committed to version control
- [ ] `AI_ENABLED` is set intentionally (controls Claude SDK features)
- [ ] API key rate limits are configured appropriately
- [ ] Audit ledger database triggers are in place (prevent UPDATE/DELETE)
- [ ] OAuth client secrets for MCP are stored securely
- [ ] Webhook secrets are unique per registration
- [ ] Password reset email configuration is verified

---

## 18. Privacy Policy and Third-Party Data Processors

The **Privacy Policy** page (`/privacy`) discloses the application's use of third-party services that may process user data:

- **Google Analytics (GA4)** -- The application uses GA4 for usage analytics. GA4 sets the cookies `_ga` and `_ga_*` in the user's browser. Data collected (page views, session duration, events) is transferred to Google's servers, which may be located outside the user's country of residence.
- **International data transfers** -- By using the application, users acknowledge that their data may be transferred to and processed in jurisdictions with different data protection laws than their own.
- **Google as a data processor** -- Google is listed as a third-party data processor in the Privacy Policy. Users can review Google's own privacy policy and opt out of GA4 tracking via standard browser mechanisms (e.g., browser settings, GA opt-out browser add-on).

The CSP `connect-src` directive does **not** need to be widened for GA4 — GA4 uses its own measurement protocol and loads via the `script-src` allowlist. Verify that `https://www.google-analytics.com` and `https://www.googletagmanager.com` are included in the production CSP `script-src` if GA4 is active.

---

## 19. Testing

### Security Headers

```bash
# Verify security headers on a production endpoint
curl -I https://your-domain.com/api/health

# Expected: X-Content-Type-Options, X-Frame-Options, Strict-Transport-Security, CSP, etc.
```

### CORS Rejection

```bash
# Expect CORS error from unauthorized origin
curl -H "Origin: https://malicious-site.com" \
  -H "Access-Control-Request-Method: POST" \
  -X OPTIONS https://your-domain.com/api/auth/login
```

### Rate Limiting

```bash
# Send requests and observe X-RateLimit-* headers
for i in $(seq 1 5); do
  curl -s -o /dev/null -w "%{http_code} " \
    -H "Authorization: Bearer kpm_your_key_here" \
    https://your-domain.com/api/projects
done
```

### API Key Scope Enforcement

```bash
# A read-only key should receive 403 on write endpoints
curl -X POST -H "Authorization: Bearer kpm_read_only_key" \
  -H "Content-Type: application/json" \
  -d '{"name":"test"}' \
  https://your-domain.com/api/projects
```

---

## 20. Related Files

| File | Purpose |
|---|---|
| `src/server/plugins.ts` | Helmet, CORS, cookie, rate limiting, API key resolution |
| `src/server/middleware/requireScope.ts` | Scope-based authorization middleware |
| `src/server/middleware/requireProjectAccess.ts` | Project-level membership + role enforcement |
| `src/server/middleware/securityMiddleware.ts` | Request-level security checks |
| `src/server/middleware/rateLimiter.ts` | In-memory rate limiter |
| `src/server/routes/auth.ts` | Login, logout, refresh, password reset |
| `src/server/routes/apiKeys.ts` | API key CRUD endpoints |
| `src/server/routes/portal.ts` | Stakeholder portal routes |
| `src/server/services/UserService.ts` | Password hashing (bcrypt) |
| `src/server/services/ApiKeyService.ts` | API key creation, validation, usage logging |
| `src/server/services/AuditLedgerService.ts` | Immutable audit ledger with hash chain |
| `src/server/services/PolicyEngineService.ts` | Pre-action policy evaluation |
| `src/server/services/WebhookService.ts` | Webhook registration and signed delivery |
| `src/server/services/PortalService.ts` | Portal token management |
| `src/server/middleware/auth.ts` | JWT authentication middleware |
| `src/server/routes/users.ts` | User management routes |
| `mcp-server/src/oauth/provider.ts` | OAuth 2.1 authorization server (MCP transport) |
| `mcp-server/src/oauth/clientsStore.ts` | OAuth client registration (MCP transport) |
| `src/client/index.html` | Client-side security meta tags |
| `src/client/src/services/securityService.ts` | Client-side security utilities |

---

Security is an ongoing process. Keep dependencies updated, review audit logs regularly, and conduct periodic penetration testing.
