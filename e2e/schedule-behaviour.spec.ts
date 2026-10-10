import { test, expect, Page, Browser, BrowserContext } from '@playwright/test';
import path from 'path';
import { STAGING_URL, STAGING_USER } from './staging-helpers';
import { STORAGE_STATE } from './staging-auth.setup';
import { api } from './qa-data';
import {
  ApiTask, FIXED_NOW, TIMEZONE, ymd, getTasks, taskByName, expectTask, openSchedule, waitForRows,
  ganttGrid, ganttRows, ganttRow, ganttHeaders, ganttCell, ganttBar,
  tableGrid, tableRows, tableRow, tableHeaders, tableCell, collectErrors, sweepLeftovers,
} from './schedule-helpers';

/**
 * SAFETY NET for the schedule screens (GanttChart.tsx, TableView.tsx, ScheduleTab.tsx) before
 * they are split up (code-health item 4). It pins what the Gantt, Table and Kanban views do
 * TODAY, against real staging, as the QA PM — so each refactor step can be checked.
 *
 * One project for the whole file ("QA – e2e schedule …", archived at the end). Every test
 * gets a FRESH plan in it with the same fixed tasks (below) and deletes it afterwards, so
 * the tests don't depend on each other. The browser clock is fixed at Tue 13 Oct 2026 (Toronto time), so
 * the Late / Due / At Risk filters and the Today line never move.
 *
 * Tests marked test.fail() pin a KNOWN BUG: they pass while the bug is there and turn red
 * the day it is fixed — then delete the test.fail line.
 */

const PLAN_START = '2026-10-01';
const PLAN_END = '2026-11-30';

/** The fixed plan every test starts with. Row numbers are fixed (creation order). */
//  #  name      parent    start       finish      notes
//  1  Phase A   —         (rolls up from its tasks: 12 Oct – 28 Oct)
//  2  Design    Phase A   Mon 12 Oct  Wed 14 Oct  3 working days
//  3  Build     Phase A   Thu 15 Oct  Wed 21 Oct  5 working days
//  4  Test      Phase A   Thu 22 Oct  Wed 28 Oct  waits on Build (3 FS)
//  5  Launch    —         Mon  2 Nov  Fri  6 Nov
//  6  Docs      —         Mon  9 Nov  Fri 13 Nov
//  7  Fix bug   —         Mon  5 Oct  Fri  9 Oct  late on 13 Oct; assigned to the QA PM ("My Tasks")
type Plan = { scheduleId: string; ids: Record<'phase' | 'design' | 'build' | 'test' | 'launch' | 'docs' | 'fix', string> };

let ctx: BrowserContext;
let setup: Page;
let projectId: string;
let qaPmResource: { id: string; name: string };
let otherResource: { id: string; name: string };
let plan: Plan;
let pageErrors: string[] = [];
let savedTheme: 'light' | 'dark' = 'light';

test.use({ viewport: { width: 1600, height: 1000 }, actionTimeout: 15_000, timezoneId: TIMEZONE });
test.skip(({ baseURL }) => baseURL !== STAGING_URL, 'runs against staging only (playwright.staging-full.config.ts)');

/**
 * This file signs the QA PM in itself. A password sign-in ends the user's other sessions at
 * their next refresh (token version), so the suite's shared session can't be relied on for a
 * run this long, or while someone else runs tests as the QA PM. Its own session is saved here
 * and used by every test in the file.
 */
const OWN_STATE = path.join(__dirname, '..', 'test-results', '.schedule-behaviour-auth.json');
test.use({ storageState: OWN_STATE });

async function apiContext(browser: Browser) {
  const c = await browser.newContext({ baseURL: STAGING_URL, storageState: { cookies: [], origins: [] } });
  const p = await c.newPage();
  const r = await p.request.post('/api/v1/auth/login', { data: STAGING_USER });
  expect(r.status(), 'QA PM signs in').toBeLessThan(300);
  await c.storageState({ path: OWN_STATE });
  return { c, p };
}

async function makePlan(page: Page, pid: string): Promise<Plan> {
  const schedule = (await api(page, 'post', '/api/v1/schedules', { projectId: pid, name: 'Plan', startDate: PLAN_START, endDate: PLAN_END })).schedule;
  const sid = schedule.id as string;
  const mk = async (body: Record<string, unknown>) => (await api(page, 'post', `/api/v1/schedules/${sid}/tasks`, body)).task.id as string;
  const phase = await mk({ name: 'Phase A' });
  const design = await mk({ name: 'Design', startDate: '2026-10-12', endDate: '2026-10-14', parentTaskId: phase });
  const build = await mk({ name: 'Build', startDate: '2026-10-15', endDate: '2026-10-21', parentTaskId: phase });
  const testT = await mk({ name: 'Test', startDate: '2026-10-22', endDate: '2026-10-28', parentTaskId: phase, dependencies: [{ dependencyId: build, dependencyType: 'FS', lagDays: 0 }] });
  const launch = await mk({ name: 'Launch', startDate: '2026-11-02', endDate: '2026-11-06' });
  const docs = await mk({ name: 'Docs', startDate: '2026-11-09', endDate: '2026-11-13' });
  const fix = await mk({ name: 'Fix bug', startDate: '2026-10-05', endDate: '2026-10-09', assignedTo: qaPmResource.id });
  // the summary's dates roll up in the background
  await expect.poll(async () => {
    const t = (await getTasks(page, sid)).find(x => x.id === phase);
    return `${ymd(t?.startDate)}..${ymd(t?.endDate)}`;
  }, { message: 'Phase A rolls up', timeout: 15_000 }).toBe('2026-10-12..2026-10-28');
  return { scheduleId: sid, ids: { phase, design, build, test: testT, launch, docs, fix } };
}

const names = async (page: Page, rows: ReturnType<typeof ganttRows>) => {
  const ids = await rows.evaluateAll(els => els.map(e => e.getAttribute('data-task-id')));
  const byId = new Map((await getTasks(page, plan.scheduleId)).map(t => [t.id, t.name]));
  return ids.map(id => byId.get(id!) ?? id);
};

test.beforeAll(async ({ browser }) => {
  ({ c: ctx, p: setup } = await apiContext(browser));
  // The theme is a saved preference of the QA PM: every test starts in light, put back at the end
  savedTheme = (await api<any>(setup, 'get', '/api/v1/users/me/view-preferences')).preferences?.theme ?? 'light';
  await api(setup, 'put', '/api/v1/users/me/view-preferences', { theme: 'light' });
  await sweepLeftovers(setup);
  const res = (await api<any>(setup, 'get', '/api/v1/resources')).resources as any[];
  const find = (n: string) => res.find(r => r.name === n);
  expect(find('QA Project Manager'), 'QA Staging Co has the "QA Project Manager" person').toBeTruthy();
  expect(find('QA Team Member'), 'QA Staging Co has the "QA Team Member" person').toBeTruthy();
  qaPmResource = { id: find('QA Project Manager').id, name: 'QA Project Manager' };
  otherResource = { id: find('QA Team Member').id, name: 'QA Team Member' };
  const project = (await api(setup, 'post', '/api/v1/projects', {
    name: `QA – e2e schedule behaviour ${Date.now().toString(36)}`, status: 'active', startDate: PLAN_START, endDate: PLAN_END,
  })).project;
  projectId = project.id;
});

