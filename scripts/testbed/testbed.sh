#!/usr/bin/env bash
# Test bed — a private, disposable copy of the app on the STAGING server for automated tests.
#
#   bash scripts/testbed/testbed.sh <setup|sync|reset|up|down|status>
#
# - Same build as staging (sync copies /opt/pm-app's dist + client-dist).
# - Its own databases: control plane `pmtb`, companies `pmtb_t_*` (TENANT_DB_PREFIX), its own
#   Redis database (/5). Never touches staging's data; not included in backups.
# - Private: the API listens on 127.0.0.1:3101 and the site on 127.0.0.1:8081 only. Tests reach
#   it through an SSH tunnel:  ssh -L 8081:127.0.0.1:8081 ubuntu@147.5.127.99 -N
# - Runs only while tests run (up … down): the server has ~450 MB free, so it isn't left on.
# - No email (no Resend key), no AI, no scheduled jobs.
set -euo pipefail

HOST=ubuntu@147.5.127.99
KEY="$HOME/.ssh/ssh-key-2026-07-08 (1).key"
ssh_run() { ssh -i "$KEY" -o ConnectTimeout=15 "$HOST" "$@"; }

cmd="${1:-status}"
case "$cmd" in
  setup)
    ssh_run 'bash -s' <<'REMOTE'
set -euo pipefail
sudo mkdir -p /opt/pm-testbed && sudo chown ubuntu:ubuntu /opt/pm-testbed
# Settings: staging's, with the test bed's own databases, port, cache, and nothing that reaches
# the outside world
grep -vE '^(PORT|DB_NAME|TENANT_DB_PREFIX|REDIS_URL|APP_URL|CORS_ORIGIN|AI_ENABLED|EMBEDDING_ENABLED|RESEND_API_KEY|ALERT_ENABLED|SLACK_[A-Z_]*|TURNSTILE_[A-Z_]*)=' /opt/pm-app/.env > /opt/pm-testbed/.env
cat >> /opt/pm-testbed/.env <<'ENV'
PORT=3101
DB_NAME=pmtb
TENANT_DB_PREFIX=pmtb_t_
REDIS_URL=redis://localhost:6379/5
APP_URL=http://localhost:8081
CORS_ORIGIN=http://localhost:8081
AI_ENABLED=false
EMBEDDING_ENABLED=false
RESEND_API_KEY=
ALERT_ENABLED=false
ENV
chmod 600 /opt/pm-testbed/.env
# Service — not enabled at boot; started only for a test run
sudo tee /etc/systemd/system/pm-testbed.service >/dev/null <<'UNIT'
[Unit]
Description=PM Assistant TEST BED (private, for automated tests)
After=network.target mariadb.service

[Service]
Type=simple
User=ubuntu
WorkingDirectory=/opt/pm-testbed
ExecStart=/usr/bin/node dist/server/index.js
Restart=on-failure
RestartSec=5
Environment=NODE_ENV=production
EnvironmentFile=/opt/pm-testbed/.env
MemoryMax=350M
# Never left running: the staging server has ~1 GB of RAM, and a forgotten test bed pushed it
# into hours of swapping on 2026-09-30. systemd stops it after an hour, whatever happens.
RuntimeMaxSec=3600

[Install]
WantedBy=multi-user.target
UNIT
sudo systemctl daemon-reload
# Web: 127.0.0.1 only (a separate file in sites-enabled, like pm-app — not a symlink)
sudo tee /etc/nginx/sites-enabled/pm-testbed >/dev/null <<'NGINX'
server {
  listen 127.0.0.1:8081;
  server_name localhost;
  root /opt/pm-testbed/client-dist;
  index index.html;
  client_max_body_size 25m;
  location /api/ {
    proxy_pass http://127.0.0.1:3101;
    proxy_http_version 1.1;
    proxy_set_header Host $host;
    proxy_set_header X-Forwarded-For $remote_addr;
    proxy_set_header X-Forwarded-Proto http;
    proxy_set_header Upgrade $http_upgrade;
    proxy_set_header Connection "upgrade";
  }
  location / { try_files $uri $uri/ /index.html; }
}
NGINX
sudo nginx -t && sudo systemctl reload nginx
# Database rights for the test bed's own databases only
sudo mariadb -e "GRANT ALL PRIVILEGES ON \`pmtb%\`.* TO 'pmuser'@'localhost'; FLUSH PRIVILEGES;"
echo "[testbed] set up"
REMOTE
    ;;
  sync)
    ssh_run 'bash -s' <<'REMOTE'
set -euo pipefail
rsync -a --delete /opt/pm-app/dist/ /opt/pm-testbed/dist/
rsync -a --delete /opt/pm-app/client-dist/ /opt/pm-testbed/client-dist/
cp /opt/pm-app/package.json /opt/pm-testbed/package.json
ln -sfn /opt/pm-app/node_modules /opt/pm-testbed/node_modules
[ -d /opt/pm-app/migrations ] && rsync -a --delete /opt/pm-app/migrations/ /opt/pm-testbed/migrations/
echo "[testbed] build copied from staging: $(cat /opt/pm-testbed/client-dist/version.json 2>/dev/null)"
REMOTE
    ;;
  reset)
    ssh_run 'bash -s' <<'REMOTE'
set -euo pipefail
sudo systemctl stop pm-testbed || true
for db in $(sudo mariadb -N -e "SHOW DATABASES" | grep -E '^pmtb(_t_.*)?$' || true); do
  sudo mariadb -e "DROP DATABASE \`$db\`"
done
sudo mariadb -e "CREATE DATABASE pmtb CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci"
# The numbered migrations can't build an empty database (the base tables predate them), so
# copy staging's control-plane STRUCTURE — no customer data — plus the reference tables the
# migrations seeded (plans, features, agents, policies, templates, help articles).
sudo mariadb-dump --no-data --skip-triggers pmassist | sudo mariadb pmtb
sudo mariadb-dump --no-create-info --skip-triggers pmassist _migrations agents agent_autonomy_config \
  automation_marketplace knowledge_base_chunks policies pricing_config tier_features | sudo mariadb pmtb
redis-cli -n 5 FLUSHDB >/dev/null
echo "[testbed] databases wiped; structure + reference data copied from staging (no customer data)"
REMOTE
    ;;
  up)
    ssh_run 'bash -s' <<'REMOTE'
set -euo pipefail
sudo systemctl start pm-testbed
for i in $(seq 1 60); do
  if curl -s -o /dev/null -w '%{http_code}' http://127.0.0.1:8081/api/v1/health | grep -q 200; then echo "[testbed] up"; exit 0; fi
  sleep 2
done
echo "[testbed] did not come up — stopping it"; sudo journalctl -u pm-testbed -n 30 --no-pager; sudo systemctl stop pm-testbed; exit 1
REMOTE
    ;;
  down)
    ssh_run 'sudo systemctl stop pm-testbed; echo "[testbed] stopped"'
    ;;
  status)
    ssh_run 'systemctl is-active pm-testbed || true; sudo mariadb -N -e "SHOW DATABASES" | grep -E "^pmtb" || echo "(no test bed databases)"'
    ;;
  *) echo "usage: testbed.sh <setup|sync|reset|up|down|status>"; exit 2 ;;
esac
