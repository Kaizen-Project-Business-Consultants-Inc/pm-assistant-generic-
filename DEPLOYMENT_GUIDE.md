# PM Assistant — Deployment Guide

## Overview

PM Assistant is deployed on Oracle Cloud (Always Free tier) with Nginx as reverse proxy and systemd managing the Node.js process.

### Staging
- **Domain:** https://pm.kpbc.ca (basic auth protected)
- **Server IP:** 147.5.127.99
- **SSH access:** `ssh -i "~/.ssh/ssh-key-2026-07-08 (1).key" ubuntu@147.5.127.99`
- **App directory:** `/opt/pm-app/`
- **VM:** VM.Standard.E2.1.Micro (1 OCPU, 1GB RAM, x86)
- **OS:** Ubuntu 24.04

### Production
- **Domain:** https://kovarti.com
- **Server IP:** 147.5.127.251
- **SSH access:** `ssh -i "~/.ssh/ssh-key-2026-07-08 (1).key" ubuntu@147.5.127.251`
- **App directory:** `/opt/pm-app/`
- **VM:** VM.Standard.A1.Flex (2 OCPU, 12GB RAM, ARM)
- **OS:** Ubuntu 24.04

## Tech Stack

- **Backend:** Fastify + TypeScript (Node.js 22)
- **Frontend:** React 18 + Vite + Tailwind CSS
- **Database:** MariaDB 10.11 (local)
- **Cache:** Redis 7 (local)
- **Web Server:** Nginx (reverse proxy + static files)
- **SSL:** Let's Encrypt via Certbot (auto-renews)
- **Process Manager:** systemd (`pm-app` service)
- **AI:** Anthropic Claude SDK (optional, controlled by `AI_ENABLED` env var)

## Server Layout

```
/opt/pm-app/
  ├── dist/server/              # Compiled server (Fastify)
  │   └── index.js              # Entry point
  ├── client-dist/              # Compiled client (served by Nginx)
  │   ├── index.html
  │   └── assets/
  ├── backups/                  # Daily MariaDB backups (14-day retention)
  ├── logs/                     # Application logs (Winston, rotated daily)
  ├── uploads/                  # User file uploads
  ├── mcp-server/               # MCP server (separate service)
  ├── node_modules/             # Production dependencies
  ├── package.json
  ├── .env                      # Environment variables
  └── backup.sh                 # Backup script (cron: daily 3am UTC)
```

## Architecture

- **Nginx** listens on ports 80/443 (HTTPS redirect + SSL termination)
- Static files served from `/opt/pm-app/client-dist/`
- API requests (`/api/`, `/ws`) proxied to Node.js on port 3001
- SPA fallback: `try_files $uri $uri/ /index.html`
- **MCP Server** runs as a separate systemd service (`pm-mcp`) on port 3100

## Environment Variables

The `.env` file at `/opt/pm-app/.env` contains:

```
NODE_ENV=production
PORT=3001
HOST=0.0.0.0
DB_HOST=localhost
DB_PORT=3306
DB_USER=pmuser
DB_PASSWORD=<PASSWORD>
DB_NAME=pmassist
JWT_SECRET=<SECRET>
JWT_REFRESH_SECRET=<SECRET>
COOKIE_SECRET=<SECRET>
CORS_ORIGIN=https://pm.kpbc.ca  # staging; use https://kovarti.com for production
REDIS_URL=redis://localhost:6379
AI_ENABLED=true
AI_MODEL=claude-sonnet-4-5-20250929
ALERT_ENABLED=true
```

**Security requirements:**
- `JWT_SECRET`, `JWT_REFRESH_SECRET`, and `COOKIE_SECRET` must each be at least **32 characters**.
- All three secrets **must be different from each other** (validated at startup).

### Optional Environment Variables