test.afterAll(async () => {
  if (projectId) await setup.request.post(`/api/v1/projects/${projectId}/archive`, { data: {} });
  await setup.request.put('/api/v1/users/me/view-preferences', { data: { theme: savedTheme } });
  // this sign-in replaced the suite's shared session: hand the live one on to the files after this
  await ctx?.storageState({ path: STORAGE_STATE }).catch(() => {});
  await ctx?.close();
});

test.beforeEach(async ({ page }) => {
  plan = await makePlan(setup, projectId);
  pageErrors = [];
  page.on('pageerror', e => pageErrors.push(e.message));
  await page.clock.setFixedTime(FIXED_NOW);
});

test.afterEach(async () => {
  if (plan?.scheduleId) await setup.request.delete(`/api/v1/schedules/${plan.scheduleId}`);
  // an uncaught exception is a crash, whatever the test was checking
  expect(pageErrors, 'uncaught errors in the page').toEqual([]);
});

const open = (page: Page, view: 'gantt' | 'table' | 'kanban', opts: { zoom?: string; query?: string } = {}) =>
  openSchedule(page, projectId, plan.scheduleId, view, opts);

const viewButton = (page: Page, name: string) => page.getByRole('group', { name: 'View mode' }).getByRole('button', { name, exact: true });
const ALL = ['Phase A', 'Design', 'Build', 'Test', 'Launch', 'Docs', 'Fix bug'];

// ---------------------------------------------------------------------------------------
// 1. Views open
// ---------------------------------------------------------------------------------------

test('Gantt, Table and Kanban each show every task, without errors', async ({ page }) => {
  const errors = collectErrors(page);
  await open(page, 'gantt');
  await expect(ganttRows(page)).toHaveCount(7);
  expect(await names(page, ganttRows(page))).toEqual(ALL);
  for (const n of ALL) await expect(ganttBar(page, n)).toHaveCount(1);
  await expect(page.getByText('7 tasks').first()).toBeVisible();

  await viewButton(page, 'Table').click();
  await waitForRows(page, 'table');
  await expect(tableRows(page)).toHaveCount(7);
  expect(await names(page, tableRows(page))).toEqual(ALL);
  expect(await page.evaluate(k => localStorage.getItem(k), `schedule-view-mode-${projectId}`)).toBe('table');

  await viewButton(page, 'Kanban').click();
  for (const n of ALL) await expect(page.getByText(n, { exact: true }).first()).toBeVisible();

  // the chosen view is remembered for the project
  await page.reload();
  await expect(page.getByRole('heading', { name: 'Kanban Board' })).toBeVisible({ timeout: 20_000 });
  await page.waitForLoadState('networkidle');
  expect(errors).toEqual([]);
});

// ---------------------------------------------------------------------------------------
// 2. Inline editing
// ---------------------------------------------------------------------------------------

test('Gantt grid: inline edit name, start, finish, duration and status; the assignee picker opens', async ({ page }) => {
  await open(page, 'gantt');
  const { ids, scheduleId } = plan;

  // Name: first click selects the row, the second edits
  const name = await ganttCell(page, ids.design, 'Task Name');
  await name.click();
  await name.click();
  await ganttRow(page, ids.design).locator('input').fill('Design v2');
  await page.keyboard.press('Enter');
  await expectTask(page, scheduleId, 'Design v2', t => t.id === ids.design);
  await expect(ganttRow(page, ids.design)).toContainText('Design v2');

  // Start date (date picker)
  const start = await ganttCell(page, ids.launch, 'Start');
  await start.click();
  await start.click();
  await ganttRow(page, ids.launch).locator('input[type="date"]').fill('2026-11-03');
  await expectTask(page, scheduleId, 'Launch', t => ymd(t.startDate) === '2026-11-03');

  // Finish date
  const end = await ganttCell(page, ids.docs, 'End');
  await end.click();
  await end.click();
  await ganttRow(page, ids.docs).locator('input[type="date"]').fill('2026-11-16');
  await expectTask(page, scheduleId, 'Docs', t => ymd(t.endDate) === '2026-11-16' && ymd(t.startDate) === '2026-11-09');

  // Duration "3" on a Thursday start counts working days: Thu, Fri, Mon
  const dur = await ganttCell(page, ids.build, 'Dur');
  await dur.click();
  await dur.click();
  await ganttRow(page, ids.build).locator('input').fill('3');
  await page.keyboard.press('Enter');
  await expectTask(page, scheduleId, 'Build', t => ymd(t.startDate) === '2026-10-15' && ymd(t.endDate) === '2026-10-19');
  await expect(await ganttCell(page, ids.build, 'Dur')).toHaveText('3d');

  // Status opens on the first click (a dropdown)
  await (await ganttCell(page, ids.docs, 'Status')).click();
  await ganttRow(page, ids.docs).locator('select').selectOption('in_progress');
  await expectTask(page, scheduleId, 'Docs', t => t.status === 'in_progress');
  await expect(await ganttCell(page, ids.docs, 'Status')).toHaveText('Active');

  // Assignee: the picker opens on the first click (choosing someone: the next test)
  await (await ganttCell(page, ids.launch, 'Assigned')).click();
  await expect(page.getByPlaceholder('Search resources...')).toBeFocused();
  await page.keyboard.press('Escape');
  await expect(page.getByPlaceholder('Search resources...')).toHaveCount(0);
});

test('Gantt grid: the Assigned picker opens above the grid, and someone can be chosen', async ({ page }) => {
  // Fixed 2026-10-04: the Assigned cell has `truncate` (overflow: hidden) and the people list used
  // to open inside it — only a sliver showed. It now opens in a layer above the page, under the cell.
  await open(page, 'gantt');
  await (await ganttCell(page, plan.ids.launch, 'Assigned')).click();
  await page.getByPlaceholder('Search resources...').fill(otherResource.name);
  await page.getByRole('button', { name: new RegExp(otherResource.name) }).first().click({ timeout: 5_000 });
  await expectTask(page, plan.scheduleId, 'Launch', t => t.assignedTo === otherResource.id);
});

