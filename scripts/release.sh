#!/usr/bin/env bash
# One release, always from the latest origin/master in a clean copy (never the shared working
# folder, which holds other people's unsaved work — deploy.sh refuses a copy missing master's
# commits, 2026-10-02). For prod it also takes a backup first and runs the smoke test after.
#
#   bash scripts/release.sh staging [deploy.sh flags]
#   bash scripts/release.sh prod    [deploy.sh flags]      e.g. --mcp, --server-only
#
# Prod releases happen only when the user has said yes to that release (working agreement).
set -euo pipefail

TARGET="${1:-}"
case "$TARGET" in
  staging|prod) shift ;;
  *) echo "usage: bash scripts/release.sh <staging|prod> [deploy.sh flags]" >&2; exit 1 ;;
esac

MAIN="$(cd "$(dirname "$0")/.." && pwd)"
COPY="$MAIN/../pm-release"
LOCK="$COPY.release.lock"
KEY=~/.ssh/"ssh-key-2026-07-08 (1).key"
SMOKE_CREDENTIALS="$HOME/.claude/projects/C--Users-gerog-Documents-pm-assistant-generic/memory/prod-smoke-account.json"

# One release at a time: the clean copy is reset and reinstalled below, which would wreck a
# release already building in it. A lock older than 45 minutes is a crashed run.
if ! mkdir "$LOCK" 2>/dev/null; then
  if [ -n "$(find "$LOCK" -maxdepth 0 -mmin +45 2>/dev/null)" ]; then
    echo "Removing a release lock older than 45 minutes: $(cat "$LOCK/owner" 2>/dev/null)" >&2
    rm -rf "$LOCK"; mkdir "$LOCK"
  else
    echo "Another release is running: $(cat "$LOCK/owner" 2>/dev/null). Wait for it to finish." >&2; exit 1
  fi
fi
echo "$TARGET — $(hostname) pid $$ at $(date -u +%H:%M:%SZ)" > "$LOCK/owner"
trap 'rm -rf "$LOCK"' EXIT

# Speed tests run slow on battery and fail the deploy (2026-10-10)
if command -v powershell >/dev/null 2>&1; then
  status=$(powershell -NoProfile -Command "(Get-CimInstance Win32_Battery).BatteryStatus" 2>/dev/null | tr -d '\r' | head -1 || true)
  [ "$status" = "1" ] && echo "⚠ The laptop is on battery — plug it in or the speed tests may fail." >&2
fi

echo "━━ Clean copy of origin/master ━━"
git -C "$MAIN" fetch -q origin
git -C "$MAIN" worktree prune
if [ ! -e "$COPY" ]; then
  git -C "$MAIN" worktree add -q --detach "$COPY" origin/master
fi
if [ "$(cd "$COPY" && git rev-parse --path-format=absolute --git-common-dir 2>/dev/null)" != "$(cd "$MAIN" && git rev-parse --path-format=absolute --git-common-dir)" ]; then
  echo "$COPY exists but is not a copy of this repository — move it away and run again." >&2; exit 1
fi
# -f and clean: a copy left dirty by a failed run must not block every later release
git -C "$COPY" checkout -q -f --detach origin/master
git -C "$COPY" clean -fdq
echo "  $(git -C "$COPY" log -1 --oneline)"

# Packages: install when missing or when that folder's lock file changed since the last
# successful install (a stamp, so a half-finished install is redone)
for dir in . src/client mcp-server; do
  want=$(git -C "$COPY" hash-object "$dir/package-lock.json")
  have=$(cat "$COPY/$dir/node_modules/.release-lock-hash" 2>/dev/null || true)
  if [ "$want" != "$have" ]; then
    echo "  installing packages in $dir"
    (cd "$COPY/$dir" && npm ci --no-audit --no-fund >/dev/null)
    echo "$want" > "$COPY/$dir/node_modules/.release-lock-hash"
  fi
done
# Local settings the tests need (not in git, never uploaded) — kept in step with the main folder
cp "$MAIN/.env" "$COPY/.env"

if [ "$TARGET" = prod ]; then
  [ -f "$SMOKE_CREDENTIALS" ] || { echo "Smoke test account file missing: $SMOKE_CREDENTIALS" >&2; exit 1; }
  echo "━━ Backup of prod databases ━━"
  # pipefail on the server too: a failed backup must stop the release, not just print its last line
  ssh -i "$KEY" -o ConnectTimeout=15 ubuntu@147.5.127.251 'set -o pipefail; sudo /usr/local/bin/pm-backup.sh 2>&1 | tail -1'
fi

echo "━━ Deploy ━━"
(cd "$COPY" && bash deploy.sh "$TARGET" "$@")

if [ "$TARGET" = prod ]; then
  echo "━━ Smoke test ━━"
  (cd "$COPY" && SMOKE_CREDENTIALS="$SMOKE_CREDENTIALS" node scripts/prod-smoke.cjs)
fi
echo "━━ Released $(git -C "$COPY" log -1 --format=%h) to $TARGET ━━"
