# Recent changes and open items (rolling log — newest first)

## 2026-09-16 (later — Phase 3 slice A + fix-button honesty)

- **Phase 3 follow-up fixes** (commit 02f6edb, staging): (1) **Propose fixes was slow (~43s) and always fell back to rules** — the AI response overflowed maxTokens 1500, truncated → invalid JSON → retry → fallback. Now propose returns deterministic rules **instantly** (0.2s); AI is opt-in via a **Draft with AI** button (maxTokens 4000, short reasons, skipped when >60 leaf tasks). (2) **set_milestone now also sets estimatedDays=0 and collapses endDate=startDate** (user caught this — a flagged milestone must be a point in time, else it trips R04). Undo restores flag+duration+endDate. Verified on staging.
- **Schedule Review Phase 3 slice A — structural fix engine** (commits 82681ab, 655bc04; deployed to staging). **Propose fixes** in the review panel drafts add_dependency / set_milestone / set_parent, PM ticks + applies, score re-computes, one-click Undo (removes its own Pre-review baseline so the score returns exactly), Dismiss records a negative example. AI drafts reasons+confidence when budget allows, deterministic rules otherwise. Self-contained tenant table `schedule_fix_proposals` (T048, applied to all 17 staging tenant DBs), NOT the shared agent proposal system. Full detail + smoke-test result in `memory/schedule-review.md`. **Not on prod.** Deferred: auto date-recompute (use Auto-Reschedule), buffers, Phase 4.
- **Import "Review and fix" button** was renamed "Open review" (commit c454ad0) while no fix existed, then restored to **Review and fix** once Phase 3 shipped the fix.
- **deploy.sh `--server-only` is flaky** — a run failed at upload (`/tmp/server-dist.tar.gz: Cannot open`) under `set -e`; a full `deploy.sh staging --skip-tests` worked. Prefer full deploy. `--skip-tests` is needed locally because 2 `TimeAnomalyService` weekend tests fail on this Windows box's timezone (pass in UTC/CI).

## 2026-09-16 (later — Phase 2)

- **Schedule Review Phase 2 — import leak fixes** (commit 3f67501, on master, deployed to staging). Import now preserves predecessors (resolve by real MSP UID / WBS / name; CSV predecessor columns; unresolved reported as warnings), milestone flags, an auto "Imported baseline", hours-vs-days, and skips legend rows / cleans owner cell-refs. Import responses gained `dependenciesCreated`, `baselineCreated`, `durationNote`, `skipped[]`, `warnings[]`. Details + staging smoke-test result in `memory/schedule-review.md`. **Not on prod** (awaiting explicit approval). Next: Phase 3 (AI fix proposals).
- Verified Phase 1 on staging from the CLI: `schedule_reviews` table + `T047` present in tenant DBs; DBJ-Loans review scored 19 (tracking_sheet), R03 critical. Auth note: API JWT is a cookie (`access_token`), not a Bearer header — Bearer is treated as an API key.

## 2026-09-16

**Fixed and live on staging (pm.kpbc.ca). Not on production.**

