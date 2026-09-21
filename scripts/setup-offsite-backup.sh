#!/bin/bash
#
# One-time setup: give a server somewhere off-machine to put its backups.
#
#   bash scripts/setup-offsite-backup.sh prod
#
# Creates a dedicated SSH key on the source server, authorises it on the
# destination server for a backup-only account, and writes /etc/pm-backup.env
# so the nightly job knows where to send things. Safe to re-run.
#
# The key is created ON the source server and its private half never leaves it.
# It is restricted on the destination: no shell allocation, no port forwarding,
# and only from the source server's address.
#
set -euo pipefail

ENV="${1:-}"
SSH_KEY="${HOME}/.ssh/ssh-key-2026-07-08 (1).key"

case "$ENV" in
  prod)    SRC=147.5.127.251; DST=147.5.127.99;  DST_NAME="staging" ;;
  staging) SRC=147.5.127.99;  DST=147.5.127.251; DST_NAME="production" ;;
  *) echo "Usage: $0 <prod|staging>"; exit 1 ;;
esac

SRC_SSH="ubuntu@$SRC"
DST_SSH="ubuntu@$DST"
REMOTE_PATH="/var/backups/pm-$ENV"

say() { echo "  $*"; }

echo "Setting up off-machine backups: $ENV ($SRC) → $DST_NAME ($DST)"

# 1. A key used for nothing else, so it can be revoked without affecting anything.
say "Creating a dedicated key on $ENV…"
ssh -i "$SSH_KEY" "$SRC_SSH" '
  if [ ! -f ~/.ssh/pm-backup.key ]; then
    ssh-keygen -t ed25519 -N "" -C "pm-backup" -f ~/.ssh/pm-backup.key >/dev/null
  fi
  chmod 600 ~/.ssh/pm-backup.key'
PUBKEY=$(ssh -i "$SSH_KEY" "$SRC_SSH" 'cat ~/.ssh/pm-backup.key.pub')

# 2. Authorise it on the destination, restricted as far as rsync allows.
say "Authorising it on $DST_NAME, restricted to $SRC…"
ssh -i "$SSH_KEY" "$DST_SSH" "
  sudo mkdir -p $REMOTE_PATH && sudo chown ubuntu:ubuntu $REMOTE_PATH
  mkdir -p ~/.ssh && touch ~/.ssh/authorized_keys && chmod 600 ~/.ssh/authorized_keys
  grep -v 'pm-backup' ~/.ssh/authorized_keys > ~/.ssh/authorized_keys.new || true
  echo 'from=\"$SRC\",no-agent-forwarding,no-port-forwarding,no-pty,no-X11-forwarding $PUBKEY' >> ~/.ssh/authorized_keys.new
  mv ~/.ssh/authorized_keys.new ~/.ssh/authorized_keys
  chmod 600 ~/.ssh/authorized_keys"

# 3. Tell the nightly job where to send things.
say "Recording the destination on $ENV…"
ssh -i "$SSH_KEY" "$SRC_SSH" "
  printf 'PM_BACKUP_REMOTE_HOST=ubuntu@%s\nPM_BACKUP_REMOTE_PATH=%s\nPM_BACKUP_SSH_KEY=/home/ubuntu/.ssh/pm-backup.key\n' \
    '$DST' '$REMOTE_PATH' | sudo tee /etc/pm-backup.env >/dev/null
  sudo chmod 600 /etc/pm-backup.env"

# 4. Prove the link works now, rather than finding out at 02:30.
say "Testing the connection…"
if ssh -i "$SSH_KEY" "$SRC_SSH" "ssh -i ~/.ssh/pm-backup.key -o StrictHostKeyChecking=accept-new -o BatchMode=yes ubuntu@$DST 'touch $REMOTE_PATH/.write-test && rm $REMOTE_PATH/.write-test && echo ok'" | grep -q ok; then
  say "✓ $ENV can write to $DST_NAME"
else
  echo "  ✗ The test write failed. Backups will stay on $ENV only."
  exit 1
fi

echo
echo "Done. Run a backup now with:"
echo "  ssh -i \"\$SSH_KEY\" $SRC_SSH 'sudo systemctl start pm-backup.service'"
