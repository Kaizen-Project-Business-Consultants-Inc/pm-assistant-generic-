#!/bin/bash
#
# Nightly database backup, with an off-machine copy.
#
# The database runs on the same machine as the app, so a backup that only ever
# lands on that machine protects against almost nothing. This dumps every
# Kovarti database, proves each dump is readable, copies them to a second
# machine, and prunes old copies.
#
# It is deliberately strict: a step that half-works must fail loudly, because
# the whole point of a backup is that you find out it was broken BEFORE you
# need it, not after. Anything that exits non-zero shows up as a failed
# systemd unit and stops the Redis heartbeat, which AlertService alerts on.
#
# Usage: pm-backup.sh            (normal nightly run)
#        pm-backup.sh --verify   (also restore the newest dump into a scratch
#                                 database and count its tables)
#
set -uo pipefail

LOCAL_DIR=/var/backups/pm-app
LOCAL_KEEP_DAYS=7        # local copies are the fast path for a same-day mistake
REMOTE_KEEP_DAYS=30      # the off-machine copy is the one that matters
REMOTE_HOST="${PM_BACKUP_REMOTE_HOST:-}"
REMOTE_PATH="${PM_BACKUP_REMOTE_PATH:-/var/backups/pm-prod}"
REMOTE_KEY="${PM_BACKUP_SSH_KEY:-/home/ubuntu/.ssh/pm-backup.key}"
STAMP=$(date -u +%Y-%m-%d)
DEST="$LOCAL_DIR/$STAMP"
FAILURES=0

log() { echo "[$(date -u +%H:%M:%S)] $*"; }
fail() { log "FAILED: $*"; FAILURES=$((FAILURES + 1)); }

mkdir -p "$DEST" || { log "FATAL: cannot create $DEST"; exit 1; }

# ---------------------------------------------------------------------------
# Dump every Kovarti database: the control plane plus one per customer.
# ---------------------------------------------------------------------------
DATABASES=$(mariadb -N -e "SHOW DATABASES;" | grep -E '^pmassist' || true)
if [ -z "$DATABASES" ]; then
  log "FATAL: no pmassist databases found — refusing to record an empty backup"
  exit 1
fi

COUNT=0
for db in $DATABASES; do
  out="$DEST/$db.sql.gz"
  # --single-transaction keeps the dump consistent without locking the app out.
  if ! mariadb-dump --single-transaction --quick --routines --events --triggers \
        --default-character-set=utf8mb4 "$db" 2>"$DEST/$db.err" | gzip -9 > "$out"; then
    fail "$db: dump failed — $(tail -1 "$DEST/$db.err" 2>/dev/null)"
    continue
  fi
  rm -f "$DEST/$db.err"

  # A dump is not a backup until it has been read back. Both checks matter:
  # gzip integrity catches truncation, and the trailing marker catches a dump
  # that was cut short while still producing valid gzip.
  if ! gzip -t "$out" 2>/dev/null; then
    fail "$db: archive is corrupt"
    continue
  fi
  if ! zcat "$out" | tail -5 | grep -q "Dump completed"; then
    fail "$db: dump is incomplete (no completion marker)"
    continue
  fi

  COUNT=$((COUNT + 1))
  log "$db: $(du -h "$out" | cut -f1)"
done

[ "$COUNT" -eq 0 ] && { log "FATAL: nothing was backed up"; exit 1; }

# A record of what this run believed it was protecting, so a restore can be
# checked against it rather than against a guess.
{
  echo "host:      $(hostname)"
  echo "taken:     $(date -u +'%Y-%m-%d %H:%M:%S') UTC"
  echo "databases: $COUNT"
  for db in $DATABASES; do
    tables=$(mariadb -N -e "SELECT COUNT(*) FROM information_schema.tables WHERE table_schema='$db';" 2>/dev/null || echo '?')
    echo "  $db — $tables tables"
  done
} > "$DEST/MANIFEST.txt"

