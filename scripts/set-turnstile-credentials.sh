#!/usr/bin/env bash
# Switch the registration CAPTCHA on for an environment.
#
# Usage:
#   bash scripts/set-turnstile-credentials.sh <staging|prod> <site-key> <secret-key>
#
# Get the pair from https://dash.cloudflare.com → Turnstile → Add widget.
# Free, unlimited, and it does NOT require moving your DNS to Cloudflare.
#
# Adds (or replaces) TURNSTILE_SITE_KEY and TURNSTILE_SECRET_KEY in
# /opt/pm-app/.env and restarts the app. No credentials are stored in this repo,
# and the secret never has to be pasted into a chat or a commit.
#
# Both halves read the same configuration, so this one command turns the
# challenge on: the widget appears on the form and the server starts checking.
# Running it with empty values turns it back off.
set -euo pipefail

ENVNAME="${1:-}"
SITE_KEY="${2:-}"
SECRET_KEY="${3:-}"
SSH_KEY="$HOME/.ssh/ssh-key-2026-07-08 (1).key"

if [ -z "$ENVNAME" ] || [ -z "$SITE_KEY" ] || [ -z "$SECRET_KEY" ]; then
  echo "Usage: bash scripts/set-turnstile-credentials.sh <staging|prod> <site-key> <secret-key>"
  echo
  echo "Get the pair at https://dash.cloudflare.com → Turnstile → Add widget."
  echo "The site key starts 0x4... and is public; the secret key starts 0x4... and is not."
  exit 1
fi

case "$ENVNAME" in
  staging) HOST="ubuntu@147.5.127.99";  URL="https://pm.kpbc.ca" ;;
  prod)    HOST="ubuntu@147.5.127.251"; URL="https://kovarti.com" ;;
  *) echo "First argument must be 'staging' or 'prod'"; exit 1 ;;
esac

echo "→ Switching on the registration CAPTCHA for $ENVNAME ($URL)"

ssh -o ConnectTimeout=25 -i "$SSH_KEY" "$HOST" \
  "sudo sed -i '/^TURNSTILE_SITE_KEY=/d;/^TURNSTILE_SECRET_KEY=/d' /opt/pm-app/.env && \
   printf 'TURNSTILE_SITE_KEY=%s\nTURNSTILE_SECRET_KEY=%s\n' '$SITE_KEY' '$SECRET_KEY' | sudo tee -a /opt/pm-app/.env >/dev/null && \
   sudo systemctl restart pm-app && sleep 5 && \
   echo \"  service: \$(systemctl is-active pm-app)\""

echo -n "  site key now served: "
curl -s "$URL/api/v1/auth/turnstile" || true
echo
echo "✓ Done. Add these hostnames to the widget in Cloudflare, or it will refuse:"
echo "    kovarti.com, www.kovarti.com, pm.kpbc.ca"
echo "  Then sign up at $URL/register and confirm you can still get through."
