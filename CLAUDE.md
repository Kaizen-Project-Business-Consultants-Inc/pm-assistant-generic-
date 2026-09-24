# PM Assistant — Software Development Lifecycle (SDLC)

> ## 🔴 RESUME HERE — handover, 2026-09-24 (laptop restart)
> **Staging is well ahead of prod again.** Everything below `a3e33a72` (the last
> commit where both were in sync) is staging-only — nothing since has been
> promoted, and none of it has had prod even discussed. Full detail is in
> `memory/recent-changes.md` (repo) and the auto-memory `todo.md`; this is the
> short version, newest first:
>
> - **RAID items can be owned by a resource with no login** (`6e638200`) — e.g.
>   external subcontractors. New `owner_resource_id` column, wired through the
>   repository/routes/MCP tools/RAID panel display. Manually verified on staging
>   (not just unit tests): a real RAID item saved with a login-less resource as
>   owner, two ways (direct ID and name-auto-resolve).
> - **Tenant migrations auto-apply on every app restart** — this was
>   undocumented/assumed-manual until tonight; corrected in `MEMORY.md` and
>   `memory/deployment.md`. Found and dropped 4 orphaned staging tenant
>   databases with no organization record and no data while investigating.
> - **A large MCP connector bug-fixing pass**, done in several rounds after the
>   user actually drove the `kovarti-stage` MCP connector and reported real
>   failures: bulk task creation 500ing, zero-day milestones rejected,
>   methodology/projectType dropped on project create, project updates
>   silently resetting untouched fields (also true of resources and two other
>   endpoints — audited and fixed), no way to link tasks in the same bulk-create
>   batch (dependency **and** parent/summary-task grouping, both by name or
>   array position), no archive-project MCP tool, resource-create rejecting
>   name-only payloads, sprint creation missing `scheduleId`, and the audit
>   trail being unable to tell MCP actions from web UI ones. **First pass was
>   reported "done" and wasn't** — always re-verify against current code, not
>   an earlier summary, when the user asks "did you fix all."
> - **Microsoft Teams notifications** (`9f6bc9f3`), mirroring the Slack
>   integration. **Cannot actually connect anywhere yet** — needs the Azure AD
>   app permission change (`ChannelMessage.Send`, `Team.ReadBasic.All`,
>   `Channel.ReadBasic.All`, `offline_access` on the existing OneDrive app
>   registration, client ID `64c25378-b4ab-45ae-bc48-43f8472f487d`) and the
>   `/api/v1/teams/callback` redirect URI registered — both only the user can
>   do, in the Azure portal.
>
> **None of this has been manually driven end-to-end except the RAID fix and
> the earlier MCP round the user tested directly.** Before considering prod:
> the user should exercise the rest through the actual MCP tools, then decide.
>
> ## ✅ Registration-flood alert — DONE, LIVE ON STAGING + PROD (2026-09-24)
> The signup-flood alert from the 2026-09-23 handover shipped:
> `src/server/utils/registrationWatch.ts` counts attempts in Redis;
> `AlertService.checkRegistrationFlood()` emails support@kovarti.com when one
> address exceeds 20/hour or the site exceeds 50/hour overall. The failing test
> (`AlertService.test.ts > "registers over and over"`) was a test-scoping bug, not
> a code bug — three tests were nested inside `checkCronJobsRunning`'s `describe`
> block and inherited its `alertsRaised` filter, which only matched cron-job
> messages, so the flood alert's own log line never counted as raised. Moved to
> their own `describe` block with the right filter.
>
> **Also fixed in the same push:** server tests never loaded `.env` (only the real
> app's entrypoint did via `dotenv/config`), so any test importing `config.ts`
> unmocked failed config validation — this silently blocked `deploy.sh`'s test gate
> for *any* change, not just this one. Fixed with `src/server/__tests__/setup.ts`.
>
> **Staging and production are now IN SYNC** — both running build `ccea36fda5f6`,
> verified independently (health check + build-hash match on both, not just the
> deploy script's own success message). This promoted everything staging had
> queued: no tenant database until email is verified, tighter signup limits, the
> "Confirm your email" screen, and the CAPTCHA plumbing (still dormant — see below).
> Full Playwright suite run against staging (never prod — some specs create/delete
> real data): 59 passed, 1 skipped, 0 failed.
>
> **CAPTCHA: still PARKED at the user's request**, despite the code now being on
> both servers. Cloudflare Turnstile is fully built (server check, widget, startup
> validation, `scripts/set-turnstile-credentials.sh`) but **switched off
> everywhere** — no keys in either `.env`. It never worked in a real browser: first
> the site's Content-Security-Policy blocked Cloudflare (fixed in nginx on staging),
> then Cloudflare rejected the hostname (error 110200), then with new keys the
> widget rendered nothing at all. **Do not restart this without the user asking.**
> Turnstile refuses automated browsers, so Playwright can never test the happy
> path — only a human can.
>
> **⚠️ Two machine-only facts, not in this repo:**
> 1. nginx config lives ONLY on the servers, and `sites-enabled/pm-app` is a
>    **separate file, not a symlink** to `sites-available`. Editing the obvious one
>    changes nothing. Staging's copy now allows `challenges.cloudflare.com`;
>    production's still does not.
> 2. Production would need the same nginx change before the CAPTCHA could work there.


This document governs how every feature, bug fix, and change is developed. Claude acts as the full IT team: Business Analyst, Architect, Developer, QA Engineer, Technical Writer, and DevOps Engineer. Follow every phase in order. Do not skip phases.

---

## Phase 1: Requirements & Use Cases

Before writing any code:

- **Clarify the request** — ask questions, don't assume. Identify ambiguity and resolve it.
- **Document what the feature does**, who it serves, and define acceptance criteria.
- **Identify edge cases and error scenarios** — what happens when inputs are invalid, services are down, or data is missing?
- **List affected user workflows** — API consumers, UI users, agents, cron jobs, admin operations.
- **Identify dependencies** — does this depend on other features, external services, or data?

## Phase 2: Design & Architecture

- **Enter plan mode** for any non-trivial change (more than a simple bug fix or single-line tweak).
- **Explore the codebase** to understand existing patterns, utilities, and conventions before proposing new ones.
- **Identify all files** that will be created, modified, or deleted.
- **Evaluate architectural impact** — does this change data models, API contracts, service boundaries, or agent behavior?
- **If architecture changes:** update architecture docs before coding.
- **Security review** — consider OWASP top 10, authentication, authorization, input validation, output encoding.
- **Performance review** — consider query efficiency, cron frequency, payload sizes, background work volume.
- **Get user approval** on the plan before proceeding to implementation.

## Phase 3: Database Changes

- **Write migration SQL files** for any schema changes.
- **Follow naming convention:** `NNN_descriptive_name.sql` (sequential numbering).
- **Include seed data** if applicable (reference data, default configurations).
- **Never modify existing migration files** — always create new ones. Migrations are immutable once applied.
- **The database runs on the app servers themselves** (`DB_HOST=localhost` on both 147.5.127.99 and 147.5.127.251). Never attempt local MySQL on the dev machine — always SSH to the server for migrations. (This used to say TMD Hosting; nothing at runtime depends on TMD any more. Outbound email goes through Resend.)

## Phase 4: Implementation

- **Follow existing code patterns and conventions** — match the style of surrounding code.
- **Reuse existing utilities and services** — don't reinvent what already exists. Search before creating.
- **Keep changes minimal and focused** — solve what's asked, not what might be needed someday.
- **Write secure, correct code** — no SQL injection, XSS, command injection, or other vulnerabilities.
- **Fire-and-forget for non-critical side effects** — don't block the main flow for logging, analytics, or notifications.
- **No over-engineering** — no feature flags, abstractions, or configurability beyond what's requested.

## Phase 5: Testing

Run all checks before committing. Zero regressions.

1. **Type check:** `npx tsc --noEmit` — zero type errors.
2. **Unit tests:** Write tests for new logic — happy path, edge cases, and error handling.
3. **Run all tests:** `npx vitest run` — all tests pass (new and existing).
4. **Full build:** `npm run build` — build succeeds with no new errors.

## Phase 6: Documentation

Documentation ships in the **same commit** as the code. It is not an afterthought. Update ALL affected docs:

| Document | When to Update |
|---|---|
| `README.md` | Feature list, architecture overview, API endpoints |
| `PRODUCT_MANUAL.md` | Detailed feature documentation |
| `WORLD_CLASS_FEATURES.md` | Feature specs and benchmarks |
| `TESTING_GUIDE.md` | How to test the new feature |
| `docs/USER_GUIDE.md` | End-user documentation |
| `docs/ADMIN_MANUAL.md` | Admin configuration and operations |
| `docs/AI_DESIGN_FEATURES.md` | AI/agent-related features |
| `SECURITY_GUIDE.md` | Auth, security, or access control changes |
| `DEPLOYMENT_GUIDE.md` | Infrastructure or configuration changes |
| Memory files | Architecture decisions that should persist across sessions |

Only update docs that are actually affected by the change. Don't update docs for unrelated features.

## Phase 7: Commit & Push

- **Atomic commits** with descriptive messages (what was changed + why).
- **Stage specific files** — never `git add -A` or `git add .`. Name each file explicitly.
- **Push to origin** after every successful commit: `git push origin master`

## Phase 8: Performance Review

Before deploying, verify:

- New DB queries use indexes — check with `EXPLAIN` if queries are complex.
- No N+1 query patterns in loops.
- Cron/scanner frequency is appropriate — not hammering the database.
- API payload sizes are reasonable — no unbounded result sets without pagination.
- Fire-and-forget calls won't create unbounded background work.
- Template resolution and JSON parsing handle large inputs gracefully.

## Phase 9: Deploy to Production (TMD Hosting)

- **SCP built files** to server.
- **Run migrations** via SSH if there are schema changes.
- **Restart the app** via `systemctl restart pm-app`.
- **Verify restart succeeded** — check that the process is running.

See [deployment.md](./memory/deployment.md) in memory files for full deployment details.

## Phase 10: Production Verification

After deployment, verify the change works in production:

- **Verify migration applied** — check the `_migrations` table if migrations were run.
- **Verify DB state** — confirm new tables exist, seed data is present, columns are correct.
- **Smoke test the feature** — make API calls or check the UI to confirm the feature works.
- **Check for errors** in logs if accessible.

## Phase 11: Rollback Procedures

If something goes wrong after deployment:

- **Code rollback:** `git revert <commit>`, rebuild, redeploy files via SCP, restart.
- **Migration rollback:** Write a reverse migration SQL (DROP columns/tables, undo ALTERs), run via SSH. Never delete the forward migration file — add a new one.
- **Emergency restart (staging):** `ssh ubuntu@147.5.127.99 'sudo systemctl restart pm-app'`
- **Emergency restart (production):** `ssh ubuntu@147.5.127.251 'sudo systemctl restart pm-app'`
- **Data recovery:** MariaDB point-in-time recovery via cPanel backups if data was corrupted.
- **Post-mortem:** Document what went wrong and what was done to fix it.

## Phase 12: Completion Report

After everything is deployed and verified:

- **Summarize what was done** — brief description of the change.
- **List files changed** and why each was modified.
- **Note known limitations** or follow-up items if any remain.
- **Confirm production is healthy** — feature works, no errors, no regressions.

---

## Quick Reference: The Full Cycle

Every change follows this cycle without exception:

```
Requirements -> Design -> DB Changes -> Implement -> Test -> Document -> Commit -> Perf Review -> Deploy -> Verify -> Report
```

No partial steps. No skipping phases. If a phase doesn't apply (e.g., no DB changes), note it and move on.

---

## Feature Quality Checklists

Before shipping any feature, run through the applicable checklist. These exist because past audit findings repeatedly caught the same categories of gaps.

### Editable Content
- [ ] Save and cancel paths: auto-save on blur, explicit save, Escape to cancel/revert
- [ ] Unmount flush: if debounced save is pending and user navigates away, flush it
- [ ] Conflict detection: if multiple users can edit the same data, use optimistic locking (send `expectedUpdatedAt`, handle 409)
- [ ] Error feedback: show save failures with retry option, not silent swallowing
- [ ] Input sanitization: server-side stripping of dangerous HTML on write
- [ ] Output sanitization: DOMPurify on any `dangerouslySetInnerHTML`
- [ ] Use a proper parser (e.g., `marked`) for markdown — never hand-rolled regex
- [ ] Link clicks in rendered content should not trigger edit mode

### Real-Time / WebSocket Features
- [ ] Authorization: verify the user has access to the resource they're subscribing to (e.g., project membership on `presence:join`)
- [ ] Scoped broadcast: send events only to clients that need them, not all connected clients
- [ ] Scoped query invalidation: invalidate only the affected cache keys (e.g., `['tasks', scheduleId]`), not all cached data globally
- [ ] Reconnect: re-establish subscriptions after WebSocket reconnect (server state is gone)
- [ ] Connection limits: enforce per-user and global caps to prevent resource exhaustion
- [ ] Keepalive: ping/pong heartbeat to detect and terminate stale connections

### Accessibility (a11y)
- [ ] Keyboard access: interactive elements need `tabIndex`, `role`, and `onKeyDown` (Enter/Space)
- [ ] Screen readers: dynamic status indicators need `role="status"` and `aria-live="polite"`
- [ ] Reduced motion: animations must respect `prefers-reduced-motion` / `motion-reduce:` classes
- [ ] Focus management: modals trap focus, edit mode receives focus on entry

### New Components
- [ ] Check for existing shared primitives before building inline — search the codebase first
- [ ] If two+ components need the same behavior, extract the shared piece *before* building both
- [ ] Reorderable/draggable elements: integrate with existing grid/order systems, don't create parallel ones

### SEO & Performance
- [ ] SPA pages: provide `<noscript>` fallback or server-side prerender for crawlers
- [ ] External dependencies: use `preconnect` / `preload` for third-party origins
- [ ] Fonts: load non-render-blocking (`media="print"` with `onload` swap)

---

## Lessons Learned

Hard-won lessons from past audits and production issues. Read these before designing new features.

### 1. Design all states upfront, not incrementally
**What happened:** ProjectBriefCard started as a simple text display, then grew editing, auto-save, presence, conflict detection, a11y, and markdown rendering across 6+ separate changes. Each addition missed interactions with existing behavior (Escape committed instead of cancelling, unmount lost data, links triggered edit mode).

**Rule:** When a component has more than two states (e.g., viewing/editing/saving/error/conflict), write a state diagram before coding. List every transition and what triggers it. This prevents states from conflicting with each other.

### 2. Build shared primitives first, not after
**What happened:** Presence avatars were implemented inline in ProjectDetailPage, then a separate chip variant was built into ProjectBriefCard. After the audit, both were extracted into a shared `PresenceIndicator` component. The extraction work was pure waste.

**Rule:** If a pattern will appear in 2+ places, create the shared component *before* building either consumer. The cost of extraction later is always higher than building it shared from the start.

### 3. Authorization is not optional for real-time features
**What happened:** The WebSocket `presence:join` handler accepted any projectId from any authenticated user, with no membership check. Any logged-in user could see who was viewing any project.

**Rule:** Every subscription/join event must verify the user has access to the resource. Real-time features are APIs — they need the same authorization as REST endpoints.

### 4. Regex is not a parser
**What happened:** Markdown rendering used hand-written regex (`/\*\*(.*?)\*\*/g` → `<strong>`) which broke on nested formatting, multi-line content, and edge cases. The audit flagged it and we replaced it with `marked` (a proper GFM parser) — a single dependency that eliminated ~30 lines of fragile code.

**Rule:** Use established parsers for structured formats (markdown, HTML, CSV, XML). Regex works for simple pattern matching, not for parsing nested grammars.

### 5. Scope everything: broadcasts, invalidation, subscriptions
**What happened:** Task update WebSocket broadcasts went to all connected clients regardless of which project they were viewing. Query invalidation cleared all cached `['tasks']` queries globally, causing unnecessary refetches across unrelated projects.

**Rule:** Every broadcast, cache invalidation, and subscription must be scoped to the narrowest relevant boundary (projectId, scheduleId). Global operations should be the exception, not the default.

### 6. Keyboard and screen reader access from day one
**What happened:** The brief card's view-mode div had `onClick` but no `tabIndex`, `role`, or `onKeyDown`. Keyboard users couldn't enter edit mode. The editing indicator had no ARIA attributes. These were flagged as separate audit findings and required separate fixes.

**Rule:** Every interactive element gets keyboard and screen reader support in the same PR that adds the interaction. It's 3 extra attributes (`tabIndex={0}`, `role="button"`, `onKeyDown`) — never worth deferring.
