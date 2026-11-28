import { test, expect, Page } from '@playwright/test';
import { signedIn, api, makeProject, makeTask, archiveProject, plusDays } from './qa-data';
import { STAGING_USER } from './staging-helpers';
import { openSchedule, getTasks, tableCell } from './schedule-helpers';

/**
 * Work (hours) follows Duration and the people on the task (2026-11-27): each person's hours = Duration x Units x
 * the project's hours per day, the task's Work is their total, typing Work changes Duration, a task with nobody
 * keeps a typed Work, and a heading shows its tasks' total. Own QA project, archived afterwards.
 */
test.describe.configure({ mode: 'serial' });

const stamp = Date.now().toString(36);
const START = '2027-03-01'; // a Monday
let page: Page;
let projectId = '';
let scheduleId = '';
let ann = '';
let bo = '';
let taskId = '';
let loneId = '';
const task = async (id: string) => (await getTasks(page, scheduleId)).find(t => t.id === id) as any;
const put = (id: string, data: Record<string, unknown>) => api(page, 'put', `/api/v1/schedules/${scheduleId}/tasks/${id}`, data);

test.beforeAll(async ({ browser }) => {
  page = await signedIn(browser, STAGING_USER);
  ann = (await api(page, 'post', '/api/v1/resources', { name: `QA Work Ann ${stamp}`, role: 'Developer', email: `qa.work.ann.${stamp}@pm.kpbc.ca` })).resource.id;
  bo = (await api(page, 'post', '/api/v1/resources', { name: `QA Work Bo ${stamp}`, role: 'Developer', email: `qa.work.bo.${stamp}@pm.kpbc.ca` })).resource.id;
  const made = await makeProject(page, 'QA – work hours', START, plusDays(START, 60));
  projectId = made.projectId;
  scheduleId = made.scheduleId;
  taskId = (await makeTask(page, scheduleId, {
    name: 'Two people', startDate: START, endDate: plusDays(START, 4), assignedTo: ann,
    assignments: [{ resourceId: ann, allocationPct: 100 }, { resourceId: bo, allocationPct: 50 }],
  })).id;
  loneId = (await makeTask(page, scheduleId, { name: 'Nobody', startDate: START, endDate: plusDays(START, 4) })).id;
});

test.afterAll(async () => {
  if (projectId) await archiveProject(page, projectId);
  await page.context().close();
});

test('Work is each person\'s Duration x Units x 8 h, and the task total (5 days: 40 + 20 = 60)', async () => {
  const t = await task(taskId);
  expect(t.estimatedDurationHours).toBe(60);
  expect(t.assignments.map((a: any) => a.hoursPlanned).sort()).toEqual([20, 40]);
});

test('typing Work on a task with people changes the Duration (and the End date); Work then follows', async () => {
  await put(taskId, { estimatedDurationHours: 120 }); // 12 h a day for the two people -> 10 days
  const t = await task(taskId);
  expect(t.estimatedDays).toBe(10);
  expect(String(t.endDate).slice(0, 10)).toBe(plusDays(START, 11)); // Mon 1 Mar + 10 working days = Fri 12 Mar
  expect(t.estimatedDurationHours).toBe(120);
});

test('changing the dates changes Work with them', async () => {
  await put(taskId, { endDate: plusDays(START, 2) }); // Mon to Wed = 3 days
  expect((await task(taskId)).estimatedDurationHours).toBe(36);
});

test('Work typed on a NEW task with a person and no length gives it the Duration that fits', async () => {
  const made = await makeTask(page, scheduleId, { name: 'New with Work', startDate: START, assignedTo: ann, estimatedDurationHours: 80 }); // one person at 8 h a day
  const t = await task(made.id);
  expect(t.estimatedDays).toBe(10);
  expect(t.estimatedDurationHours).toBe(80);
});

test('a task with nobody on it keeps a typed Work and its Duration does not move', async () => {
  await put(loneId, { estimatedDurationHours: 33 });
  const t = await task(loneId);
  expect(t.estimatedDurationHours).toBe(33);
  expect(t.estimatedDays).toBe(5);
});

test('the task form shows each person\'s hours and the total, and typing hours changes the Duration', async () => {
  await put(taskId, { endDate: plusDays(START, 4) });
  await openSchedule(page, projectId, scheduleId, 'table');
  await page.getByRole('button', { name: 'Edit Two people' }).click();
  const form = page.getByRole('dialog');
  await expect(form.getByLabel('Hours for person 1')).toHaveValue('40');
  await expect(form.getByLabel('Hours for person 2')).toHaveValue('20');
  await expect(form.getByText(/Work: 60 h/)).toBeVisible();
  await expect(form.getByText('Work Hours')).toHaveCount(0);
  await expect(form.getByText('Effort Driven')).toHaveCount(0);
  await form.getByLabel('Hours for person 1').fill('80'); // 100% x 8 h -> 10 days
  await form.getByLabel('Hours for person 1').press('Enter');
  await expect(form.getByLabel('Duration (working days)')).toHaveValue('10');
  await expect(form.getByText(/Work: 120 h/)).toBeVisible();
  await form.getByRole('button', { name: /^Cancel/ }).click();
  await expect(form).toBeHidden();
});

test('a heading shows the total of its tasks and cannot be typed into', async () => {
  const heading = await makeTask(page, scheduleId, { name: 'Phase', startDate: START, endDate: plusDays(START, 4), isSummary: true });
  await put(taskId, { parentTaskId: heading.id });
  await put(loneId, { parentTaskId: heading.id });
  await openSchedule(page, projectId, scheduleId, 'table');
  await page.getByRole('button', { name: /^Columns/ }).click();
  await page.getByRole('checkbox', { name: 'Work' }).check().catch(() => page.getByText(/^Work$/).click());
  await page.keyboard.press('Escape');
  const cell = await tableCell(page, heading.id, 'Work');
  await expect(cell).toContainText('93h'); // 60 (two people, 5 days) + 33 (typed, nobody)
  await cell.click();
  await expect(cell.locator('input')).toHaveCount(0);
});
