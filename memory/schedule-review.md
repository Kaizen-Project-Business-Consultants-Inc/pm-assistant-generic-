# Schedule Review — spec summary and build status

Source of truth: Claude Doc "Schedule Review Spec" (https://claude.ai/code/artifact/3ca60bdf-7674-4668-b205-020981c1edc7), also exported as PDF to the user on 2026-09-16. This file carries enough of it to keep building without the doc.

## Why

Imported schedules are tracking sheets, not control schedules: no dependencies, milestones with duration, dates outside the project window, Completed tasks at 0%, no owners, hours stored as days. Every AI scheduling feature (critical path, delay detection, Monte Carlo, recovery agent) assumes that structure exists, so they are silent exactly when a new customer first looks. Schedule Review makes the PM judgement a button and presses it after every import.

Design principles the user agreed to:
- **Rules find, AI interprets.** Deterministic rules produce findings and a reproducible score. AI (later phase) only drafts fixes.
- **AI never writes dates.** It proposes dependencies, milestone flags, phase parents, buffers; the scheduling engine recomputes dates after human approval. Undoable as one group. Never auto-executed regardless of autonomy level.
- **Score must be reproducible** (a PMO will not trust a number a model "assigned"). Anchored to DCMA 14-point thresholds.
- Acceptance criteria / quality gates do NOT live in the schedule (RAID / deliverables register). No EVM in this feature.
- Pitch: Acumen-Fuse-grade schedule quality analysis, run the moment a spreadsheet lands, fix drafted in plain English for a PM who is not a scheduler. (Do not claim "nobody does this" — P6 + Acumen Fuse do; the differentiator is mid-market, instant, AI-drafted fix.)

## Phase 1 — DONE (commits 978cc0f, d89c8bf; live on staging 2026-09-16)

- `src/server/services/scheduleReview/rules.ts` — 28 pure rules R01–R28, `reviewSchedule(input)`, score + bands. RULES_VERSION '1.0'.
- `ScheduleReviewService.run(scheduleId, trigger, userId)` gathers tasks, project window, baselines, CPM float, resource histogram; stores via `ScheduleReviewRepository` (tenant table `schedule_reviews`, migration `T047`). Keeps last 50 runs.
- Routes `/api/v1/schedules/:id/review` (POST run editor / GET latest viewer, 204 when none / GET history?limit).
- CSV + structured import responses carry `review: {score, band, counts, topFindings[]}`.
- Client: `components/schedule/review/{ScheduleReviewPanel,ScheduleScoreChip}.tsx`; Review button after Columns in `ScheduleToolbar` and `GanttToolbar`; `reviewFlagMap` row dots in TableView + GanttLeftPanelRow; "Show rows" filter + orange bar in ScheduleTab; import modal chip + "Review and fix".
- Tests: `src/server/__tests__/services/scheduleReviewRules.test.ts` (27, incl. DBJ golden ≈ score 16, tracking_sheet), `src/client/src/__tests__/components/ScheduleReviewPanel.test.tsx` (9).
- Score: start 100; per rule deduct max (Critical 25 / High 12 / Medium 6 / Low 2 / Info 0) × min(1, affectedFraction/0.2); schedule-scoped rules (R03, R18, R23) deduct in full. Bands 0–39 tracking_sheet, 40–69 needs_work, 70–89 controllable, 90–100 fit_for_control.
- **Not verified from the remote session:** that `schedule_reviews` actually exists on staging after the restart (no SSH there). First thing to check from the CLI: `SELECT name FROM _migrations WHERE name LIKE 'T047%'` in the tenant DB, and `POST /review` on the DBJ schedule (`a90a9b02-e1a4-418b-a43e-3711954208f2`, project `f93fef8c-f147-49ad-bf19-4db9bb59857e`).

## Phase 2 — Import leak fixes — DONE (commit 3f67501; deployed to staging 2026-09-16)

Shipped: predecessor parse/resolve (by real MS Project UID, WBS, or task name; CSV predecessor column aliases; 20/row cap; cycles rejected; unresolved → `warnings`), milestone flag (`is_milestone`/`type=Milestone`/zero duration), auto "Imported baseline" when baseline/actual columns present, hours-vs-days heuristic (decided once per schedule), legend-row skip + cell-ref cleanup on owners. Import responses now carry `dependenciesCreated`, `baselineCreated`, `durationNote`, `skipped[]`, `warnings[]`; ImportModal renders them.
- New pure helpers: `src/server/utils/importPredecessors.ts`, `src/server/utils/importHeuristics.ts` (+ unit tests, 22 cases). Route changes in `src/server/routes/scheduling/import.ts` (both `/import` CSV and `/import-structured`). Client: `api.ts` importStructured signature (+uid, +isMilestone), `ImportModal.tsx` summary. No migration (all fields already existed).
- **Staging smoke test passed:** throwaway schedule + crafted CSV → 3 imported / 1 legend row skipped, 2 deps linked, baseline captured, duration read as days, owner cell-ref cleaned; review score 86 (controllable), no R03, no R04. Throwaway schedule + its 2 resources deleted after.
- **Key gotcha:** a CSV column literally named `Milestone` still maps to the task **name** (DBJ files use it that way); only `is_milestone`/`ismilestone`/`milestone_flag`/`milestone_yn`, a `type=Milestone`, or zero duration set the flag.
- **Not deployed to prod** (standing rule — awaiting explicit approval). Docs updated: PRODUCT_MANUAL §30, TESTING_GUIDE §29, USER_GUIDE, WORLD_CLASS_FEATURES.

### Original Phase 2 spec (for reference)

The importer drops structure the file already holds. Close the leak so the review starts from what the customer had.

| Data | Today | Change |
|---|---|---|
| Predecessors | No column mapping; MSPDI parser (`client/utils/mspdiParser.ts`) produces `3FS+2d` strings that `import-structured` ignores | Map `predecessors/predecessor/depends_on/dependency`; parse row-number refs (`3`, `3FS`, `3FS+2d`, `3,5SS`) and task-name refs; resolve to task ids in a second pass after all rows exist; report unresolvable per row; max 20 per row; cycle rejection already in ScheduleService |
| Milestone flag | `milestone` header maps to task name; `isMilestone` never set | Map `milestone/is_milestone/type=Milestone` → flag; also set when duration is zero. Do NOT infer from name at import (review proposes it) |
| Baseline | Baseline columns land on task fields but no `schedule_baselines` row is created | When any baseline column present, create baseline "Imported baseline" via BaselineService; `planned_*` + `actual_*` → planned = baseline, actual = live |
| Phase hierarchy | Phase column → summary parents (works) | Also detect short code prefix in description/name (T1, T2, PG) and offer as review proposal, not assume |
| Durations | `estimated_hours` stored as given | If value ≈ calendar span for most rows it was days: store as `estimatedDays`, leave hours empty, say so in summary |
| Legend/artefact rows | Imported as tasks/resources | Skip rows whose name is a status word with empty/status-word cells; skip assignees matching cell-ref pattern; list skipped in summary |
| Assignees | Fixed 16 Sep (linked to resource ids) | unchanged |

Fixtures to add: DBJ spreadsheet as exported, MS Project XML with predecessors, CSV with planned vs actual columns.

## Phase 3 — Proposals (4–5 days)

- `ScheduleFixProposer`: one ReasoningEngine call with findings + task list (id, name, phase, dates, owner, status) + project window; zod-validated; retry once then rules-only fallback (sequential chain within phase by sort order, milestone flags from name). Output: dependency links with confidence + reason, milestone flags, phase parents, buffer tasks before gates (named "Buffer before Gate N", working days + reason), duration plausibility questions. Links < 0.6 confidence unticked.
- New ActionProposalService action types: `set_milestone`, `set_parent`, `insert_buffer` (plus existing `update_dependency`).
- Apply order: dependencies → milestones → parents → buffers, then one CPM recompute; Completed/actual-dated tasks pinned. One undo group. Preview table of date deltas; warning band when >30% of tasks move >10 days. Auto-create "Pre-review baseline" before first apply. Rejected lines remembered as negative examples. Schedule Review proposals excluded from autonomous execution. Route `POST /review/propose` (requireFeature('ai'), 409 if one pending). Review reruns after apply (trigger `post_proposal`).

## Phase 4 — Living document (2 days)

- Weekly agent run (scan orchestrator) storing a review row; notify only when score dropped or new Critical/High; nudge owners of stale tasks. Replace Project Hygiene structure checks with the rules engine (keep its sprint/staleness checks).
- Score chip + trend on project page; store alongside `healthSnapshotJob`.
- MCP tools `review-schedule`, `propose-schedule-fixes` on the Kovarti MCP server.
- Playwright flow on staging: import DBJ → score → propose → approve → score rises → undo → score returns.

## Open questions (user has not decided)

1. Show the score to client-role users or delivery team only?
2. Buffers as ordinary tasks vs a distinct task type (proposed: ordinary).
3. DCMA 5% thresholds fire on a single task in a 28-task schedule — keep and label, or scale by size?
4. Run review on templates (proposed yes) and demo project (proposed no)?
5. Organisation-style owners (DBJ, JV): keep as resources + R11 (proposed) vs a "party" concept.

## Bugs noticed on staging while doing data cleanup (not fixed)

- **Updating a task's assignee via `PUT /schedules/:id/tasks/:taskId` (through the MCP `update-task` tool) reset its status to `pending`.** Happened twice on DBJ task #1. Likely the MCP tool or route sends a default status when only `assignedTo` is given. Real bug.
- **Every task PUT on staging took >30 s** (MCP timed out) although the change saved. Something slow in the update path (notifications? autoAddAssigneeToTeam? workflow evaluation?).
