import { test, expect, Page } from '@playwright/test';
import { existsSync } from 'node:fs';
import { signedIn, makeProject, archiveProject } from './qa-data';
import { STAGING_USER } from './staging-helpers';
import { openSchedule, getTasks } from './schedule-helpers';

/**
 * Assigned To shows a person's name, never a raw id (2026-11-26). A real import on staging: the file's
 * Responsibility column creates people, and the open Table must show their names straight away,
 * with no page reload. Own QA project, archived afterwards.
 */
test.describe.configure({ mode: 'serial' });

let page: Page;
let projectId = '';
let scheduleId = '';
const stamp = Date.now().toString(36);
// the names end in a word: the import strips a trailing cell reference ("gp6", "D9") from a name, and a random suffix can look like one
const WHO = [`Quinn Import ${stamp} Test`, `Riley Import ${stamp} Test`];
const UUID = /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/i;


/** An import only goes into an EMPTY plan, and openSchedule waits for a first row: open the empty plan by hand */
async function openEmptyTable(pid: string) {
  await page.addInitScript((p) => {
    try { localStorage.setItem(`readiness-dismissed-${p}`, '1'); localStorage.setItem(`schedule-view-mode-${p}`, 'table'); } catch { /* private window */ }
  }, pid);
  await page.goto(`/project/${pid}?tab=schedule`);
  await expect(page.getByRole('button', { name: 'More actions' })).toBeVisible({ timeout: 30_000 });
}

test.beforeAll(async ({ browser }) => {
  page = await signedIn(browser, STAGING_USER);
  const made = await makeProject(page, 'QA – assigned names', '2027-02-01', '2027-04-30');
  projectId = made.projectId;
  scheduleId = made.scheduleId;
});

test.afterAll(async () => {
  if (projectId) await archiveProject(page, projectId);
  await page.context().close();
});

test('after an import the Table shows the people by name, not by code, without a reload', async () => {
  await openEmptyTable(projectId);
  await page.getByRole('button', { name: 'More actions' }).click();
  await page.getByRole('button', { name: /^Import/ }).first().click();
  const csv = ['Task Name,Responsibility,Start Date,End Date',
    `Design step,${WHO[0]},2027-02-01,2027-02-05`,
    `Build step,${WHO[1]},2027-02-08,2027-02-12`,
    'Review step,Completed,2027-02-15,2027-02-19'].join('\n');
  await page.getByLabel('Choose a file to import').setInputFiles({ name: 'names.csv', mimeType: 'text/csv', buffer: Buffer.from(csv) });
  await page.getByRole('button', { name: /^Import 3 rows/ }).click();
  await expect(page.getByText(/imported|succeeded|2 task/i).first()).toBeVisible({ timeout: 30_000 });
  await expect(page.getByText(/2 people added/i)).toBeVisible(); // the box says who the import added
  await expect(page.getByText(/Left blank, not people/)).toBeVisible(); // and that Completed was left blank, not made a person
  await page.getByRole('button', { name: /close/i }).first().click().catch(() => page.keyboard.press('Escape'));

  // the server holds ids, as the user's screenshot showed
  const tasks = await getTasks(page, scheduleId);
  expect(tasks.filter(t => (t as any).assignedTo && UUID.test((t as any).assignedTo)).length).toBe(2); // Quinn and Riley; the Completed row has no person

  // on screen: names, no code anywhere in the Table (no reload)
  const table = page.locator('table[role="treegrid"]');
  await expect(table.getByText(WHO[0])).toBeVisible({ timeout: 15_000 });
  await expect(table.getByText(WHO[1])).toBeVisible();
  expect(await table.innerText()).not.toMatch(UUID);
});

test('the Gantt and the Kanban board show the names too', async () => {
  await openSchedule(page, projectId, scheduleId, 'gantt');
  const grid = page.getByRole('treegrid', { name: 'Task list' });
  await expect(grid.getByText(WHO[0]).first()).toBeVisible();
  expect(await grid.innerText()).not.toMatch(UUID);
  await openSchedule(page, projectId, scheduleId, 'kanban');
  await expect(page.getByText(WHO[1]).first()).toBeVisible();
  expect(await page.locator('main').innerText()).not.toMatch(UUID);
});

test('a person who is no longer there reads "Unknown person", never a code', async () => {
  const tasks = await getTasks(page, scheduleId);
  const t = tasks.find(x => x.name === 'Design step')!;
  const gone = '11111111-2222-4333-8444-555555555555';
  const r = await page.request.put(`/api/v1/schedules/${scheduleId}/tasks/${t.id}`, { data: { assignedTo: gone } });
  expect(r.ok()).toBeTruthy();
  await openSchedule(page, projectId, scheduleId, 'table');
  const table = page.locator('table[role="treegrid"]');
  await expect(table.getByText('Unknown person')).toBeVisible();
  expect(await table.innerText()).not.toContain(gone);
});

// The user's real plan (Downloads): its Responsibility column is what showed raw ids on 2026-11-25
const DBJ = 'C:/Users/gerog/Downloads/A-DBJ_LMS_Project_Management_Gantt_Chart - Nov 25.xlsx';
test('the real DBJ spreadsheet: after importing it, no code shows in the Table, with no reload', async () => {
  test.skip(!existsSync(DBJ), 'the DBJ file is only on the user machine');
  test.setTimeout(240_000);
  const made = await makeProject(page, 'QA – DBJ import', '2026-06-01', '2026-12-31');
  try {
    await openEmptyTable(made.projectId);
    await page.getByRole('button', { name: 'More actions' }).click();
    await page.getByRole('button', { name: /^Import/ }).first().click();
    await page.getByLabel('Choose a file to import').setInputFiles(DBJ);
    const go = page.getByRole('button', { name: /^Import \d+ rows/ });
    await expect(go).toBeVisible({ timeout: 60_000 });
    await go.click();
    await expect(page.getByText(/imported|succeeded/i).first()).toBeVisible({ timeout: 120_000 });
    // a status word in Responsibility is left blank, not made a person, and the box says so
    await expect(page.getByText(/Left blank, not people/)).toBeVisible();
    await expect(page.getByText(/“Completed” in \d+ tasks?/)).toBeVisible();
    await page.keyboard.press('Escape');
    const tasks = await getTasks(page, made.scheduleId);
    const withPerson = tasks.filter(t => (t as any).assignedTo);
    console.log(`DBJ import: ${tasks.length} tasks, ${withPerson.length} with a person, ${withPerson.filter(t => UUID.test((t as any).assignedTo)).length} stored as ids`);
    expect(withPerson.length).toBeGreaterThan(0);
    const table = page.locator('table[role="treegrid"]');
    await expect(table).toBeVisible();
    expect(await table.innerText()).not.toMatch(UUID);
  } finally {
    // kept on purpose until all the people-on-tasks changes are done (user, 2026-11-26): archive it then
    console.log(`DBJ test project kept: /project/${made.projectId}`);
  }
});