- **Create Project modal unresponsive** (81f9778) — the Sep 13 WCAG change marks `#main-content` inert when a modal opens; 15 modals render inline inside it (TemplatePicker, TaskFormModal, RiskFormModal, import dialogs…) and froze themselves. `useModal` now skips inert when the dialog lives inside `#main-content`; portaled modals (AccessibleModal) keep full inert behaviour.
- **Dashboard `/my-assignments` 500** (81f9778) — query selected `ri.priority` from `project_risks`, which has `severity` not `priority`. Now `severity AS priority`.
- **CI type errors** (a4a9001) — Dropbox/GoogleDrive/GoogleCalendar/OneDrive adapters: `Response.json()` is `unknown`; annotated as `any` per surrounding style. This unblocked the staging pipeline.
- **TimeAnomalyService weekend tests** (88cfd42) — test used wrong calendar dates (2026-09-13 is a Sunday).
- **Deploy pipeline hardened** (0d4c666) — see memory/deployment.md.
- **Schedule Review Phase 1** — rules-based schedule quality check per the Schedule Review Spec (Claude Doc "Schedule Review Spec"). New: `src/server/services/scheduleReview/rules.ts` (28 pure rules + score), `ScheduleReviewService`, `ScheduleReviewRepository`, tenant migration `T047_schedule_reviews.sql`, routes under `/api/v1/schedules/:id/review` (POST run / GET latest / GET history), import routes return `review` summary. Client: `components/schedule/review/` (panel + score chip), Review button after Columns in both toolbars, row indicators via `reviewFlagMap` (TableView, GanttLeftPanelRow), "Show rows" grid filter in ScheduleTab, import summary chip. Golden DBJ fixture scores ~16 (tracking sheet). Phases 2–4 (import leak fixes, AI proposals, agent/MCP) not started.
- **Imported tasks not linked to resources** — CSV/Excel import stored the assignee *name* in `tasks.assigned_to`, while the UI expects a resource ID; the task modal's Assigned To dropdown showed blank for every imported schedule (seen on DBJ). Import now resolves names → resource IDs up front (`src/server/utils/assigneeResources.ts`, creating missing resources as before) and stores the ID. Client pickers (`TaskFormModal`, `ResourcePickerDropdown`) fall back to a case-insensitive name match via `src/client/src/utils/resourceLookup.ts`, so already-imported schedules resolve too. Data note: DBJ import produced a stray resource named "DBJ & JV+D9:D27" (Excel cell ref) and one named "Completed"; not cleaned up yet.
- **Gantt Columns picker missing** (a82d245, 7d4622a) — hidden since c0885ab hid ScheduleToolbar in Gantt mode. GanttToolbar now renders the shared `ColumnPickerDropdown` when `columnState` is provided (same per-schedule state as Table view), placed directly after Filter to match Table view order. Legacy built-in picker remains only as a fallback when no shared state is passed.

**Open / follow-ups**

- **Schedule Review**: Phase 1 live on staging; Phases 2–4 and open questions in `memory/schedule-review.md`. Verify from a machine with SSH that `schedule_reviews` exists on staging (see that file). Next: Phase 2 (import leak fixes).
- **Two staging bugs seen during data cleanup** (details in `memory/schedule-review.md`): task PUT resets status to pending when only assignedTo is sent; task PUT takes >30 s.
- **DBJ data state on staging**: legend row 29 and all 11 resources (4 imported + 5 demo + 2 artefacts) were deleted at the user's request. Tasks 1–6 keep assignees as text (DBJ, JV, DBJ / JV, DBJ & JV); modal dropdown shows blank for them until resources exist again.
- **User preferences**: short, plain answers; they are a PM, not deeply technical; frustrated by long explanations and by slowness. They moved to the Claude Code CLI on 2026-09-16 (has the SSH key there; can run `deploy.sh prod` and check the DB).

- Production deploy of all of the above: **deliberately not done yet** — user said "deploy to prod — not as yet". Run `bash deploy.sh prod` when ready.
- Gantt vs Table toolbars are separate components that have drifted; a proper merge into one shared toolbar (with Gantt-only timeline controls on top) is a worthwhile follow-up.
- The Gantt's legacy built-in column picker (`!columnState` branch in GanttToolbar) is effectively dead code once every caller passes `columnState`; candidate for removal.
- DBJ task #1 ("Kick-Off Meeting & Project Governance") is assigned to "DBJ & JV+D9:D27" — answered via kovarti-stage MCP once the user reconnected the connector. Optional cleanup: rename that resource to "DBJ & JV", delete the "Completed" resource, relink tasks.

**Context**

- User (kpbcma@gmail.com) works on staging at pm.kpbc.ca; SME account michaela@kpbc.ca was registered there during testing.
- Pre-existing unrelated noise seen today: Claude Code OAuth token expiry (fix: `/login`), React DevTools "disconnected port" errors (extension, reload page).