test('Table: inline edit name, start, finish, duration, status and assignee', async ({ page }) => {
  await open(page, 'table');
  const { ids, scheduleId } = plan;

  const name = await tableCell(page, ids.launch, 'Task Name');
  await name.click();
  await name.click();
  await tableRow(page, ids.launch).locator('input[type="text"]').fill('Launch v2');
  await page.keyboard.press('Enter');
  await expectTask(page, scheduleId, 'Launch v2', t => t.id === ids.launch);

  const start = await tableCell(page, ids.docs, 'Start Date');
  await start.click();
  await start.click();
  await tableRow(page, ids.docs).locator('input[type="date"]').fill('2026-11-10');
  await expectTask(page, scheduleId, 'Docs', t => ymd(t.startDate) === '2026-11-10');

  const end = await tableCell(page, ids.design, 'End Date');
  await end.click();
  await end.click();
  await tableRow(page, ids.design).locator('input[type="date"]').fill('2026-10-13');
  await expectTask(page, scheduleId, 'Design', t => ymd(t.endDate) === '2026-10-13' && ymd(t.startDate) === '2026-10-12');

  const dur = await tableCell(page, ids.build, 'Duration');
  await dur.click();
  await dur.click();
  await tableRow(page, ids.build).locator('input[placeholder="days"]').fill('3');
  await page.keyboard.press('Enter');
  await expectTask(page, scheduleId, 'Build', t => ymd(t.startDate) === '2026-10-15' && ymd(t.endDate) === '2026-10-19');
  await expect(await tableCell(page, ids.build, 'Duration')).toContainText('3d');

  await (await tableCell(page, ids.launch, 'Status')).click();
  await tableRow(page, ids.launch).locator('select').selectOption('completed'); // the Table offers pending / in progress / completed only
  await expectTask(page, scheduleId, 'Launch v2', t => t.status === 'completed');

  await (await tableCell(page, ids.docs, 'Assigned To')).click();
  await page.getByPlaceholder('Search resources...').fill(otherResource.name);
  await page.getByRole('button', { name: new RegExp(otherResource.name) }).first().click();
  await expectTask(page, scheduleId, 'Docs', t => t.assignedTo === otherResource.id);
  await expect(await tableCell(page, ids.docs, 'Assigned To')).toContainText(otherResource.name);
});

// ---------------------------------------------------------------------------------------
// 3. Keyboard
// ---------------------------------------------------------------------------------------

const isFocusedCell = /ring-primary-300/;

test('Gantt keyboard: arrows move between cells, Enter edits, Escape cancels, Tab moves the edit on', async ({ page }) => {
  await open(page, 'gantt');
  const { ids, scheduleId } = plan;

  // select Design, Enter focuses its first cell (Task Name)
  await (await ganttCell(page, ids.design, 'Task Name')).click();
  await page.keyboard.press('Enter');
  await expect(await ganttCell(page, ids.design, 'Task Name')).toHaveClass(isFocusedCell);
  await page.keyboard.press('ArrowRight');
  await expect(await ganttCell(page, ids.design, 'Dur')).toHaveClass(isFocusedCell);
  await page.keyboard.press('ArrowDown');
  await expect(await ganttCell(page, ids.build, 'Dur')).toHaveClass(isFocusedCell);
  await page.keyboard.press('ArrowUp');
  await page.keyboard.press('ArrowLeft');
  await expect(await ganttCell(page, ids.design, 'Task Name')).toHaveClass(isFocusedCell);

  // Enter edits; typing then Escape leaves the value as it was
  await page.keyboard.press('Enter');
  const input = ganttRow(page, ids.design).locator('input');
  await expect(input).toBeFocused();
  await input.fill('Should not save');
  await page.keyboard.press('Escape');
  await expect(input).toHaveCount(0);
  await expect(ganttRow(page, ids.design)).toContainText('Design');
  await page.waitForTimeout(1000); // a save would have gone out by now
  expect((await taskByName(page, scheduleId, 'Design')).id).toBe(ids.design);
  // the cell keeps the focus after Escape
  await expect(await ganttCell(page, ids.design, 'Task Name')).toHaveClass(isFocusedCell);

  // Tab while editing saves and edits the next field — today that is Predecessors
  // (the fixed field order Name → Pred → Start → End → Dur …, not the column order on screen).
  // The list was entered by a click, so that Escape also left it (K1/K2): click the selected row's
  // name again, which opens its editor.
  await (await ganttCell(page, ids.design, 'Task Name')).click();
  await expect(input).toBeFocused();
  await input.fill('Design');
  await page.keyboard.press('Tab');
  await expect(ganttRow(page, ids.design).locator('input[placeholder="e.g. 3FS"]')).toBeFocused();
  await page.keyboard.press('Escape');
});

test('Table keyboard: arrows move between cells, Enter edits, Escape cancels', async ({ page }) => {
  await open(page, 'table');
  const { ids, scheduleId } = plan;

  // the first click on a cell selects the row and focuses that cell
  await (await tableCell(page, ids.design, 'Task Name')).click();
  await expect(await tableCell(page, ids.design, 'Task Name')).toHaveClass(isFocusedCell);
  await page.keyboard.press('ArrowRight');
  await expect(await tableCell(page, ids.design, 'Duration')).toHaveClass(isFocusedCell);
  await page.keyboard.press('ArrowDown');
  await expect(await tableCell(page, ids.build, 'Duration')).toHaveClass(isFocusedCell);

  await page.keyboard.press('Enter');
  const input = tableRow(page, ids.build).locator('input[placeholder="days"]');
  await expect(input).toBeFocused();
  await input.fill('9');
  await page.keyboard.press('Escape');
  await expect(input).toHaveCount(0);
  await page.waitForTimeout(1000);
  const build = await taskByName(page, scheduleId, 'Build');
  expect(ymd(build.endDate)).toBe('2026-10-21');
  await expect(await tableCell(page, ids.build, 'Duration')).toContainText('5d');
});

// ---------------------------------------------------------------------------------------
// 4. Copy / paste
// ---------------------------------------------------------------------------------------

/** PUTs the page sends for one task — to prove a refused paste sends nothing */
function watchPuts(page: Page, taskId: string) {
  const seen: string[] = [];
  page.on('request', r => { if (r.method() === 'PUT' && r.url().includes(taskId)) seen.push(r.url()); });
  page.on('request', r => { if (r.method() === 'PUT' && r.url().includes('/bulk/tasks') && (r.postData() || '').includes(taskId)) seen.push(r.url()); });
  return seen;
}

