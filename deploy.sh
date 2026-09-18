#!/usr/bin/env bash
# Deploy PM Assistant to Oracle Cloud
# Usage:
#   bash deploy.sh staging                # full deploy to pm.kpbc.ca
#   bash deploy.sh prod                   # full deploy to kovarti.com
#   bash deploy.sh prod --client-only     # client only to prod
#   bash deploy.sh staging --server-only  # server only to staging
#   bash deploy.sh staging --mcp          # MCP server to staging
#   bash deploy.sh prod --skip-tests      # skip tests
#   bash deploy.sh prod --prelaunch       # build with countdown landing page
set -euo pipefail

SSH_KEY="$HOME/.ssh/ssh-key-2026-07-08 (1).key"

# ── Environment selection ──
ENV="${1:-}"
shift || true

case "$ENV" in
  staging)
    SSH_HOST="ubuntu@147.5.127.99"
    DOMAIN="pm.kpbc.ca"
    ;;
  prod)
    SSH_HOST="ubuntu@147.5.127.251"
    DOMAIN="kovarti.com"
    ;;
  *)
    echo "Usage: bash deploy.sh <staging|prod> [--skip-tests] [--server-only] [--client-only] [--mcp]"
    exit 1
    ;;
esac

do_ssh()  { ssh  -i "$SSH_KEY" "$SSH_HOST" "$@"; }
do_scp()  { scp  -i "$SSH_KEY" "$@"; }

SKIP_TESTS=false
SERVER_ONLY=false
CLIENT_ONLY=false
MCP_ONLY=false
PRELAUNCH=false

for arg in "$@"; do
  case $arg in
    --skip-tests)  SKIP_TESTS=true ;;
    --server-only) SERVER_ONLY=true ;;
    --client-only) CLIENT_ONLY=true ;;
    --mcp)         MCP_ONLY=true ;;
    --prelaunch)   PRELAUNCH=true ;;
    *) echo "Unknown option: $arg"; exit 1 ;;
  esac
done

echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo "  Deploying to $ENV ($DOMAIN)"
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo ""

# --- MCP-only deploy shortcut ---
if [ "$MCP_ONLY" = true ]; then
  echo "[MCP] Building MCP server..."
  cd mcp-server && npm run build && cd ..
  echo "  OK"

  echo "[MCP] Uploading MCP server..."
  tar czf /tmp/mcp-server-dist.tar.gz -C mcp-server dist/ package.json package-lock.json
  do_scp /tmp/mcp-server-dist.tar.gz "$SSH_HOST":/tmp/
  do_ssh "sudo rm -rf /opt/pm-app/mcp-server/dist && sudo tar xzf /tmp/mcp-server-dist.tar.gz -C /opt/pm-app/mcp-server/ && sudo chown -R www-data:www-data /opt/pm-app/mcp-server/dist && cd /opt/pm-app/mcp-server && sudo npm install --omit=dev"
  rm -f /tmp/mcp-server-dist.tar.gz
  echo "  OK"

  echo "[MCP] Restarting MCP service..."
  do_ssh "sudo systemctl restart pm-mcp"
  sleep 3

  MCP_STATUS=$(do_ssh "sudo systemctl is-active pm-mcp")
  if [ "$MCP_STATUS" = "active" ]; then
    echo "  ✓ MCP Service: RUNNING"
  else
    echo "  ✗ MCP Service: $MCP_STATUS"
    do_ssh "sudo journalctl -u pm-mcp --no-pager -n 20"
    exit 1
  fi

  echo ""
  echo "━━━ MCP Deploy complete ━━━"
  exit 0
fi

# --- Step 1: Type check ---
echo "[1/7] Type checking..."
npx tsc --noEmit
echo "  ✓ OK"

# --- Step 2: Tests ---
if [ "$SKIP_TESTS" = true ]; then
  echo "[2/7] Tests skipped (--skip-tests)"
else
  echo "[2/7] Running tests..."
  npx vitest run --reporter=dot
  echo "  ✓ OK"
fi

# --- Step 3: Build ---
# Prelaunch mode shows countdown landing page instead of login/register
# Pass --prelaunch flag to enable, or omit to build the live app
if [ "$PRELAUNCH" = true ]; then
  echo "  ⚠ Prelaunch mode ON (countdown page)"
  export VITE_PRELAUNCH=true
fi

if [ "$CLIENT_ONLY" = true ]; then
  echo "[3/7] Building client only..."
  npm run build:client
elif [ "$SERVER_ONLY" = true ]; then
  echo "[3/7] Building server only..."
  npm run build:server
else
  echo "[3/7] Building server + client..."
  npm run build
fi
echo "  ✓ OK"

