import { test, expect, Page } from '@playwright/test';
import { signedIn, api, makeProject, makeTask, archiveProject } from './qa-data';
import { STAGING_USER } from './staging-helpers';
import { openSchedule, getTasks, tableHeaders, tableCell } from './schedule-helpers';

/**
 * One length per task (2026-11-27): Duration only (no Est Days column), the stored length follows the dates,
 * and typing a Duration in the task form moves the End date. Own QA project, archived afterwards.
 */
test.describe.configure({ mode: 'serial' });

let page: Page;
let projectId = '';
let scheduleId = '';
let taskId = '';
const lenOf = async () => ((await getTasks(page, scheduleId)).find(t => t.id === taskId) as any);

test.beforeAll(async ({ browser }) => {
  page = await signedIn(browser, STAGING_USER);
  const made = await makeProject(page, 'QA – one duration', '2027-03-01', '2027-04-30');
  projectId = made.projectId;
  scheduleId = made.scheduleId;
  // Mon 1 Mar to Fri 5 Mar 2027 = 5 working days
  taskId = (await makeTask(page, scheduleId, { name: 'Length task', startDate: '2027-03-01', endDate: '2027-03-05' })).id;
});

test.afterAll(async () => {
  if (projectId) await archiveProject(page, projectId);
  await page.context().close();
});

test('there is no Est Days column; Duration shows the dates\' working days', async () => {
  await openSchedule(page, projectId, scheduleId, 'table');
  const headers = await tableHeaders(page);
  expect(headers).toContain('Duration');
  expect(headers).not.toContain('Est Days');
  await expect(await tableCell(page, taskId, 'Duration')).toContainText('5');
  await page.getByRole('button', { name: /^Columns/ }).click();
  await expect(page.getByText(/^Est Days$/)).toHaveCount(0);
  await page.keyboard.press('Escape');
});

test('changing the End date changes the stored length with it (they cannot disagree)', async () => {
  await api(page, 'put', `/api/v1/schedules/${scheduleId}/tasks/${taskId}`, { endDate: '2027-03-03' }); // Mon to Wed
  expect((await lenOf()).estimatedDays).toBe(3);
  await openSchedule(page, projectId, scheduleId, 'table');
  await expect(await tableCell(page, taskId, 'Duration')).toContainText('3');
});

test('typing a Duration in the task form moves the End date', async () => {
  await openSchedule(page, projectId, scheduleId, 'table');
  await page.getByRole('button', { name: 'Edit Length task' }).click();
  const form = page.getByRole('dialog');
  await expect(form.getByText('Duration (working days)')).toBeVisible();
  await form.getByLabel('Duration (working days)').fill('6'); // Mon 1 Mar + 6 working days = Mon 8 Mar
  await form.getByRole('button', { name: /^Save|Update/ }).click();
  await expect(form).toBeHidden({ timeout: 15_000 });
  const t = await lenOf();
  expect(String(t.endDate).slice(0, 10)).toBe('2027-03-08');
  expect(t.estimatedDays).toBe(6);
});

test('a length sent alone (assistant or API) moves the End date to fit', async () => {
  await api(page, 'put', `/api/v1/schedules/${scheduleId}/tasks/${taskId}`, { estimatedDays: 2 });
  const t = await lenOf();
  expect(String(t.endDate).slice(0, 10)).toBe('2027-03-02');
});