test('Gantt copy/paste: duration, start and predecessors paste into another task; a summary refuses', async ({ page }) => {
  await open(page, 'gantt');
  const { ids, scheduleId } = plan;
  const phasePuts = watchPuts(page, ids.phase);

  // Design's Duration (3d) → Build's Duration: Build finishes 3 working days after Thu 15 Oct
  await (await ganttCell(page, ids.design, 'Task Name')).click();
  await page.keyboard.press('Enter');
  await page.keyboard.press('ArrowRight'); // Dur
  await page.keyboard.press('Control+c');
  await page.keyboard.press('ArrowDown');
  await page.keyboard.press('Control+v');
  await expectTask(page, scheduleId, 'Build', t => ymd(t.startDate) === '2026-10-15' && ymd(t.endDate) === '2026-10-19');

  // Design's Start (12 Oct) → Build's Start
  await page.keyboard.press('ArrowUp');
  await page.keyboard.press('ArrowRight'); // Start
  await page.keyboard.press('Control+c');
  await page.keyboard.press('ArrowDown');
  await page.keyboard.press('Control+v');
  await expectTask(page, scheduleId, 'Build', t => ymd(t.startDate) === '2026-10-12');

  // Pasting a start onto the summary (Phase A) does nothing: its dates come from its tasks
  await page.keyboard.press('ArrowUp');
  await page.keyboard.press('ArrowUp');
  // (a summary's rolled-up cells never show the focus ring)
  await page.keyboard.press('Control+v');
  await page.waitForTimeout(1500);
  expect(phasePuts, 'no save for the summary').toEqual([]);

  // Test's Predecessors ("3" = Build) → Docs
  for (let i = 0; i < 3; i++) await page.keyboard.press('ArrowDown'); // Phase A → Design → Build → Test
  await page.keyboard.press('ArrowRight'); // End
  await page.keyboard.press('ArrowRight'); // Pred
  await expect(await ganttCell(page, ids.test, 'Pred')).toHaveClass(isFocusedCell);
  await page.keyboard.press('Control+c');
  await page.keyboard.press('ArrowDown');
  await page.keyboard.press('ArrowDown');
  await expect(await ganttCell(page, ids.docs, 'Pred')).toHaveClass(isFocusedCell);
  await page.keyboard.press('Control+v');
  await expectTask(page, scheduleId, 'Docs', t => (t.dependencies ?? []).some(d => d.dependencyId === ids.build && d.dependencyType === 'FS'));
});

test('Table copy/paste: duration, finish and predecessors paste into another task; a summary refuses', async ({ page }) => {
  await open(page, 'table');
  const { ids, scheduleId } = plan;
  const phasePuts = watchPuts(page, ids.phase);

  await (await tableCell(page, ids.design, 'Duration')).click();
  await page.keyboard.press('Control+c');
  await page.keyboard.press('ArrowDown');
  await page.keyboard.press('Control+v');
  await expectTask(page, scheduleId, 'Build', t => ymd(t.startDate) === '2026-10-15' && ymd(t.endDate) === '2026-10-19');

  // Docs' End Date (13 Nov) → Launch: Launch now finishes 13 Nov, its start unchanged
  await (await tableCell(page, ids.docs, 'End Date')).click();
  await page.keyboard.press('Control+c');
  await page.keyboard.press('ArrowUp'); // Launch
  await page.keyboard.press('Control+v');
  await expectTask(page, scheduleId, 'Launch', t => ymd(t.endDate) === '2026-11-13' && ymd(t.startDate) === '2026-11-02');

  // onto the summary: nothing
  await (await tableCell(page, ids.design, 'End Date')).click();
  await page.keyboard.press('Control+c');
  await page.keyboard.press('ArrowUp'); // Phase A
  // (a summary's rolled-up cells never show the focus ring)
  await page.keyboard.press('Control+v');
  await page.waitForTimeout(1500);
  expect(phasePuts, 'no save for the summary').toEqual([]);

  await (await tableCell(page, ids.test, 'Predecessor')).click();
  await page.keyboard.press('Control+c');
  await (await tableCell(page, ids.docs, 'Predecessor')).click();
  await page.keyboard.press('Control+v');
  await expectTask(page, scheduleId, 'Docs', t => (t.dependencies ?? []).some(d => d.dependencyId === ids.build));
});

// ---------------------------------------------------------------------------------------
// 5. Indent / outdent
// ---------------------------------------------------------------------------------------

test('Gantt indent (Tab) makes a summary that rolls up; Shift+Tab outdents one level', async ({ page }) => {
  await open(page, 'gantt');
  const { ids, scheduleId } = plan;

  // Docs under Launch
  await (await ganttCell(page, ids.docs, 'Task Name')).click();
  await page.keyboard.press('Tab');
  await expectTask(page, scheduleId, 'Docs', t => t.parentTaskId === ids.launch);
  // Launch is now a summary and takes its dates from Docs
  await expectTask(page, scheduleId, 'Launch', t => !!t.isSummary && ymd(t.startDate) === '2026-11-09' && ymd(t.endDate) === '2026-11-13');
  await expect(ganttRow(page, ids.launch).getByTitle('Collapse children')).toBeVisible();

  // Fix bug under Docs (the row above it), then Shift+Tab: back up one level, under Launch
  await (await ganttCell(page, ids.fix, 'Task Name')).click();
  await page.keyboard.press('Tab');
  await expectTask(page, scheduleId, 'Fix bug', t => t.parentTaskId === ids.docs);
  await page.keyboard.press('Shift+Tab');
  await expectTask(page, scheduleId, 'Fix bug', t => t.parentTaskId === ids.launch);
  // Today's behaviour: while Docs was Fix bug's summary its dates rolled up to Fix bug's (5–9 Oct),
  // and they stay that way when it stops being a summary — so Launch now spans 5–9 Oct
  await expectTask(page, scheduleId, 'Docs', t => !t.isSummary && ymd(t.startDate) === '2026-10-05' && ymd(t.endDate) === '2026-10-09');
  await expectTask(page, scheduleId, 'Launch', t => ymd(t.startDate) === '2026-10-05' && ymd(t.endDate) === '2026-10-09');
});

test('Gantt Shift+Tab outdents a task to the top level', async ({ page }) => {
  // Fixed 2026-10-04: the page sends parentTaskId: null, which the task update used to refuse (400).
  await open(page, 'gantt');
  const { ids, scheduleId } = plan;
  await (await ganttCell(page, ids.design, 'Task Name')).click();
  await page.keyboard.press('Shift+Tab');
  await expectTask(page, scheduleId, 'Design', t => !t.parentTaskId);
});

/** How far a Table row's name is indented (levels) — the Table works out the next indent from
 *  what it shows, so a test waits for the screen to catch up before the next key press */
const tableLevel = async (page: Page, taskId: string) =>
  (await tableCell(page, taskId, 'Task Name')).locator(':scope > div').first().evaluate(e => Math.round(parseFloat((e as HTMLElement).style.paddingLeft || '0') / 20));

