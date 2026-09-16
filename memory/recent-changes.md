# Recent changes and open items (rolling log — newest first)

## 2026-09-16

**Fixed and live on staging (pm.kpbc.ca). Not on production.**

- **Create Project modal unresponsive** (81f9778) — the Sep 13 WCAG change marks `#main-content` inert when a modal opens; 15 modals render inline inside it (TemplatePicker, TaskFormModal, RiskFormModal, import dialogs…) and froze themselves. `useModal` now skips inert when the dialog lives inside `#main-content`; portaled modals (AccessibleModal) keep full inert behaviour.
- **Dashboard `/my-assignments` 500** (81f9778) — query selected `ri.priority` from `project_risks`, which has `severity` not `priority`. Now `severity AS priority`.
- **CI type errors** (a4a9001) — Dropbox/GoogleDrive/GoogleCalendar/OneDrive adapters: `Response.json()` is `unknown`; annotated as `any` per surrounding style. This unblocked the staging pipeline.
- **TimeAnomalyService weekend tests** (88cfd42) — test used wrong calendar dates (2026-09-13 is a Sunday).
- **Deploy pipeline hardened** (0d4c666) — see memory/deployment.md.
- **Gantt Columns picker missing** (a82d245, 7d4622a) — hidden since c0885ab hid ScheduleToolbar in Gantt mode. GanttToolbar now renders the shared `ColumnPickerDropdown` when `columnState` is provided (same per-schedule state as Table view), placed directly after Filter to match Table view order. Legacy built-in picker remains only as a fallback when no shared state is passed.

**Open / follow-ups**

- Production deploy of all of the above: **deliberately not done yet** — user said "deploy to prod — not as yet". Run `bash deploy.sh prod` when ready.
- Gantt vs Table toolbars are separate components that have drifted; a proper merge into one shared toolbar (with Gantt-only timeline controls on top) is a worthwhile follow-up.
- The Gantt's legacy built-in column picker (`!columnState` branch in GanttToolbar) is effectively dead code once every caller passes `columnState`; candidate for removal.
- User's data question pending: **who is assigned to task #1 in the "DBJ" schedule on staging** — could not be answered because the `kovarti-stage` MCP connector failed to connect for the whole session (502). Needs a session where that connector is up.

**Context**

- User (kpbcma@gmail.com) works on staging at pm.kpbc.ca; SME account michaela@kpbc.ca was registered there during testing.
- Pre-existing unrelated noise seen today: Claude Code OAuth token expiry (fix: `/login`), React DevTools "disconnected port" errors (extension, reload page).
