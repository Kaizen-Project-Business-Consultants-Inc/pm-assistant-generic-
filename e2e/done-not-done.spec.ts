import { test, expect, Page } from '@playwright/test';
import { signedIn, api, makeProject, makeTask, archiveProject } from './qa-data';
import { STAGING_USER } from './staging-helpers';
import { openSchedule, getTasks, tableCell } from './schedule-helpers';

/**
 * Done / not done plans (2026-11-27): switch a plan to "Done / not done" and its tasks are 0 or 100, never in between.
 * Own QA project, archived afterwards.
 */
test.describe.configure({ mode: 'serial' });

let page: Page;
let projectId = '';
let scheduleId = '';
let doneId = '';
let midId = '';
const pctOf = async (id: string) => ((await getTasks(page, scheduleId)).find(t => t.id === id) as any).progressPercentage;

test.beforeAll(async ({ browser }) => {
  page = await signedIn(browser, STAGING_USER);
  const made = await makeProject(page, 'QA – done not done', '2027-03-01', '2027-04-30');
  projectId = made.projectId;
  scheduleId = made.scheduleId;
  doneId = (await makeTask(page, scheduleId, { name: 'Finished task', startDate: '2027-03-01', endDate: '2027-03-05' })).id;
  midId = (await makeTask(page, scheduleId, { name: 'Half task', startDate: '2027-03-08', endDate: '2027-03-12' })).id;
  await api(page, 'put', `/api/v1/schedules/${scheduleId}/tasks/${doneId}`, { progressPercentage: 100, status: 'completed' });
  await api(page, 'put', `/api/v1/schedules/${scheduleId}/tasks/${midId}`, { progressPercentage: 40 });
});

test.afterAll(async () => {
  if (projectId) await archiveProject(page, projectId);
  await page.context().close();
});

test('a percent plan keeps 40%', async () => {
  expect(await pctOf(midId)).toBe(40);
});

test('switching the plan to done / not done turns 40% into not done and keeps done', async () => {
  await api(page, 'put', `/api/v1/schedules/${scheduleId}`, { progressStyle: 'done' });
  expect(await pctOf(midId)).toBe(0);
  expect(await pctOf(doneId)).toBe(100);
});

test('a typed 60% is stored as not done', async () => {
  await api(page, 'put', `/api/v1/schedules/${scheduleId}/tasks/${midId}`, { progressPercentage: 60 });
  expect(await pctOf(midId)).toBe(0);
});

test('the Table says Done / Not done and the cell becomes a Done / Not done choice', async () => {
  await openSchedule(page, projectId, scheduleId, 'table');
  await page.getByRole('button', { name: /^Columns/ }).click();
  await page.getByRole('checkbox', { name: 'Progress' }).check();
  await page.keyboard.press('Escape');
  await expect(await tableCell(page, doneId, 'Progress')).toContainText('Done');
  await expect(await tableCell(page, midId, 'Progress')).toContainText('Not done');
  await (await tableCell(page, midId, 'Task Name')).click(); // a row is selected first, then its cell edits
  const cell = await tableCell(page, midId, 'Progress');
  await cell.click();
  await cell.locator('select').selectOption('100');
  await expect.poll(() => pctOf(midId), { timeout: 15_000 }).toBe(100);
});

test('switching back to percent keeps the numbers', async () => {
  await api(page, 'put', `/api/v1/schedules/${scheduleId}`, { progressStyle: 'percent' });
  await api(page, 'put', `/api/v1/schedules/${scheduleId}/tasks/${midId}`, { progressPercentage: 40 });
  expect(await pctOf(midId)).toBe(40);
});