# ---------------------------------------------------------------------------
# Get it off this machine. Without this step the backup shares the fate of the
# thing it is backing up.
# ---------------------------------------------------------------------------
if [ -n "$REMOTE_HOST" ]; then
  if [ ! -r "$REMOTE_KEY" ]; then
    fail "off-machine copy: no readable key at $REMOTE_KEY"
  else
    SSH_OPTS="-i $REMOTE_KEY -o StrictHostKeyChecking=accept-new -o ConnectTimeout=30 -o BatchMode=yes"
    if ! rsync -a --timeout=600 -e "ssh $SSH_OPTS" "$DEST" "$REMOTE_HOST:$REMOTE_PATH/"; then
      fail "off-machine copy to $REMOTE_HOST"
    else
      # Trust nothing: ask the far end what it actually has.
      remote_count=$(ssh $SSH_OPTS "$REMOTE_HOST" "ls $REMOTE_PATH/$STAMP/*.sql.gz 2>/dev/null | wc -l" 2>/dev/null || echo 0)
      if [ "$remote_count" -ne "$COUNT" ]; then
        fail "off-machine copy: $remote_count of $COUNT files arrived"
      else
        log "copied $COUNT files to $REMOTE_HOST:$REMOTE_PATH/$STAMP"
        ssh $SSH_OPTS "$REMOTE_HOST" \
          "find $REMOTE_PATH -maxdepth 1 -type d -name '20*' -mtime +$REMOTE_KEEP_DAYS -exec rm -rf {} + 2>/dev/null" || true
      fi
    fi
  fi
else
  fail "off-machine copy: PM_BACKUP_REMOTE_HOST is not set — this backup exists only on the machine it protects"
fi

# ---------------------------------------------------------------------------
# Optional deep check: restore the control plane into a scratch database.
# Slow, so it is not part of the nightly run — but nobody had ever proven a
# restore worked until it was done by hand, so make it a single command.
# ---------------------------------------------------------------------------
if [ "${1:-}" = "--verify" ]; then
  scratch="restore_check_$(date -u +%H%M%S)"
  log "restore check into $scratch…"
  if mariadb -e "CREATE DATABASE $scratch;" \
     && zcat "$DEST/pmassist.sql.gz" | mariadb "$scratch"; then
    tables=$(mariadb -N -e "SELECT COUNT(*) FROM information_schema.tables WHERE table_schema='$scratch';")
    users=$(mariadb -N -e "SELECT COUNT(*) FROM $scratch.users;" 2>/dev/null || echo '?')
    log "restore check: $tables tables, $users users"
    [ "$tables" -lt 10 ] && fail "restore check: only $tables tables — the dump is not usable"
  else
    fail "restore check: the dump would not restore"
  fi
  mariadb -e "DROP DATABASE IF EXISTS $scratch;" || true
fi

# Prune local copies last, so a failure above never costs us yesterday's good one.
find "$LOCAL_DIR" -maxdepth 1 -type d -name '20*' -mtime +$LOCAL_KEEP_DAYS -exec rm -rf {} + 2>/dev/null

# ---------------------------------------------------------------------------
# Heartbeat. AlertService raises an alert for any job whose key goes stale, so
# a backup that quietly stops running is noticed — the failure mode that left
# production with no scheduled jobs at all for two months.
# ---------------------------------------------------------------------------
if [ "$FAILURES" -eq 0 ] && command -v redis-cli >/dev/null 2>&1; then
  redis-cli -n "${REDIS_DB:-0}" SET "cron:last:db-backup" \
    "{\"finishedAt\":\"$(date -u +%Y-%m-%dT%H:%M:%S.000Z)\",\"databases\":$COUNT}" >/dev/null 2>&1 || true
fi

if [ "$FAILURES" -gt 0 ]; then
  log "COMPLETED WITH $FAILURES FAILURE(S) — this backup cannot be relied on"
  exit 1
fi

log "OK — $COUNT databases, local + off-machine"
