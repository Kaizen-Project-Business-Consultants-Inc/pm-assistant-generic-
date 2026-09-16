# Deployment — how code reaches each environment

## Environments

| Env | URL | Server | How it gets code |
|---|---|---|---|
| Staging | https://pm.kpbc.ca | ubuntu@147.5.127.99 | **Automatic**: every push to `master` runs `.github/workflows/deploy.yml` (type check → tests → build → scp → restart → health verify). ~3 minutes. |
| Production | https://kovarti.com | ubuntu@147.5.127.251 | **Manual only**: `bash deploy.sh prod` from a machine holding the SSH key. The pipeline never touches production. |

`stagegtacpr.kpbc.ca` (69.72.136.201) is **not** this app's staging and is not deployed by anything in this repo.

## Pipeline notes (`.github/workflows/deploy.yml`)

- The `test` job gates the deploy: any `tsc --noEmit` error or failing vitest test blocks staging. From ~Sep 10 to Sep 16 2026 the pipeline was red on every push because of type errors in the storage/calendar adapters, so nothing merged reached staging until they were fixed (a4a9001).
- "Restart & verify" polls `systemctl is-active` and `/health` for up to ~60s and fails the job if the app does not come back healthy (before 0d4c666 the health check could not fail).
- Deploys are serialised with a `deploy-staging` concurrency group; in-flight deploys are never cancelled.
- Claude Code remote sessions have **no SSH client or SSH key** and cannot reach either server. They can trigger a staging deploy only by pushing to `master`, and can watch runs via the GitHub Actions API.

## Verifying a deploy landed in the browser

The client is a PWA. After a deploy the running tab keeps the old bundle until the user clicks the bottom-right "Reload" toast or hard-refreshes (Ctrl+Shift+R). To confirm the build in use, check the hashed chunk name in the Network tab (e.g. `GanttChart-<hash>.js`).

## Rollback

`git revert <commit>` on master and push: the pipeline redeploys staging automatically. Production rollback is `bash deploy.sh prod` from the reverted master.
