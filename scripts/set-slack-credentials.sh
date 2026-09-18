#!/usr/bin/env bash
# Set Slack OAuth credentials on a deployed environment and restart the app.
#
# Usage:
#   bash scripts/set-slack-credentials.sh <staging|prod> <client-id> <client-secret>
#
# Adds (or replaces) SLACK_CLIENT_ID and SLACK_CLIENT_SECRET in /opt/pm-app/.env
# and restarts pm-app. No credentials are stored in this repo.
set -euo pipefail

ENVNAME="${1:-}"
CLIENT_ID="${2:-}"
CLIENT_SECRET="${3:-}"
SSH_KEY="$HOME/.ssh/ssh-key-2026-07-08 (1).key"

if [ -z "$ENVNAME" ] || [ -z "$CLIENT_ID" ] || [ -z "$CLIENT_SECRET" ]; then
  echo "Usage: bash scripts/set-slack-credentials.sh <staging|prod> <client-id> <client-secret>"
  exit 1
fi

case "$ENVNAME" in
  staging) HOST="ubuntu@147.5.127.99";  URL="https://pm.kpbc.ca" ;;
  prod)    HOST="ubuntu@147.5.127.251"; URL="https://kovarti.com" ;;
  *) echo "First argument must be 'staging' or 'prod'"; exit 1 ;;
esac

echo "→ Setting Slack credentials on $ENVNAME ($URL)"

ssh -o ConnectTimeout=25 -i "$SSH_KEY" "$HOST" \
  "sudo sed -i '/^SLACK_CLIENT_ID=/d;/^SLACK_CLIENT_SECRET=/d' /opt/pm-app/.env && \
   printf 'SLACK_CLIENT_ID=%s\nSLACK_CLIENT_SECRET=%s\n' '$CLIENT_ID' '$CLIENT_SECRET' | sudo tee -a /opt/pm-app/.env >/dev/null && \
   sudo systemctl restart pm-app && sleep 3 && \
   echo \"  service: \$(systemctl is-active pm-app)\" && \
   echo -n '  keys now set: ' && sudo grep -o '^SLACK_[A-Z_]*' /opt/pm-app/.env | tr '\n' ' ' && echo"

echo "✓ Done. Redirect URL for this environment: $URL/api/v1/slack/callback"