| Variable | Default | Purpose |
|----------|---------|---------|
| `ANTHROPIC_API_KEY` | _(empty)_ | Required if `AI_ENABLED=true` |
| `AI_MODEL` | `claude-sonnet-4-5-20250929` | Claude model to use |
| `AI_FALLBACK_MODEL` | _(empty)_ | Fallback model on 429/503 |
| `AI_FALLBACK_ENABLED` | `false` | Enable AI fallback |
| `AI_PRICING_INPUT` | `3.0` | Input token price per million |
| `AI_PRICING_OUTPUT` | `15.0` | Output token price per million |
| `AI_TIER_BUDGET_TRIAL` | `50000` | AI token budget for the free trial when the trial plan has none set (the trial plan in Admin → Pricing sets 50K = ~10 AI questions) |
| `AI_TIER_BUDGET_PRO` | `500000` | Monthly AI token budget for pro tier |
| `AI_TIER_BUDGET_BUSINESS` | `1500000` | Monthly AI token budget for business tier |
| `AI_TIER_BUDGET_CONSULTANT` | `3000000` | Monthly AI token budget for consultant tier |
| `AI_TOPUP_TOKENS` | `500000` | Tokens per top-up pack |
| `AI_TOPUP_PRICE_CENTS` | `500` | Price per top-up pack in cents |
| `AGENT_ENABLED` | `false` | Enable autonomous agent scheduler |
| `AGENT_CRON_SCHEDULE` | `0 2 * * *` | Cron schedule for agent runs |
| `RESEND_API_KEY` | _(empty)_ | Resend email service API key |
| `RESEND_FROM_EMAIL` | `noreply@kpbc.ca` | From address for emails |
| `APP_URL` | `http://localhost:5173` | Public application URL |
| `STRIPE_SECRET_KEY` | _(empty)_ | Stripe billing secret key |
| `STRIPE_PUBLISHABLE_KEY` | _(empty)_ | Stripe publishable key |
| `STRIPE_WEBHOOK_SECRET` | _(empty)_ | Stripe webhook signing secret |
| `STRIPE_MONTHLY_PRICE_ID` | _(empty)_ | Stripe monthly price ID (legacy) |
| `STRIPE_ANNUAL_PRICE_ID` | _(empty)_ | Stripe annual price ID (legacy) |
| `STRIPE_PRO_MONTHLY_PRICE_ID` | _(empty)_ | Stripe Pro monthly price ID |
| `STRIPE_PRO_ANNUAL_PRICE_ID` | _(empty)_ | Stripe Pro annual price ID |
| `STRIPE_BUSINESS_MONTHLY_PRICE_ID` | _(empty)_ | Stripe Business monthly price ID |
| `STRIPE_BUSINESS_ANNUAL_PRICE_ID` | _(empty)_ | Stripe Business annual price ID |
| `STRIPE_CONSULTANT_MONTHLY_PRICE_ID` | _(empty)_ | Stripe Consultant monthly price ID |
| `STRIPE_CONSULTANT_ANNUAL_PRICE_ID` | _(empty)_ | Stripe Consultant annual price ID |
| `STRIPE_TOPUP_PRICE_ID` | _(empty)_ | Stripe token top-up price ID |
| `REDIS_URL` | _(empty)_ | Redis URL (empty = disabled) |
| `ALERT_ENABLED` | `false` | Enable health monitoring alerts |
| `ALERT_EMAIL` | _(empty)_ | Alert notification email |
| `UPLOAD_DIR` | `~/uploads/pm-assistant` | File upload storage directory |
| `MAX_UPLOAD_SIZE_MB` | `10` | Maximum upload file size in MB |
| `MULTI_TENANT_ENABLED` | `false` | Enable multi-tenant mode |

## Deployment Steps

### 1. Build Locally

```bash
npm run build
```

This runs both the server build (TypeScript via `tsc`) and the client build (Vite).

### 2. Upload Server Files

```bash
scp -i "~/.ssh/ssh-key-2026-07-08 (1).key" -r dist/server ubuntu@147.5.127.99:/opt/pm-app/dist/
```

### 3. Upload Client Files

