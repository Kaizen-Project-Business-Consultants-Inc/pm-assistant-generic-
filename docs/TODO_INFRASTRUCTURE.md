# Infrastructure TODO Items

Items from the architecture audit. Most were previously blocked by TMD shared hosting — resolved after migration to Oracle Cloud (July 2026).

---

## ~~Item 11: Redis Rate Limiter + Metrics Store~~ — DONE (July 2026)

**Implemented:** Redis installed on Oracle Cloud (`redis-server`, systemd-managed). `ioredis` package added.
- **RedisService** (`src/server/services/RedisService.ts`) — singleton with graceful fallback. All methods return safe defaults when disconnected.
- **RateLimiter** upgraded with `checkAsync()` method — uses Redis `INCR`/`EXPIRE` when connected, falls back to in-memory. Portal routes migrated to `checkAsync`.
- **MetricsService** upgraded with `startRedisSync()` / `loadFromRedis()` — persists aggregate counters to Redis every 30s (key: `metrics:snapshot`, 24h TTL). Counters survive process restarts.
- **Config:** `REDIS_URL` env var (default: empty = disabled). Set to `redis://localhost:6379` on server.
- **Boot:** `index.ts` connects Redis before plugins, loads metrics, starts sync interval. Shutdown disconnects cleanly.

---

## ~~Item 12: Repository Caching Layer~~ — DONE (July 2026)

**Implemented:** `CachedRepository<T>` wrapper (`src/server/database/CachedRepository.ts`) — generic read-through cache with Redis backing.
- `findById()` checks Redis first (key: `cache:<prefix>:<id>`), falls through to DB on miss, stores result with TTL
- `invalidate(id)` deletes cache entry on write
- Applied to `ProjectService` — `findById()` uses cached path (5-min TTL), `update()` and `delete()` invalidate
- Graceful fallback: when Redis is disconnected, all calls pass through directly to the repository
- Extensible: wrap any repository with `new CachedRepository(repo, { prefix, ttlSeconds })` to add caching

---

## Item 13: External Cron Scheduler

**Current state:** 5 in-process cron jobs via `node-cron` (agent scan, overdue scan, recurrence, digest emails, report delivery). If the Node process crashes, all stop. If multiple instances run, jobs execute in duplicate.

**What's needed:** An external job runner (e.g., BullMQ + Redis, or systemd timers hitting API endpoints).

**When ready:** Move job definitions to external scheduler. Keep job logic in existing services — just change the trigger mechanism.

**Priority:** Low — single-process deployment with systemd auto-restart is reliable enough. Becomes important if scaling to multiple instances.

---

## ~~Item 14: Migration Rollback Runner~~ — DONE (July 2026)

**Implemented:** `migrationRunner.ts` now exports `rollbackMigrations(count, dryRun)`, `dryRunMigrations()`, and `listMigrations()`. CLI via `migrateCli.ts`:
- `run` — apply pending migrations (existing behavior)
- `run --dry-run` — preview pending migrations without executing
- `rollback [N]` — rollback last N migrations using `.down.sql` files
- `rollback --dry-run` — preview what would be rolled back
- `list` — show all migrations with applied/pending status and rollback availability

Rollback files use convention `NNN_name.down.sql` alongside `NNN_name.sql`. Forward runner excludes `.down.sql` files.

**Removed 2026-10-08:** the CLI was never wired into any script or deploy and was deleted as dead code; rollbacks follow CLAUDE.md Phase 11 (write a reverse migration and run it over SSH).

---

## ~~Item 14b: Portal Rate Limiting~~ — DONE (July 2026)

**Implemented:** Per-IP rate limiting on public portal routes using `rateLimiter.checkAsync()` (Redis-backed when available, in-memory fallback):
- `GET /portal/view/:token` — 60 req/min per IP
- `POST /portal/view/:token/comment` — 5 req/min per IP
- Returns `X-RateLimit-Remaining` and `X-RateLimit-Reset` headers; 429 with `retryAfterMs` on excess

---

## ~~Item 15: External Alerting~~ — DONE (July 2026)