# --- Step 4: Copy non-tsc files into dist (SQL migrations, tenant migrations) ---
echo "[4/7] Copying migration SQL files to dist..."
# mkdir -p is essential: tsc creates no migrations directory (there are no .ts files in
# it), so without this the copy below silently failed and the uploaded build contained
# NO control-plane migrations at all. Combined with the symlink in step 5, that is how
# production quietly stopped applying migrations after 109.
mkdir -p dist/server/database/migrations
cp src/server/database/migrations/*.sql dist/server/database/migrations/
mkdir -p dist/server/database/tenant-migrations
cp src/server/database/tenant-migrations/*.sql dist/server/database/tenant-migrations/
LOCAL_MIG_COUNT=$(ls dist/server/database/migrations/*.sql 2>/dev/null | wc -l)
LOCAL_TENANT_COUNT=$(ls dist/server/database/tenant-migrations/*.sql 2>/dev/null | wc -l)
if [ "$LOCAL_MIG_COUNT" -eq 0 ] || [ "$LOCAL_TENANT_COUNT" -eq 0 ]; then
  echo "  ✗ No migration files were staged into dist — aborting."
  exit 1
fi
echo "  ✓ OK ($LOCAL_MIG_COUNT control-plane, $LOCAL_TENANT_COUNT tenant)"

# --- Step 5: Upload server ---
if [ "$CLIENT_ONLY" = false ]; then
  echo "[5/7] Uploading server dist..."
  tar czf /tmp/server-dist.tar.gz -C dist/server .
  do_scp /tmp/server-dist.tar.gz "$SSH_HOST":/tmp/
  # /opt/pm-app/migrations is the canonical migrations folder on the server, and
  # dist/server/database/migrations is a symlink to it so the app reads one place.
  #
  # The freshly built migrations MUST be copied into that canonical folder BEFORE the
  # symlink is made. Previously the symlink was created straight over the extracted
  # directory, which silently discarded every newly uploaded migration. It did not fail
  # loudly: on staging `ln -sf` landed the link *inside* the existing directory (so the
  # real files were still read and migrations appeared to work), while on production it
  # replaced the directory outright — so production quietly stopped applying
  # control-plane migrations after 109 and nobody noticed for six releases.
  do_ssh "sudo rm -rf /opt/pm-app/dist/server \
    && sudo mkdir -p /opt/pm-app/dist/server /opt/pm-app/migrations \
    && sudo tar xzf /tmp/server-dist.tar.gz -C /opt/pm-app/dist/server/ \
    && sudo find /opt/pm-app/dist/server/database/migrations -maxdepth 1 -name '*.sql' -exec cp -f {} /opt/pm-app/migrations/ ';' \
    && sudo rm -rf /opt/pm-app/dist/server/database/migrations \
    && sudo ln -s /opt/pm-app/migrations /opt/pm-app/dist/server/database/migrations \
    && sudo chown -R ubuntu:ubuntu /opt/pm-app/dist /opt/pm-app/migrations \
    && rm /tmp/server-dist.tar.gz"

  # The copy above uses find rather than a shell glob on purpose: a glob makes the
  # whole deploy die on an odd or empty expansion, which is the wrong failure. The
  # check below is the strict part — tolerant action, strict verification. Fail the
  # deploy loudly if a migration built locally did not reach the server, rather than
  # letting it go missing for another six releases.
  echo "  Verifying migrations reached the server..."
  LOCAL_LATEST=$(ls src/server/database/migrations/*.sql 2>/dev/null | xargs -n1 basename | sort | tail -1)
  if [ -n "$LOCAL_LATEST" ]; then
    if do_ssh "test -f /opt/pm-app/migrations/$LOCAL_LATEST"; then
      echo "  ✓ Migrations present (latest: $LOCAL_LATEST)"
    else
      echo "  ✗ MIGRATION MISSING ON SERVER: $LOCAL_LATEST"
      echo "    The app will start without it. Investigate before trusting this deploy."
      exit 1
    fi
  fi
  rm -f /tmp/server-dist.tar.gz

  # Upload doc files for Knowledge Base reindexing
  echo "  Uploading doc files..."
  do_scp PRODUCT_MANUAL.md WORLD_CLASS_FEATURES.md "$SSH_HOST":/opt/pm-app/
  do_ssh "mkdir -p /opt/pm-app/docs"
  do_scp docs/USER_GUIDE.md docs/ADMIN_MANUAL.md docs/AI_DESIGN_FEATURES.md "$SSH_HOST":/opt/pm-app/docs/

  # Install the scheduled-job definitions. These used to be set up by hand, once per
  # machine, and recorded nowhere — which is why production ran NO scheduled jobs at
  # all from mid-July until 2026-09-18. They are now in deploy/systemd/ and installed
  # on every deploy, so a server cannot silently be missing one.
  echo "  Installing scheduled jobs..."
  do_ssh "mkdir -p /tmp/pm-systemd"
  do_scp deploy/systemd/pm-cron@.service deploy/systemd/*.timer "$SSH_HOST":/tmp/pm-systemd/
  EXPECTED_TIMERS=$(ls deploy/systemd/*.timer | xargs -n1 basename | sed 's/pm-cron@//;s/\.timer//' | tr '\n' ' ')
  do_ssh "sudo cp /tmp/pm-systemd/pm-cron@.service /tmp/pm-systemd/*.timer /etc/systemd/system/ \
    && rm -rf /tmp/pm-systemd \
    && sudo systemctl daemon-reload \
    && for j in $EXPECTED_TIMERS; do sudo systemctl enable --now pm-cron@\$j.timer >/dev/null 2>&1; done"

  # Verify every expected job is actually scheduled. The original failure was not that
  # a step was skipped — it is that skipping it produced no error anywhere.
  MISSING=$(do_ssh "for j in $EXPECTED_TIMERS; do systemctl is-enabled pm-cron@\$j.timer >/dev/null 2>&1 || echo \$j; done")
  if [ -n "$MISSING" ]; then
    echo "  ✗ SCHEDULED JOBS NOT ENABLED:" $MISSING
    echo "    These will never run on this server. Investigate before trusting this deploy."
    exit 1
  fi
  echo "  ✓ OK ($(echo $EXPECTED_TIMERS | wc -w) jobs scheduled)"

  # Sync dependencies — upload package files and install production deps
  echo "  Syncing dependencies..."
  do_scp package.json "$SSH_HOST":/tmp/pkg.json
  do_scp package-lock.json "$SSH_HOST":/tmp/pkg-lock.json
  do_ssh "sudo cp /tmp/pkg.json /opt/pm-app/package.json && sudo cp /tmp/pkg-lock.json /opt/pm-app/package-lock.json && sudo chown ubuntu:ubuntu /opt/pm-app/package.json /opt/pm-app/package-lock.json && cd /opt/pm-app && npm install --omit=dev --no-audit --no-fund 2>&1 | tail -1 && rm -f /tmp/pkg.json /tmp/pkg-lock.json"
  echo "  ✓ OK"
else
  echo "[5/7] Server upload skipped (--client-only)"
fi

# --- Step 6: Upload client ---
if [ "$SERVER_ONLY" = false ]; then
  echo "[6/7] Uploading client dist..."
  tar czf /tmp/client-dist.tar.gz -C src/client/dist .
  do_scp /tmp/client-dist.tar.gz "$SSH_HOST":/tmp/
  do_ssh "sudo rm -rf /opt/pm-app/client-dist/assets && sudo tar xzf /tmp/client-dist.tar.gz -C /opt/pm-app/client-dist && sudo chown -R www-data:www-data /opt/pm-app/client-dist/ && rm /tmp/client-dist.tar.gz"
  rm -f /tmp/client-dist.tar.gz
  echo "  ✓ OK"
else
  echo "[6/7] Client upload skipped (--server-only)"
fi

# --- Step 7: Restart & verify ---
echo "[7/7] Restarting app..."
do_ssh "sudo systemctl restart pm-app"
sleep 5

echo ""
echo "━━━ Verifying ━━━"
STATUS=$(do_ssh "sudo systemctl is-active pm-app")
if [ "$STATUS" = "active" ]; then
  echo "  ✓ Service: RUNNING"
else
  echo "  ✗ Service: $STATUS"
  do_ssh "sudo journalctl -u pm-app --no-pager -n 20"
  exit 1
fi

# Wait for the app to actually serve. It runs migrations on boot, so it is normal for
# this to take 30-60s; a curl straight after restart gives 502. Poll rather than sleep.
HEALTH=""
for _ in $(seq 1 30); do
  HEALTH=$(curl -sf --max-time 5 "https://$DOMAIN/api/v1/health" 2>/dev/null) || HEALTH=""
  [ -n "$HEALTH" ] && break
  sleep 5
done

if [ -z "$HEALTH" ]; then
  echo "  ✗ Health: no response from https://$DOMAIN after 150s"
  do_ssh "sudo journalctl -u pm-app --no-pager -n 30"
  exit 1
fi

case "$HEALTH" in
  *'"status":"degraded"'*)
    echo "  ⚠ Health: DEGRADED — $HEALTH"
    echo "    The app is serving but something is wrong. Do not treat this deploy as clean."
    ;;
  *) echo "  ✓ Health: $HEALTH" ;;
esac

# Confirm the build that is now running is the one just built. Comparing a known marker
# is the only way to tell "deployed" from "the script reached the end": a deploy whose
# build step failed can still restart the old code and look successful.
if [ "$CLIENT_ONLY" = false ]; then
  echo "  Verifying the running build is the one just uploaded..."
  LOCAL_MARK=$(node -e "process.stdout.write(require('crypto').createHash('sha1').update(require('fs').readFileSync('dist/server/index.js')).digest('hex').slice(0,12))" 2>/dev/null || echo "")
  REMOTE_MARK=$(do_ssh "sha1sum /opt/pm-app/dist/server/index.js 2>/dev/null | cut -c1-12" || echo "")
  if [ -n "$LOCAL_MARK" ] && [ "$LOCAL_MARK" != "$REMOTE_MARK" ]; then
    echo "  ✗ RUNNING BUILD DOES NOT MATCH THE ONE JUST BUILT"
    echo "    local=$LOCAL_MARK server=$REMOTE_MARK — the upload did not take effect."
    exit 1
  fi
  echo "  ✓ Running build matches ($LOCAL_MARK)"
fi

echo ""
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo "  ✓ Deploy to $ENV complete!"
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