```bash
tar czf /tmp/client-dist.tar.gz -C src/client/dist .
scp -i "~/.ssh/ssh-key-2026-07-08 (1).key" /tmp/client-dist.tar.gz ubuntu@147.5.127.99:/tmp/
ssh -i "~/.ssh/ssh-key-2026-07-08 (1).key" ubuntu@147.5.127.99 \
  "rm -rf /opt/pm-app/client-dist/assets && tar xzf /tmp/client-dist.tar.gz -C /opt/pm-app/client-dist"
```

**Notes on the client build output:**
- `robots.txt` and `sitemap.xml` live in `src/client/public/` and are copied into `src/client/dist/` automatically by Vite at build time. No separate deployment step is needed for these files.
- The build produces separate `vendor-react` and `vendor-query` chunks (configured in `src/client/vite.config.ts`) to improve browser caching of third-party libraries between deploys.
- Google Analytics (GA4, G-46RCPEQRE5) loads from `CookieConsentBanner.tsx` after cookie consent, on kovarti.com only (staging sends nothing). No server-side configuration is required.

### 4. Restart the Application

```bash
ssh -i "~/.ssh/ssh-key-2026-07-08 (1).key" ubuntu@147.5.127.99 "sudo systemctl restart pm-app"
```

### 5. Verify

```bash
ssh -i "~/.ssh/ssh-key-2026-07-08 (1).key" ubuntu@147.5.127.99 "sudo systemctl is-active pm-app"
```

### Quick Deploy (All Steps)

```bash
npm run build && \
scp -i "~/.ssh/ssh-key-2026-07-08 (1).key" -r dist/server ubuntu@147.5.127.99:/opt/pm-app/dist/ && \
tar czf /tmp/client-dist.tar.gz -C src/client/dist . && \
scp -i "~/.ssh/ssh-key-2026-07-08 (1).key" /tmp/client-dist.tar.gz ubuntu@147.5.127.99:/tmp/ && \
ssh -i "~/.ssh/ssh-key-2026-07-08 (1).key" ubuntu@147.5.127.99 \
  "rm -rf /opt/pm-app/client-dist/assets && tar xzf /tmp/client-dist.tar.gz -C /opt/pm-app/client-dist && sudo systemctl restart pm-app"
```

Or use the deploy script: `bash deploy.sh <staging|prod>` (preferred).

**Never from an older copy (Oct 2026).** `deploy.sh` fetches `origin/master` first and refuses to deploy a copy that is missing any of its commits ("This copy is missing N saved change(s)…", listing them) — deploying it would take those changes off the server. Prod also refuses unpushed commits, so prod only ever runs what is saved on `origin/master`, and refuses when origin can't be reached (staging warns and carries on). To release while another session has unsaved work in the shared folder, use a clean worktree: `git worktree add ../pm-release origin/master`, `npm ci` in the root and `src/client`, run `deploy.sh` there, then `git worktree remove ../pm-release`. (On 2026-10-02 one session deployed prod from an older copy and removed the Team Planner released 20 minutes earlier.)

**One deploy at a time (Oct 2026).** `deploy.sh` takes a lock in the project folder (`.deploy.lock/`, ignored by git) and one on the server (`/tmp/pm-deploy.lock`). A second deploy — another session on this machine, or anyone else deploying to the same server — prints "waiting for another deploy to finish: <who, when>" and waits up to 30 minutes, then gives up without deploying. A lock older than 45 minutes is treated as left by a deploy that died and is taken over. Locks are released when a deploy finishes, fails or is stopped. An unreachable server is reported as such, not as "locked". (Two sessions deploying staging at once on 2026-10-02 left the app running on half-replaced files.)

**Log retention (Sep 2026):** every deploy installs `deploy/journald/pm-retention.conf` (90 days, 2 GB) into `/etc/systemd/journald.conf.d/` and fails if the policy isn't in effect.

