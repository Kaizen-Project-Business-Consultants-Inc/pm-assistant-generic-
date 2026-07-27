# PM Assistant — Software Development Lifecycle (SDLC)

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
- **Database is on TMD Hosting** — never attempt local MySQL. Always SSH to server for migrations.

## Phase 4: Implementation

- **Follow existing code patterns and conventions** — match the style of surrounding code.
- **Reuse existing utilities and services** — don't reinvent what already exists. Search before creating.
- **Keep changes minimal and focused** — solve what's asked, not what might be needed someday.
- **Write secure, correct code** — no SQL injection, XSS, command injection, or other vulnerabilities.
- **Fire-and-forget for non-critical side effects** — don't block the main flow for logging, analytics, or notifications.
- **No over-engineering** — no feature flags, abstractions, or configurability beyond what's requested.

## Phase 5: Testing

Run all checks before committing. Zero regressions.

1. **Type check:** `npx tsc --noEmit` — zero new type errors (pre-existing errors in aiContextBuilder.ts are known).
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
- **Restart the app** via `cloudlinux-selector`.
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
- **Emergency restart:** `cloudlinux-selector restart --json --interpreter nodejs --domain pm.kpbc.ca --app-root pm.ca`
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
