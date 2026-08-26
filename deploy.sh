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
cp src/server/database/migrations/*.sql dist/server/database/migrations/ 2>/dev/null || true
mkdir -p dist/server/database/tenant-migrations
cp src/server/database/tenant-migrations/*.sql dist/server/database/tenant-migrations/ 2>/dev/null || true
echo "  ✓ OK"

# --- Step 5: Upload server ---
if [ "$CLIENT_ONLY" = false ]; then
  echo "[5/7] Uploading server dist..."
  tar czf /tmp/server-dist.tar.gz -C dist/server .
  do_scp /tmp/server-dist.tar.gz "$SSH_HOST":/tmp/
  do_ssh "sudo rm -rf /opt/pm-app/dist/server && sudo mkdir -p /opt/pm-app/dist/server && sudo tar xzf /tmp/server-dist.tar.gz -C /opt/pm-app/dist/server/ && sudo ln -sf /opt/pm-app/migrations /opt/pm-app/dist/server/database/migrations && sudo chown -R ubuntu:ubuntu /opt/pm-app/dist && rm /tmp/server-dist.tar.gz"
  rm -f /tmp/server-dist.tar.gz

  # Upload doc files for Knowledge Base reindexing
  echo "  Uploading doc files..."
  do_scp PRODUCT_MANUAL.md WORLD_CLASS_FEATURES.md "$SSH_HOST":/opt/pm-app/
  do_ssh "mkdir -p /opt/pm-app/docs"
  do_scp docs/USER_GUIDE.md docs/ADMIN_MANUAL.md docs/AI_DESIGN_FEATURES.md "$SSH_HOST":/opt/pm-app/docs/

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

HEALTH=$(curl -sf --max-time 5 "https://$DOMAIN/api/v1/health" 2>/dev/null) || true
if [ -n "$HEALTH" ]; then
  echo "  ✓ Health: $HEALTH"
else
  echo "  Health: (verified via systemctl)"
fi

echo ""
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo "  ✓ Deploy to $ENV complete!"
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