**The deploy script only ships saved work (Sep 2026).** It builds from the working files, so it refuses to start if anything that ships (`src/`, `mcp-server/src`, `package*.json`, `deploy/`) has uncommitted changes, and checks again just before uploading that nothing changed while it was building. Staging only: `--allow-dirty` deploys unsaved changes anyway. Why: a prod deploy running in the background once picked up a half-written migration that was being created at the same moment.

## Server packages

- **Fonts (`fonts-dejavu-core`, `fontconfig`)** — the server draws the status report's Schedule Timeline as a picture for email and Word (`sharp`, `utils/reportTimelineImage.ts`). Without a font installed the picture's text comes out as empty boxes. `deploy.sh` installs them if missing (step 5, "Checking server fonts"). Installed on staging 2026-10-07; production gets them with its next full deploy.

## Database

- **Engine:** MariaDB 10.11
- **Database:** `pmassist`
- **User:** `pmuser`
- **Access:** `sudo mariadb pmassist` (on server)

### Migrations

Migrations run automatically at server startup. The migration runner checks the `_migrations` table and applies any new `.sql` files from `dist/server/database/migrations/`.

To run manually:

```bash
ssh -i "~/.ssh/ssh-key-2026-07-08 (1).key" ubuntu@147.5.127.99
sudo mariadb pmassist < /opt/pm-app/dist/server/database/migrations/NNN_name.sql
```

### Backups

> This section described a `/opt/pm-app/backup.sh` cron that did not exist on
> either server. Until 2026-09-21 the only backups taken were manual ones before
> a migration. What follows is what actually runs.

- **Schedule:** nightly 02:30 UTC — `pm-backup.timer` (systemd, `Persistent=true`
  so a missed night is caught up rather than skipped)
- **Script:** `/usr/local/bin/pm-backup.sh`, from `deploy/backup/pm-backup.sh`;
  installed and enabled by `deploy.sh` on every deploy
- **Covers:** every `pmassist*` database — control plane plus one per customer
- **Format:** gzipped SQL dump per database, plus a `MANIFEST.txt` recording the
  host, timestamp and table count per database
- **Local:** `/var/backups/pm-app/<YYYY-MM-DD>/`, kept 7 days
- **Off-machine:** rsync'd to the *other* server (prod → staging, staging → prod)
  at `/var/backups/pm-<env>/<YYYY-MM-DD>/`, kept 30 days. The database runs on the
  same machine as the app, so a local-only copy protects against very little.
- **Verified, not assumed:** each dump is tested for gzip integrity *and* for the
  `Dump completed` marker (a truncated dump can still be valid gzip). The remote is
  then asked how many files actually arrived. Any shortfall fails the unit.
- **Pruning happens last**, so a failure never costs you yesterday's good backup.
- **Monitored:** a clean run writes `cron:last:db-backup` to Redis;
  `AlertService.checkCronJobsRunning()` alerts if it goes quiet for 30 hours.

**Set up the off-machine destination** (one time per server):
```bash
bash scripts/setup-offsite-backup.sh prod      # or: staging
```
Creates a dedicated ed25519 key on the source (private half never leaves it),
authorises it on the destination restricted by source address with no pty or
forwarding, writes `/etc/pm-backup.env`, and test-writes before claiming success.
`deploy.sh` warns on every deploy if a server has no destination configured.

**Run one now, and prove it restores:**
```bash
ssh ubuntu@<host> 'sudo systemctl start pm-backup.service'    # take one
ssh ubuntu@<host> 'sudo /usr/local/bin/pm-backup.sh --verify' # restore into a scratch DB
```
`--verify` restores the control plane into a throwaway database and counts its
tables and users. Nobody had ever proven a restore worked until 2026-09-18, and
then only by hand.

**Restoring for real:**
```bash
zcat /var/backups/pm-app/<date>/pmassist.sql.gz | sudo mariadb pmassist
# or, from the off-machine copy held on the other server:
ssh ubuntu@<other> 'cat /var/backups/pm-prod/<date>/pmassist.sql.gz' | zcat | sudo mariadb pmassist
```