test('Table indent and outdent (keyboard and right-click menu)', async ({ page }) => {
  await open(page, 'table');
  const { ids, scheduleId } = plan;

  // right-click → Indent: Docs under Launch
  await tableRow(page, ids.docs).click({ button: 'right', position: { x: 300, y: 10 } });
  await page.getByRole('button', { name: 'Indent' }).click();
  await expectTask(page, scheduleId, 'Docs', t => t.parentTaskId === ids.launch);
  await expect(tableRow(page, ids.launch).getByTitle('Collapse children')).toBeVisible();

  // keyboard: Tab indents Fix bug under Docs, Shift+Tab takes it back to the top level
  await (await tableCell(page, ids.fix, 'Task Name')).click();
  await page.keyboard.press('Tab');
  await expectTask(page, scheduleId, 'Fix bug', t => t.parentTaskId === ids.docs);
  await expect.poll(() => tableLevel(page, ids.fix)).toBe(2);
  await page.keyboard.press('Shift+Tab');
  await expectTask(page, scheduleId, 'Fix bug', t => t.parentTaskId === ids.launch);
  await expect.poll(() => tableLevel(page, ids.fix)).toBe(1);
  await page.keyboard.press('Shift+Tab');
  await expectTask(page, scheduleId, 'Fix bug', t => !t.parentTaskId);
  await expect.poll(() => tableLevel(page, ids.fix)).toBe(0);

  // right-click → Outdent one level (to a parent that exists). Fix bug is still the selected
  // row (clicking its name again would start editing it)
  await page.keyboard.press('Tab'); // under the row above (Docs)
  await expectTask(page, scheduleId, 'Fix bug', t => t.parentTaskId === ids.docs);
  await expect.poll(() => tableLevel(page, ids.fix)).toBe(2);
  await tableRow(page, ids.fix).click({ button: 'right', position: { x: 300, y: 10 } });
  await page.getByRole('button', { name: 'Outdent' }).click();
  await expectTask(page, scheduleId, 'Fix bug', t => t.parentTaskId === ids.launch);
});

test('Table indent rolls the new summary\'s dates up', async ({ page }) => {
  // Fixed 2026-10-04: the Table indents through PUT /bulk/tasks, which used to change parentTaskId
  // without recomputing the summary (Launch kept 2–6 Nov). The Gantt's multi-row Tab uses it too.
  await open(page, 'table');
  const { ids, scheduleId } = plan;
  await tableRow(page, ids.docs).click({ button: 'right', position: { x: 300, y: 10 } });
  await page.getByRole('button', { name: 'Indent' }).click();
  await expectTask(page, scheduleId, 'Docs', t => t.parentTaskId === ids.launch);
  await expectTask(page, scheduleId, 'Launch', t => !!t.isSummary && ymd(t.startDate) === '2026-11-09' && ymd(t.endDate) === '2026-11-13');
});

test('Table right-click Outdent moves a task to the top level', async ({ page }) => {
  // Fixed 2026-10-04 (parentTaskId: null used to be refused by the task update)
  await open(page, 'table');
  const { ids, scheduleId } = plan;
  await tableRow(page, ids.design).click({ button: 'right', position: { x: 300, y: 10 } });
  await page.getByRole('button', { name: 'Outdent' }).click();
  await expectTask(page, scheduleId, 'Design', t => !t.parentTaskId);
});

// ---------------------------------------------------------------------------------------
// 6. Bulk delete + undo
// ---------------------------------------------------------------------------------------

async function undoFromHistory(page: Page) {
  await page.getByRole('button', { name: 'History', exact: true }).click();
  const history = page.getByRole('dialog', { name: 'Schedule History' });
  await expect(history).toBeVisible();
  await history.getByRole('button', { name: 'Undo' }).first().click();
  await expect(history.getByRole('status')).toContainText('Undone:');
  await history.getByRole('button', { name: 'Close history' }).click();
}

async function confirmDelete(page: Page) {
  const dialog = page.getByRole('dialog').filter({ hasText: /Delete/ });
  await dialog.getByRole('button', { name: 'Delete', exact: true }).click();
  await expect(dialog).toHaveCount(0);
}

const idsOf = async (page: Page) => (await getTasks(page, plan.scheduleId)).map(t => t.id).sort();

test('Gantt bulk delete (Ctrl+click rows), then Undo from History and with Ctrl+Z — same tasks back', async ({ page }) => {
  await open(page, 'gantt');
  const { ids } = plan;
  const before = await idsOf(page);

  const pick = async () => {
    await ganttRow(page, ids.launch).locator(':scope > div').first().click({ modifiers: ['Control'] });
    await ganttRow(page, ids.docs).locator(':scope > div').first().click({ modifiers: ['Control'] });
    await expect(page.getByText('2 selected').first()).toBeVisible();
    await page.getByRole('button', { name: 'Delete', exact: true }).first().click();
    await confirmDelete(page);
    await expect.poll(() => idsOf(page)).toEqual(before.filter(id => id !== ids.launch && id !== ids.docs));
    await expect(ganttRows(page)).toHaveCount(5);
  };

  await pick();
  await undoFromHistory(page);
  await expect.poll(() => idsOf(page)).toEqual(before);
  await expect(ganttRows(page)).toHaveCount(7);

  await pick();
  await page.locator('body').press('Control+z');
  await expect.poll(() => idsOf(page)).toEqual(before);
  await expect(ganttRows(page)).toHaveCount(7);
});

test('Table bulk delete (checkboxes), then Undo from History and with Ctrl+Z — same tasks back', async ({ page }) => {
  await open(page, 'table');
  const { ids } = plan;
  const before = await idsOf(page);

  const pick = async () => {
    await tableRow(page, ids.design).locator('input[type="checkbox"]').check();
    await tableRow(page, ids.fix).locator('input[type="checkbox"]').check();
    await page.getByRole('button', { name: 'Delete', exact: true }).first().click();
    await confirmDelete(page);
    await expect.poll(() => idsOf(page)).toEqual(before.filter(id => id !== ids.design && id !== ids.fix));
    await expect(tableRows(page)).toHaveCount(5);
  };

  await pick();
  await undoFromHistory(page);
  await expect.poll(() => idsOf(page)).toEqual(before);
  await expect(tableRows(page)).toHaveCount(7);

  await pick();
  await page.locator('body').press('Control+z');
  await expect.poll(() => idsOf(page)).toEqual(before);
  await expect(tableRows(page)).toHaveCount(7);
});

// ---------------------------------------------------------------------------------------
// 7. Gantt bars (mouse)
// ---------------------------------------------------------------------------------------

/** Day zoom: 32 px a day */
const DAY = 32;

/** A bar's box once it has stopped moving (two reads 400 ms apart agree) */
async function stableBox(page: Page, bar: ReturnType<typeof ganttBar>) {
  // (the project's setup checklist above the plan can disappear a moment after loading and
  // move every row up — three reads 500 ms apart must agree)
  let prev = '';
  let same = 0;
  for (let i = 0; i < 30; i++) {
    const box = (await bar.boundingBox())!;
    const now = JSON.stringify(box);
    same = now === prev ? same + 1 : 0;
    if (same >= 2) return box;
    prev = now;
    await page.waitForTimeout(500);
  }
  return (await bar.boundingBox())!;
}

async function dragBy(page: Page, x: number, y: number, dx: number) {
  await page.mouse.move(x, y);
  await page.mouse.down();
  await page.mouse.move(x + dx / 2, y, { steps: 5 });
  await page.mouse.move(x + dx, y, { steps: 5 });
  await page.mouse.up();
}

