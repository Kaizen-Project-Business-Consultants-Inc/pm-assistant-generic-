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
| `AI_TIER_BUDGET_FREE` | `25000` | Monthly AI token budget for free tier |
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
- Google Analytics (GA4, measurement ID G-F99Q92ED7M) is embedded in `index.html`. No server-side configuration is required.

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

Or use the deploy script: `bash deploy.sh`

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

- **Schedule:** Daily at 3am UTC (cron)
- **Location:** `/opt/pm-app/backups/`
- **Retention:** 14 days
- **Format:** gzipped SQL dump (`pmassist_YYYYMMDD_HHMMSS.sql.gz`)
- **Script:** `/opt/pm-app/backup.sh`
- **Log:** `/opt/pm-app/backups/backup.log`

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