**Not yet covered:** both copies live within the same hosting account. A copy to
object storage (e.g. Backblaze B2) would survive losing the account itself.

## MCP Server

- **Service:** `pm-mcp` (systemd)
- **Port:** 3100
- **Directory:** `/opt/pm-app/mcp-server/`
- **Env file:** `/opt/pm-app/.env.mcp`
- **Deploy:** `bash deploy.sh --mcp`
- **Logs:** `sudo journalctl -u pm-mcp -f`

## Useful Commands

```bash
# SSH shorthand
SSH="ssh -i \"~/.ssh/ssh-key-2026-07-08 (1).key\" ubuntu@147.5.127.99"

# App management
sudo systemctl restart pm-app
sudo systemctl status pm-app
sudo journalctl -u pm-app -f         # Follow logs live
sudo journalctl -u pm-app -n 50      # Last 50 lines

# Database
sudo mariadb pmassist

# Redis
redis-cli ping                        # Should return PONG
redis-cli info keyspace

# Nginx
sudo vi /etc/nginx/sites-available/pm-app
sudo nginx -t && sudo systemctl reload nginx

# SSL
sudo certbot renew                    # Auto-renews via cron

# Backups
/opt/pm-app/backup.sh                 # Manual backup
ls -la /opt/pm-app/backups/           # List backups

# Firewall
sudo iptables -L INPUT -n --line-numbers
```

## Troubleshooting

1. **App not starting** — Check logs: `sudo journalctl -u pm-app -n 100`. Common causes: missing `.env` vars, migration failure, port conflict.

2. **Static files not updating** — Ensure client-dist was extracted to `/opt/pm-app/client-dist/`. Clear browser cache.

3. **Database connection errors** — Verify `.env` credentials. Test: `sudo mariadb pmassist -e "SELECT 1"`.

4. **CORS errors** — Check `CORS_ORIGIN` in `.env` matches the domain. Nginx handles CORS for `/mcp`.

5. **SSL certificate expired** — Run `sudo certbot renew`. Check auto-renewal: `sudo systemctl status certbot.timer`.

## DNS

- **Domain:** pm.kpbc.ca
- **A Record:** 147.5.127.99
- **Managed in:** TMD Hosting cPanel → Zone Editor

## Deployment Checklist

- [ ] `npm run build` completes without errors
- [ ] `npx tsc --noEmit` passes type checking
- [ ] Server files uploaded to `/opt/pm-app/dist/server/`
- [ ] Client files extracted to `/opt/pm-app/client-dist/`
- [ ] Application restarted: `sudo systemctl restart pm-app`
- [ ] Service is active: `sudo systemctl is-active pm-app`
- [ ] Site loads at https://pm.kpbc.ca
- [ ] Health check passes: `curl https://pm.kpbc.ca/health`
- [ ] **First deploy with working calendars only (T060):** move tasks already on weekends/holidays — dry run first, then for real:
  `cd /opt/pm-app && sudo -u $(stat -c %U /opt/pm-app) env $(sudo cat .env | grep -v '^#' | xargs) node dist/server/scripts/moveTasksOffDaysOff.js --dry-run` (then without `--dry-run`). Re-running finds nothing to move.

## Open tabs and new deploys

Every client build gets an id (`vite.config.ts` → `__APP_BUILD__`) and ships `/version.json` (`{"build": "<id>"}`) at the site root, uploaded with the rest of the client. Open tabs fetch it every minute and on tab focus (`src/client/src/utils/appUpdate.ts`); on a mismatch they reload quietly (no banner since 2026-10-01) on the next in-app navigation (`components/AppUpdater.tsx`), or after the tab has been hidden 3 minutes with no dialog open, no field focused and no unsent text (`safeToReloadQuietly`) — at most once per build. This replaced relying on the service worker's auto-update, which did not reload open tabs. Nginx already sends `no-store` for the entry files; `version.json` is fetched with `cache: 'no-store'` and a cache-busting query.