test('Gantt bars: dragging a bar moves it by whole working days', async ({ page }) => {
  await open(page, 'gantt', { zoom: 'day' });
  await page.waitForLoadState('networkidle'); // late answers re-draw the timeline (and scroll it back to today)
  // Launch Mon 2 – Fri 6 Nov dragged 2 days right: starts Wed 4 Nov, still 5 working days
  const launch = ganttBar(page, 'Launch');
  await launch.scrollIntoViewIfNeeded();
  const b = await stableBox(page, launch);
  await dragBy(page, b.x + 20, b.y + b.height / 2, 2 * DAY);
  await expectTask(page, plan.scheduleId, 'Launch', t => ymd(t.startDate) === '2026-11-04' && ymd(t.endDate) === '2026-11-10');
});

test('Gantt bars: dragging the right edge changes the finish (snapped back off a weekend)', async ({ page }) => {
  await open(page, 'gantt', { zoom: 'day' });
  await page.waitForLoadState('networkidle'); // late answers re-draw the timeline (and scroll it back to today)
  // Design Mon 12 – Wed 14 Oct, its right edge dragged 3 days → Sat 17 → Fri 16 Oct
  const design = ganttBar(page, 'Design');
  await design.scrollIntoViewIfNeeded();
  const b = await stableBox(page, design);
  const x = b.x + b.width - 3, y = b.y + 4; // the last 8 px resize; the link dot sits mid-height
  await page.mouse.move(x, y);
  await dragBy(page, x, y, 3 * DAY);
  await expectTask(page, plan.scheduleId, 'Design', t => ymd(t.startDate) === '2026-10-12' && ymd(t.endDate) === '2026-10-16');
});

async function dragProgress(page: Page, name: string, toFraction: number) {
  const bar = ganttBar(page, name);
  await bar.scrollIntoViewIfNeeded();
  const b = await stableBox(page, bar);
  await page.mouse.move(b.x + b.width / 2, b.y + b.height / 2); // hover shows the handle
  const h = (await bar.locator('div[title^="Progress:"]').boundingBox())!;
  // grab the handle near its top — the link dots sit on the middle of the bar's ends
  await page.mouse.move(h.x + h.width / 2, h.y + 3);
  await page.mouse.down();
  await page.mouse.move(b.x + b.width * (toFraction / 2), h.y + 3, { steps: 5 });
  await page.mouse.move(b.x + b.width * toFraction, h.y + 3, { steps: 5 });
  await page.mouse.up();
}

test('Gantt bars: the progress handle sets % complete (a bar too short for its name label)', async ({ page }) => {
  // Week zoom: Launch (4 days) is 40 px wide — no name label on the bar
  await api(setup, 'put', `/api/v1/schedules/${plan.scheduleId}/tasks/${plan.ids.launch}`, { progressPercentage: 20 });
  await open(page, 'gantt', { zoom: 'week' });
  await page.waitForLoadState('networkidle'); // late answers re-draw the timeline (and scroll it back to today)
  await dragProgress(page, 'Launch', 0.7);
  await expectTask(page, plan.scheduleId, 'Launch', t => (t.progressPercentage ?? 0) >= 60 && (t.progressPercentage ?? 0) <= 80 && ymd(t.startDate) === '2026-11-02');
});

test('Gantt bars: the progress handle sets % complete on a bar wide enough to show its name', async ({ page }) => {
  // Fixed 2026-10-04: the name label covers the bar and used to catch the press, so dragging the
  // handle MOVED the bar. The label now lets presses through.
  await api(setup, 'put', `/api/v1/schedules/${plan.scheduleId}/tasks/${plan.ids.build}`, { progressPercentage: 20 });
  await open(page, 'gantt', { zoom: 'day' });
  await page.waitForLoadState('networkidle'); // late answers re-draw the timeline (and scroll it back to today)
  await dragProgress(page, 'Build', 0.6);
  await expectTask(page, plan.scheduleId, 'Build', t => (t.progressPercentage ?? 0) >= 50 && ymd(t.startDate) === '2026-10-15');
});

test('Gantt bars: dragging from one bar\'s end dot to another bar makes a link', async ({ page }) => {
  await open(page, 'gantt', { zoom: 'day' });
  await page.waitForLoadState('networkidle'); // late answers re-draw the timeline (and scroll it back to today)
  const { ids, scheduleId } = plan;
  const design = ganttBar(page, 'Design');
  await design.scrollIntoViewIfNeeded();
  await stableBox(page, ganttBar(page, 'Launch')); // the page has stopped moving
  const d = (await design.boundingBox())!;
  await page.mouse.move(d.x + d.width / 2, d.y + d.height / 2);
  const dot = (await design.locator('div[title="Drag to create dependency (Finish)"]').boundingBox())!;
  await page.mouse.move(dot.x + dot.width / 2, dot.y + dot.height / 2);
  await page.mouse.down();
  const target = (await ganttBar(page, 'Launch').boundingBox())!;
  // Drop on Launch's row. Launch's bar may be off to the right of the window; the drop only
  // needs the row, and anywhere left of the bar's middle means its Start (Finish-to-Start)
  const vw = page.viewportSize()!.width;
  await page.mouse.move(Math.min(target.x + 10, vw - 40), target.y + target.height / 2, { steps: 10 });
  await page.mouse.up();
  await expectTask(page, scheduleId, 'Launch', t => (t.dependencies ?? []).some(x => x.dependencyId === ids.design && x.dependencyType === 'FS'));
  await expect(await ganttCell(page, ids.launch, 'Pred')).toContainText('2');
});

// ---------------------------------------------------------------------------------------
// 8. Search, filters, sort, collapse
// ---------------------------------------------------------------------------------------

test('Gantt: search, Late / My Tasks quick filters, column sort, collapse a summary', async ({ page }) => {
  await open(page, 'gantt');

  // search keeps a match's summary so it has a place to sit
  const search = page.getByLabel('Search tasks');
  await search.fill('Bui');
  await expect.poll(() => names(page, ganttRows(page))).toEqual(['Phase A', 'Build']);
  await page.getByLabel('Clear search').click();
  await expect(ganttRows(page)).toHaveCount(7);

  await page.getByRole('tab', { name: /^Late/ }).click();
  await expect.poll(() => names(page, ganttRows(page))).toEqual(['Fix bug']);
  await expect(page.getByRole('tab', { name: /^Late/ })).toContainText('1');
  await page.getByRole('tab', { name: /^My Tasks/ }).click();
  await expect.poll(() => names(page, ganttRows(page))).toEqual(['Fix bug']);
  await page.getByRole('tab', { name: /^All/ }).click();
  await expect(ganttRows(page)).toHaveCount(7);

  // sort by Start: siblings sort, children stay under their summary
  const startHeader = ganttGrid(page).getByRole('button', { name: 'Start', exact: true });
  // (a mouse click on a narrow header lands on the Move left/right arrows that pop up on hover —
  // see the report; the label also takes Enter)
  await startHeader.focus();
  await page.keyboard.press('Enter');
  await expect.poll(() => names(page, ganttRows(page))).toEqual(['Fix bug', 'Phase A', 'Design', 'Build', 'Test', 'Launch', 'Docs']);
  await page.keyboard.press('Enter');
  // today the Gantt sorts only the top level: a summary's tasks keep their plan order
  // (the Table sorts them too)
  await expect.poll(() => names(page, ganttRows(page))).toEqual(['Docs', 'Launch', 'Phase A', 'Design', 'Build', 'Test', 'Fix bug']);
  // row numbers don't change with the sort
  await expect(ganttRow(page, plan.ids.docs).locator(':scope > div').first()).toHaveText('6');

  // collapse / expand Phase A (remembered for the plan)
  await ganttRow(page, plan.ids.phase).getByTitle('Collapse children').click();
  await expect(ganttRows(page)).toHaveCount(4);
  await page.reload();
  await waitForRows(page, 'gantt');
  await expect(ganttRows(page)).toHaveCount(4);
  await ganttRow(page, plan.ids.phase).getByTitle('Expand children').click();
  await expect(ganttRows(page)).toHaveCount(7);
});

