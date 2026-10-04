import { Page, expect, Locator } from '@playwright/test';
import { api } from './qa-data';

/**
 * Helpers for e2e/schedule-behaviour.spec.ts — the safety net for the Gantt, Table and
 * Schedule tab before they are split up. Everything goes through the app's own API as the
 * QA PM (cookie auth from the suite's global sign-in).
 */

export type ViewMode = 'gantt' | 'table' | 'kanban';

export interface ApiTask {
  id: string;
  name: string;
  startDate?: string | null;
  endDate?: string | null;
  status: string;
  priority?: string;
  assignedTo?: string | null;
  parentTaskId?: string | null;
  progressPercentage?: number;
  isSummary?: boolean;
  dependencies?: Array<{ dependencyId: string; dependencyType: string; lagDays: number }>;
}

/** The fixed "today" every test runs at (Tue 13 Oct 2026, Toronto) — the Late/Due filters and the today line depend on it */
export const FIXED_NOW = new Date('2026-10-13T10:00:00-04:00');
/** The browser's time zone for these tests, whatever the machine's — dates on screen depend on it */
export const TIMEZONE = 'America/Toronto';

export const ymd = (s?: string | null) => (s ? String(s).slice(0, 10) : null);

/** Every task in a plan (the API pages at 200) */
export async function getTasks(page: Page, scheduleId: string): Promise<ApiTask[]> {
  const all: ApiTask[] = [];
  for (let offset = 0; offset < 5000; offset += 200) {
    const body = await api<any>(page, 'get', `/api/v1/schedules/${scheduleId}/tasks?limit=200&offset=${offset}`);
    const rows: ApiTask[] = body.data ?? body.tasks ?? [];
    all.push(...rows);
    if (rows.length < 200 || all.length >= Number(body.total ?? all.length)) break;
  }
  return all;
}

export async function taskByName(page: Page, scheduleId: string, name: string): Promise<ApiTask> {
  const t = (await getTasks(page, scheduleId)).find(x => x.name === name);
  expect(t, `task "${name}" in the plan`).toBeTruthy();
  return t!;
}

/** Wait until the server's copy of a task matches — saves are fire-and-forget in the UI */
export async function expectTask(page: Page, scheduleId: string, name: string, match: (t: ApiTask) => boolean | void, message?: string) {
  let last: ApiTask | undefined;
  await expect.poll(async () => {
    const t = (await getTasks(page, scheduleId)).find(x => x.name === name);
    last = t;
    if (!t) return false;
    try { return match(t) !== false; } catch { return false; }
  }, { message: message ?? `task "${name}" on the server`, timeout: 15_000 }).toBe(true)
    .catch(e => {
      const seen = last ? JSON.stringify({ start: ymd(last.startDate), end: ymd(last.endDate), status: last.status, parent: last.parentTaskId, summary: last.isSummary, pct: last.progressPercentage, assignedTo: last.assignedTo, deps: last.dependencies?.map(d => `${d.dependencyId}:${d.dependencyType}`) }) : 'not found';
      throw new Error(`${(e as Error).message}\nLast seen on the server: ${seen}`);
    });
}

/**
 * Open the project's schedule tab in a given view. The view, the Gantt zoom and the
 * Timeline strip live in localStorage, so they are set before the app starts.
 */
export async function openSchedule(page: Page, projectId: string, scheduleId: string, view: ViewMode, opts: { zoom?: string; query?: string } = {}) {
  // Only on the first load of this page with these settings: a reload in the test must keep
  // whatever the test changed since (view, columns, timeline …)
  const marker = `e2e-open-${scheduleId}-${view}-${Date.now()}`;
  await page.addInitScript(([pid, sid, v, zoom, mark]) => {
    try {
      // The project's setup checklist above the tabs hides itself 3 s after everything is
      // ready, moving the whole plan up mid-test — keep it closed (as if dismissed)
      localStorage.setItem(`readiness-dismissed-${pid}`, '1');
      if (sessionStorage.getItem(mark)) return;
      sessionStorage.setItem(mark, '1');
      localStorage.setItem(`schedule-view-mode-${pid}`, v);
      localStorage.setItem('gantt-show-timeline', '0');
      localStorage.setItem(`schedule-quick-filter-${sid}`, 'all');
      if (zoom) localStorage.setItem(`gantt-zoom:${sid}`, zoom);
    } catch { /* private window */ }
  }, [projectId, scheduleId, view, opts.zoom ?? '', marker] as const);
  await page.goto(`/project/${projectId}?tab=schedule${opts.query ?? ''}`);
  await waitForRows(page, view);
}

/** The rows of the open view (Gantt left grid, Table body, or Kanban cards) are on screen */
export async function waitForRows(page: Page, view: ViewMode, timeout = 30_000) {
  if (view === 'gantt') await expect(ganttRows(page).first()).toBeVisible({ timeout });
  else if (view === 'table') await expect(tableRows(page).first()).toBeVisible({ timeout });
  else await expect(page.getByRole('group', { name: 'View mode' })).toBeVisible({ timeout });
}

