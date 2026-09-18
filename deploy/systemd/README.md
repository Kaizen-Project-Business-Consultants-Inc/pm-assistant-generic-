# Scheduled jobs

These unit files are the source of truth for every scheduled job. `deploy.sh` installs
and enables them on the target server, and fails the deploy if any expected timer is
missing afterwards.

**Why they live here.** Scheduled work used to run inside the app (node-cron). On
2026-07-14 (commit 1083e42d) it moved to systemd timers, which meant each job had to be
registered on the server by hand, once per machine. Staging was set up that day.
Production never was, and nothing recorded that the step existed — not the deploy
script, not a setup script, not a document. Production therefore ran **no scheduled
jobs at all** from mid-July until 2026-09-18: no trial reminders, no digests, no
overdue scans, no report deliveries, no data retention.

It stayed invisible because the app logs "Cron jobs managed externally via systemd
timers" on startup and never checks whether anything is actually scheduled, and because
the old in-process code is still present and complete in `cronManager.ts` — anyone
reading it would reasonably conclude the jobs run. (`startCronTasks` is called from
nowhere.)

**Adding a job needs three things:**
1. the job module under `src/server/services/scheduling/`
2. a `case` in `src/server/scripts/runCronJob.ts`
3. a `.timer` file here — which the next deploy installs on every server

Run one by hand: `sudo systemctl start pm-cron@<name>.service`
Read its output: `journalctl -u pm-cron@<name>.service`