test('a task due today is not Late (west of UTC)', async ({ page }) => {
  // Fixed 2026-10-04: utils/taskRiskAssessment.ts read 'YYYY-MM-DD' with new Date(), i.e. midnight
  // UTC — in Toronto the evening before — so a task finishing today was "late".
  await api(setup, 'put', `/api/v1/schedules/${plan.scheduleId}/tasks/${plan.ids.fix}`, { endDate: '2026-10-13' });
  await open(page, 'gantt');
  await expect(page.getByRole('tab', { name: /^Late/ })).toContainText('0', { timeout: 5_000 });
});

test('Table: search, Late / My Tasks quick filters, column sort, collapse a summary', async ({ page }) => {
  await open(page, 'table');

  const search = page.getByPlaceholder('Search tasks...', { exact: true });
  await search.fill('Bui');
  await expect.poll(() => names(page, tableRows(page))).toEqual(['Build']);
  await search.fill('');
  await expect(tableRows(page)).toHaveCount(7);

  await page.getByRole('tab', { name: /^Late/ }).click();
  await expect.poll(() => names(page, tableRows(page))).toEqual(['Fix bug']);
  await page.getByRole('tab', { name: /^My Tasks/ }).click();
  await expect.poll(() => names(page, tableRows(page))).toEqual(['Fix bug']);
  await page.getByRole('tab', { name: /^All/ }).click();
  await expect(tableRows(page)).toHaveCount(7);

  const startHeader = tableGrid(page).locator('thead th').filter({ hasText: /^Start Date$/ }).locator('span.cursor-pointer');
  await startHeader.click();
  await expect.poll(() => names(page, tableRows(page))).toEqual(['Fix bug', 'Phase A', 'Design', 'Build', 'Test', 'Launch', 'Docs']);
  await startHeader.click();
  await expect.poll(() => names(page, tableRows(page))).toEqual(['Docs', 'Launch', 'Phase A', 'Test', 'Build', 'Design', 'Fix bug']);

  await tableRow(page, plan.ids.phase).getByTitle('Collapse children').click();
  await expect(tableRows(page)).toHaveCount(4);
  await tableRow(page, plan.ids.phase).getByTitle('Expand children').click();
  await expect(tableRows(page)).toHaveCount(7);
});

// ---------------------------------------------------------------------------------------
// 9. Columns
// ---------------------------------------------------------------------------------------

test('Columns: hide one and move one — the Gantt and the Table keep it after a reload', async ({ page }) => {
  await open(page, 'gantt');
  expect(await ganttHeaders(page)).toEqual(['', 'Task Name', 'Dur', 'Start', 'End', 'Pred', 'Assigned', 'Status', '']);

  await page.getByTitle('Choose columns').click();
  const picker = page.locator('div.w-64').filter({ hasText: 'Reset visibility' });
  await picker.getByRole('button', { name: 'Status', exact: true }).click();
  await picker.locator('div.flex', { has: page.getByText('Start Date', { exact: true }) }).getByLabel('Move column left').click();
  await page.keyboard.press('Escape');
  await page.mouse.click(5, 500); // close the picker
  const expected = ['', 'Task Name', 'Start', 'Dur', 'End', 'Pred', 'Assigned', ''];
  await expect.poll(() => ganttHeaders(page)).toEqual(expected);

  await page.waitForTimeout(2000); // the column choice is also saved to the server, debounced
  await page.reload();
  await waitForRows(page, 'gantt');
  await expect.poll(() => ganttHeaders(page)).toEqual(expected);

  await viewButton(page, 'Table').click();
  await waitForRows(page, 'table');
  await expect.poll(() => tableHeaders(page)).toEqual(['', '#', 'Task Name', 'Start Date', 'Duration', 'End Date', 'Predecessor', 'Assigned To', '']);
});

// ---------------------------------------------------------------------------------------
// 10. Timeline strip, inline insert
// ---------------------------------------------------------------------------------------

test('Timeline strip toggles (and is remembered); typing in the empty row adds a task — Gantt and Table', async ({ page }) => {
  await open(page, 'gantt');
  const strip = page.getByRole('img', { name: /^Project timeline from/ });
  const toggle = page.getByRole('button', { name: 'Timeline', exact: true });
  await expect(strip).toHaveCount(0);
  await toggle.click();
  await expect(toggle).toHaveAttribute('aria-pressed', 'true');
  await expect(strip).toBeVisible();
  await page.reload();
  await waitForRows(page, 'gantt');
  await expect(strip).toBeVisible();
  await toggle.click();
  await expect(strip).toHaveCount(0);

  await page.getByPlaceholder('Type a task name…').fill('Added in Gantt');
  await page.keyboard.press('Enter');
  await expect(ganttRows(page)).toHaveCount(8);
  await expectTask(page, plan.scheduleId, 'Added in Gantt', t => t.status === 'pending');

  await viewButton(page, 'Table').click();
  await waitForRows(page, 'table');
  await page.getByPlaceholder('Type a task name…').fill('Added in Table');
  await page.keyboard.press('Enter');
  await expect(tableRows(page)).toHaveCount(9);
  await expectTask(page, plan.scheduleId, 'Added in Table', t => !t.parentTaskId);
});

// ---------------------------------------------------------------------------------------
// 11. Deep link to a task
// ---------------------------------------------------------------------------------------

const highlighted = /ring-amber-400/;

test('Task link (?schedule=&task=) opens the plan, expands a collapsed phase and highlights the task', async ({ page }) => {
  const { ids, scheduleId } = plan;
  // Phase A collapsed in this browser — the link must open it to show Design
  await page.addInitScript(([sid, phase]) => { try { localStorage.setItem(`gantt-collapsed:${sid}`, JSON.stringify([phase])); } catch { /* */ } }, [scheduleId, ids.phase] as const);
  await open(page, 'gantt', { query: `&schedule=${scheduleId}&task=${ids.design}` });
  await expect(ganttRow(page, ids.design)).toBeVisible();
  await expect(ganttRow(page, ids.design)).toHaveClass(highlighted);
  // the link's parameters are taken off the address once used
  await expect.poll(() => new URL(page.url()).searchParams.get('task')).toBeNull();

  // Table view: same
  await open(page, 'table', { query: `&schedule=${scheduleId}&task=${ids.docs}` });
  await expect(tableRow(page, ids.docs)).toHaveClass(highlighted);
  await expect(tableRow(page, ids.docs)).toBeInViewport();
});