// ---- Gantt ---------------------------------------------------------------------------

export const ganttGrid = (page: Page) => page.getByRole('grid', { name: 'Task list' });
export const ganttRows = (page: Page) => ganttGrid(page).locator('div[role="row"][data-task-id]');
export const ganttRow = (page: Page, taskId: string) => ganttGrid(page).locator(`div[role="row"][data-task-id="${taskId}"]`);

/** Column header labels of the Gantt grid, in screen order ('' for the # and actions columns) */
export async function ganttHeaders(page: Page): Promise<string[]> {
  return ganttGrid(page).locator('div[role="row"]:not([data-task-id]) > div[role="columnheader"]').evaluateAll(
    els => els.map(e => (e.textContent || '').trim()));
}

/** A Gantt cell by its header label (Task Name, Pred, Start, End, Dur, Assigned, Status …) */
export async function ganttCell(page: Page, taskId: string, label: string): Promise<Locator> {
  const headers = await ganttHeaders(page);
  // the header has the actions column only when tasks can be opened; rows always have it
  const idx = headers.findIndex(h => h === label);
  expect(idx, `Gantt column "${label}" in ${JSON.stringify(headers)}`).toBeGreaterThanOrEqual(0);
  return ganttRow(page, taskId).locator(':scope > div').nth(idx);
}

/** A bar in the Gantt timeline, found by the task name in its tooltip */
export const ganttBar = (page: Page, name: string) =>
  page.locator('div.absolute.group\\/bar').filter({ has: page.locator('div.font-semibold', { hasText: new RegExp(`^(\\[Critical\\] )?${escapeRe(name)}$`) }) });

// ---- Table ---------------------------------------------------------------------------

export const tableGrid = (page: Page) => page.locator('table[role="grid"]');
export const tableRows = (page: Page) => tableGrid(page).locator('tbody tr[data-task-id]');
export const tableRow = (page: Page, taskId: string) => tableGrid(page).locator(`tbody tr[data-task-id="${taskId}"]`);

export async function tableHeaders(page: Page): Promise<string[]> {
  return tableGrid(page).locator('thead tr').first().locator(':scope > th').evaluateAll(
    els => els.map(e => (e.textContent || '').trim()));
}

/** A Table cell by its header label (Task Name, Duration, Start Date, End Date, Predecessor, Assigned To, Status …) */
export async function tableCell(page: Page, taskId: string, label: string): Promise<Locator> {
  const headers = await tableHeaders(page);
  const idx = headers.findIndex(h => h === label);
  expect(idx, `Table column "${label}" in ${JSON.stringify(headers)}`).toBeGreaterThanOrEqual(0);
  return tableRow(page, taskId).locator(':scope > td').nth(idx);
}

/**
 * Archive any "QA – e2e schedule …" project a crashed earlier run left active (older than
 * `olderThanMin` minutes, so a run going on at the same time isn't touched). Projects are
 * archived, never deleted.
 */
export async function sweepLeftovers(page: Page, olderThanMin = 30) {
  const cutoff = Date.now() - olderThanMin * 60_000;
  const swept: string[] = [];
  for (let offset = 0; offset < 2000; offset += 200) {
    const r = await page.request.get(`/api/v1/projects?limit=200&offset=${offset}`);
    if (!r.ok()) break;
    const body = await r.json();
    const rows: any[] = body.data ?? body.projects ?? [];
    for (const p of rows) {
      // the API gives 'YYYY-MM-DD hh:mm:ss' in UTC
      const raw = String(p.createdAt ?? '');
      const created = Date.parse(/[zZ]|[+-]\d\d:?\d\d$/.test(raw) ? raw : raw.replace(' ', 'T') + 'Z');
      if (String(p.name).startsWith('QA – e2e schedule') && !p.archivedAt && (isNaN(created) || created < cutoff)) {
        await page.request.post(`/api/v1/projects/${p.id}/archive`, { data: {} });
        swept.push(p.name);
      }
    }
    if (rows.length < 200) break;
  }
  return swept;
}

export function escapeRe(s: string) {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/** Collect uncaught page errors and console errors (minus known third-party noise) */
export function collectErrors(page: Page) {
  const errors: string[] = [];
  page.on('pageerror', e => errors.push(`pageerror: ${e.message}`));
  page.on('console', m => {
    if (m.type() !== 'error') return;
    const t = m.text();
    // network refusals are logged by the browser itself; the tests check behaviour, not every 4xx
    if (/Failed to load resource|net::ERR_|favicon|googletagmanager|google-analytics|cloudflareinsights/i.test(t)) return;
    errors.push(`console: ${t}`);
  });
  return errors;
}