**Implemented:** `AlertService` (`src/server/services/AlertService.ts`) — periodic health monitoring with multi-channel alerting.
- **Checks (every 5 minutes):** error rate spike (>10% 5xx), AI budget warning (80%) and critical (95%), circuit breaker open, DB connection lost, DB latency high (>2s)
- **Alert channels:** email (via Resend), webhook (POST JSON), in-app notifications (to all admin users)
- **Cooldown:** Redis-backed deduplication — same alert type won't re-fire within `ALERT_COOLDOWN_MINUTES` (default: 30)
- **Config:** `ALERT_ENABLED` (default: false), `ALERT_EMAIL`, `ALERT_WEBHOOK_URL`, `ALERT_COOLDOWN_MINUTES`
- **Boot:** starts after server listen; stops on SIGINT/SIGTERM

**Not implemented:** Distributed tracing (trace ID propagation to external services). Low priority for single-instance deployment.

---

## Item 16: Dashboard Enhancements (UI)

**These items came from the dashboard wireframe discussion (July 2026).**

### ~~16a: AI Next Best Actions Widget~~ — DONE (July 2026)
Implemented as `NextBestActionsWidget` + inline `AINextBestActions` in `ActionCenterPM`. Aggregates pending proposals, high-severity notifications, and low-health projects into prioritized action cards. Wired into PM Dashboard.

### ~~16b: Health Trends Sparklines Widget~~ — DONE (July 2026)
Implemented as `HealthTrendsWidget` with SVG sparklines. Backend: `project_health_history` table (migration 038), daily snapshot cron (`healthSnapshotJob.ts`), `GET /api/v1/predictions/project/:id/health-history` endpoint. Wired into PM Dashboard.

### ~~16c: Activity Feed + AI Summary Sidebar~~ — SKIPPED (July 2026)
Redundant — dashboard already has `AISummaryBanner` (portfolio AI insights) and `ActionCenterPM` (priorities + AI next best actions) covering this use case.

### ~~16d: Dashboard Footer~~ — DONE (July 2026)
Last-refreshed timestamp and version label added to PM Dashboard.

---

## Remaining Open Items

| # | Item | Status | Blocker |
|---|------|--------|---------|
| 13 | External Cron Scheduler | Open | None (low priority) |
| 17 | Native Mobile Apps | Open | None (major effort) |
| 18 | Integration Marketplace | Open | None (major effort) |
| 19 | Subscription Gating (5 phases) | In Progress | None |

---

## Item 17: Native Mobile Apps

**Gap:** PWA support is live (app-shell caching, installability, offline banner, auto-update) but competitors (Monday, Asana, ClickUp) all have native iOS/Android apps with offline sync, push notifications, camera integration, and deep mobile UX. Kovarti scores 3/5 vs competitor 5/5 on mobile.

**What's needed:**
- React Native or Capacitor wrapper around the existing React app
- Offline data storage (IndexedDB or SQLite) with background sync / mutation queue
- Push notifications via Firebase Cloud Messaging (FCM) / APNs
- Camera integration for file attachments
- Biometric authentication (Face ID / fingerprint)
- App Store / Play Store listing

**Priority:** Medium — PWA covers basic installability, but native apps are table stakes for enterprise adoption.

---

## Item 18: Integration Marketplace

**Gap:** Kovarti has webhook support, API keys, and MCP but no pre-built integrations or marketplace. Competitors offer 200-2000+ integrations. Kovarti scores 2/5 vs competitor 4-5/5.

**What's needed:**
- Pre-built integrations for top platforms: Slack, MS Teams, Jira, GitHub, Google Workspace, Outlook, Zapier
- OAuth2 connection flow for each integration
- Integration marketplace UI (browse, install, configure)
- Webhook event catalog (standardized event types for outbound triggers)
- Zapier / Make.com connector (enables hundreds of integrations via proxy)

**Priority:** Medium — the quickest win is a Zapier/Make connector, which unlocks hundreds of integrations without building each one natively.

---

---

## Item 19: Subscription Gating (5 Phases)

**Spec:** [SUBSCRIPTION_MODEL.md](SUBSCRIPTION_MODEL.md)

| Phase | Description | Status |
|-------|-------------|--------|
| 19a | Backend gating middleware (`requireActiveSubscription`) | Done |
| 19b | Stripe updates (Consultant product, monthly/annual prices, remove Stripe trial) | Done |
| 19c | Database changes (tier ENUM update, migration) | Done |
| 19d | Frontend updates (pricing redesign, trial banner, upgrade prompts) | Done |
| 19e | Refund policy display (checkout, pricing page, acceptance tracking) | Open |

---

See [COMPETITIVE_MATRIX.md](COMPETITIVE_MATRIX.md) for the full feature comparison against Monday.com, Asana, ClickUp, Wrike, and Smartsheet.