// ---------------------------------------------------------------------------------------
// 12. Screenshots (light + dark)
// ---------------------------------------------------------------------------------------

async function setTheme(page: Page, dark: boolean) {
  await page.waitForLoadState('networkidle'); // the saved theme is applied once preferences load
  const isDark = await page.evaluate(() => document.documentElement.classList.contains('dark'));
  if (isDark !== dark) await page.getByRole('button', { name: dark ? 'Switch to dark mode' : 'Switch to light mode' }).click();
  await expect.poll(() => page.evaluate(() => document.documentElement.classList.contains('dark'))).toBe(dark);
}

async function settle(page: Page) {
  await page.waitForLoadState('networkidle');
  // floating things over the page (assistant bubble, toasts) move about — not part of the views
  await page.addStyleTag({ content: '.fixed { visibility: hidden !important; }' });
  await page.evaluate(() => document.fonts.ready);
  await page.mouse.move(0, 0);
}

// A few hundred pixels of anti-aliasing slack — small enough that a moved Today line or bar fails
const SHOT = { maxDiffPixels: 300, animations: 'disabled', caret: 'hide' } as const;

for (const view of ['gantt', 'table'] as const) {
  test(`Screenshot: ${view} in light and dark`, async ({ page }) => {
    // the review dots on the rows: run the review now so they are there every time
    await api(setup, 'post', `/api/v1/schedules/${plan.scheduleId}/review`, {});
    await open(page, view, { zoom: 'week' });
    const area = view === 'gantt'
      ? page.locator('#gantt-print-container').locator('xpath=..')
      : tableGrid(page).locator('xpath=ancestor::div[contains(@class,"rounded-xl")][1]');
    const mask = [page.locator('[aria-label^="Schedule Review:"]')];
    try {
      await setTheme(page, false);
      await settle(page);
      await expect(area).toHaveScreenshot(`${view}-light.png`, { ...SHOT, mask });
      await setTheme(page, true);
      await settle(page);
      await expect(area).toHaveScreenshot(`${view}-dark.png`, { ...SHOT, mask });
    } finally {
      // the theme is the QA PM's saved preference — back to light for the next test
      await api(setup, 'put', '/api/v1/users/me/view-preferences', { theme: 'light' });
    }
  });
}

// ---------------------------------------------------------------------------------------
// 13. Speed baseline — 300 tasks
// ---------------------------------------------------------------------------------------

test.describe('300-task plan', () => {
  let big: { projectId: string; scheduleId: string; deepId: string } | undefined;

  test.beforeAll(async () => {
    const project = (await api(setup, 'post', '/api/v1/projects', {
      name: `QA – e2e schedule 300 tasks ${Date.now().toString(36)}`, status: 'active', startDate: PLAN_START, endDate: '2026-12-31',
    })).project;
    const schedule = (await api(setup, 'post', '/api/v1/schedules', { projectId: project.id, name: 'Plan', startDate: PLAN_START, endDate: '2026-12-31' })).schedule;
    big = { projectId: project.id, scheduleId: schedule.id, deepId: '' };
    // 3 × 100 (the bulk limit): 10 phases of 1 summary + 9 tasks each; Monday–Friday weeks in Oct–Nov
    for (let batch = 0; batch < 3; batch++) {
      const tasks: Record<string, unknown>[] = [];
      for (let ph = 0; ph < 10; ph++) {
        const phaseIdx = tasks.length;
        tasks.push({ name: `B${batch + 1} Phase ${ph + 1}` });
        for (let k = 0; k < 9; k++) {
          const week = (ph + k) % 8;
          const mon = new Date(Date.UTC(2026, 9, 5 + week * 7));
          const fri = new Date(mon.getTime() + 4 * 86_400_000);
          tasks.push({
            name: `B${batch + 1} P${ph + 1} task ${k + 1}`,
            startDate: mon.toISOString().slice(0, 10), endDate: fri.toISOString().slice(0, 10),
            parentTaskId: String(phaseIdx),
          });
        }
      }
      const res = await api<any>(setup, 'post', '/api/v1/bulk/tasks', { scheduleId: schedule.id, tasks });
      expect(res.failed ?? []).toEqual([]);
    }
    const all = await getTasks(setup, schedule.id);
    expect(all).toHaveLength(300);
    big.deepId = all.find(t => t.name === 'B3 P9 task 7')!.id;
  });

  test.afterAll(async () => {
    if (big) await setup.request.post(`/api/v1/projects/${big.projectId}/archive`, { data: {} });
  });

  // only this describe's plan: the file-level beforeEach plan is not used here
  for (const view of ['gantt', 'table'] as const) {
    test(`speed: ${view} renders a 300-task plan`, async ({ page }, info) => {
      const b = big!;
      await page.addInitScript(([pid, v]) => { try { localStorage.setItem(`schedule-view-mode-${pid}`, v); } catch { /* */ } }, [b.projectId, view] as const);
      const t0 = Date.now();
      await page.goto(`/project/${b.projectId}?tab=schedule`);
      const firstRow = view === 'gantt' ? ganttRows(page).first() : tableRows(page).first();
      await expect(firstRow).toBeVisible({ timeout: 30_000 });
      await expect(page.getByText('300 tasks').first()).toBeVisible({ timeout: 30_000 });
      const ms = Date.now() - t0;
      info.annotations.push({ type: 'speed', description: `${view}: ${ms} ms from navigation to rows on screen (300 tasks)` });
      console.log(`[speed] ${view}: ${ms} ms from navigation to rows on screen (300 tasks)`);
      expect(ms, 'generous ceiling — a guard against something far slower, not a benchmark').toBeLessThan(15_000);
    });
  }

  test('Gantt: a task link scrolls a long (virtualised) plan to the task', async ({ page }) => {
    const b = big!;
    await openSchedule(page, b.projectId, b.scheduleId, 'gantt', { query: `&schedule=${b.scheduleId}&task=${b.deepId}` });
    const row = ganttRow(page, b.deepId);
    await expect(row).toBeInViewport({ timeout: 30_000 });
    await expect(row).toHaveClass(highlighted);
  });

  test('Table: a task link scrolls a long (virtualised) plan to the task', async ({ page }) => {
    // Fixed 2026-10-04: with 100+ rows only the rows on screen exist; the Table now scrolls to
    // where the row sits first, then centres it once it has rendered.
    const b = big!;
    await openSchedule(page, b.projectId, b.scheduleId, 'table', { query: `&schedule=${b.scheduleId}&task=${b.deepId}` });
    await expect(tableRow(page, b.deepId)).toBeInViewport({ timeout: 10_000 });
  });
});
