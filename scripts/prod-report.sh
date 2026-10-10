#!/usr/bin/env bash
# Read-only reports from the app servers. Nothing here changes data, restarts
# anything or prints a secret (the server's .env is only loaded so the database
# and Resend calls can log in).
#
#   bash scripts/prod-report.sh users    <prod|staging>   who has an account
#   bash scripts/prod-report.sh signups  <prod|staging>   where each sign-up stopped (email confirmed, plan, payment)
#   bash scripts/prod-report.sh activity <prod|staging>   projects / schedules / tasks each company has
#   bash scripts/prod-report.sh funnel   <prod|staging>   home, pricing and sign-up page visitors vs sign-ups sent
#   bash scripts/prod-report.sh emails   <prod|staging> [words]   emails Resend sent, with delivery status
#   bash scripts/prod-report.sh errors   <prod|staging>   app errors in the last 24 hours
#   bash scripts/prod-report.sh logs     <prod|staging> <words> [since]   app log lines containing <words>
set -euo pipefail

REPORT="${1:-}"
case "${2:-}" in
  prod) HOST=147.5.127.251 ;;
  staging) HOST=147.5.127.99 ;;
  *) echo "say which server: prod or staging" >&2; exit 1 ;;
esac

LOAD_ENV='cd /opt/pm-app && set -a && . ./.env >/dev/null 2>&1; set +a'
# MYSQL_PWD keeps the password off the server's process list
DB='MYSQL_PWD="$DB_PASSWORD" mariadb -h"$DB_HOST" -u"$DB_USER" "${DB_NAME:-pmassist}"'

case "$REPORT" in
  users)
    SQL="SELECT u.full_name, u.email, u.role, DATE(u.created_at) joined, DATE(u.last_login_at) last_login, o.name company
         FROM users u LEFT JOIN organizations o ON o.id = u.organization_id ORDER BY u.created_at"
    REMOTE="$LOAD_ENV; $DB -e \"$SQL\"" ;;
  signups)
    SQL="SELECT u.full_name, DATE(u.created_at) joined, u.email_verified, u.subscription_tier tier, u.pending_tier,
                u.subscription_status status, o.subscription_status company_status, o.is_provisioned, DATE(u.last_login_at) last_login
         FROM users u LEFT JOIN organizations o ON o.id = u.organization_id ORDER BY u.created_at"
    REMOTE="$LOAD_ENV; $DB -e \"$SQL\"" ;;
  emails)
    # Optional 3rd argument: only lines containing these words (e.g. "Verify"); pages back up to 2,000 emails
    WORDS="${3:-}"
    [[ -z "$WORDS" || "$WORDS" =~ ^[A-Za-z0-9\ ._@-]+$ ]] || { echo "emails filter needs plain words" >&2; exit 1; }
    REMOTE="$LOAD_ENV; RESEND_FILTER='$WORDS' node -e '
      (async () => {
        const want = (process.env.RESEND_FILTER || \"\").toLowerCase();
        let after = \"\", shown = 0;
        for (let page = 0; page < 20; page++) {
          const r = await fetch(\"https://api.resend.com/emails?limit=100\" + (after ? \"&after=\" + after : \"\"),
            { headers: { Authorization: \"Bearer \" + process.env.RESEND_API_KEY } });
          const j = await r.json();
          if (!j.data) { console.log(\"Resend said:\", j.message || j.name || \"no data\"); return; }
          for (const e of j.data) {
            const line = [e.created_at.slice(0, 16), (e.last_event || \"?\").padEnd(16), (e.to || []).join(\",\"), \"|\", e.subject].join(\" \");
            if (!want || line.toLowerCase().includes(want)) { console.log(line); shown++; }
          }
          if (!j.has_more || !j.data.length) break;
          after = j.data[j.data.length - 1].id;
          if (!want && shown >= 100) break;
        }
      })()'" ;;
  activity)
    # What each company has built: projects, schedules, tasks in its own database
    REMOTE="$LOAD_ENV; $DB -N -e \"SELECT o.name, o.db_name FROM organizations o WHERE o.is_provisioned = 1 ORDER BY o.created_at\" |
      while IFS=\$'\t' read -r name db; do
        counts=\$($DB -N -e \"SELECT (SELECT COUNT(*) FROM \\\`\$db\\\`.projects), (SELECT COUNT(*) FROM \\\`\$db\\\`.schedules), (SELECT COUNT(*) FROM \\\`\$db\\\`.tasks)\" 2>/dev/null | tr '\t' ' ')
        echo \"\$name | projects schedules tasks: \${counts:-n/a}\"
      done" ;;
  funnel)
    # Visits to the public pages vs sign-up attempts, from the web server's access logs (kept ~2 weeks)
    REMOTE="sudo sh -c 'zcat -f /var/log/nginx/access.log*' | awk '{print \$7, \$6, \$9, \$1}' | awk '
      \$1==\"/\" && \$2==\"\\\"GET\" {home[\$4]=1}
      \$1 ~ /^\\/(register|signup)/ && \$2==\"\\\"GET\" {reg[\$4]=1}
      \$1 ~ /^\\/pricing/ && \$2==\"\\\"GET\" {price[\$4]=1}
      \$1==\"/api/v1/auth/register\" && \$2==\"\\\"POST\" {post[\$4]=1}
      END {n=0; for (k in home) n++; print \"home page visitors:\", n; n=0; for (k in price) n++; print \"pricing page visitors:\", n;
           n=0; for (k in reg) n++; print \"sign-up page visitors:\", n; n=0; for (k in post) n++; print \"sign-up form sent:\", n}'; sudo ls -l --time-style=+%F /var/log/nginx/ | awk '/access/{print \$6, \$7}' | head -3" ;;
  errors)
    REMOTE="sudo journalctl -u pm-app --since '24 hours ago' --no-pager | grep -E '\"level\":\"error\"|\"level\":50' | cut -c1-400 | tail -100" ;;
  logs)
    WORDS="${3:-}"; SINCE="${4:-7 days ago}"
    # Only plain words reach the server's shell
    [[ "$WORDS" =~ ^[A-Za-z0-9\ ._/@:-]+$ ]] || { echo "logs needs plain words (letters, digits, space . _ / @ : -)" >&2; exit 1; }
    [[ "$SINCE" =~ ^[A-Za-z0-9\ :-]+$ ]] || { echo "since must look like '7 days ago' or 2026-09-01" >&2; exit 1; }
    REMOTE="sudo journalctl -u pm-app --since '$SINCE' --no-pager | grep -iF -- '$WORDS' | cut -c1-400 | tail -200" ;;
  *) sed -n '6,12p' "$0" >&2; exit 1 ;;
esac

ssh -i ~/.ssh/"ssh-key-2026-07-08 (1).key" -o ConnectTimeout=15 "ubuntu@$HOST" "$REMOTE" 2>&1 | { grep -v 'Deprecated program name' || true; }
# pipefail: an SSH failure (bad key, timeout) exits non-zero instead of looking like 'no results'
