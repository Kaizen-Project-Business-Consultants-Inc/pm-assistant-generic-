import { test, expect, Page } from '@playwright/test';
import { signedIn, api, makeProject, makeTask, archiveProject } from './qa-data';
import { STAGING_USER } from './staging-helpers';
import { openSchedule, getTasks } from './schedule-helpers';

/**
 * Actual dates follow the status (2026-11-27): the day chosen is kept, never in the future; reopening clears
 * Actual Finish; one task marked done asks "Finished on". Own QA project, archived afterwards.
 */
test.describe.configure({ mode: 'serial' });

let page: Page;
let projectId = '';
let scheduleId = '';
let taskId = '';
const ymd = (n: number) => new Date(Date.now() + n * 86_400_000).toISOString().slice(0, 10);
const taskNow = async () => (await getTasks(page, scheduleId)).find(t => t.id === taskId) as any;
const put = (data: Record<string, unknown>) => api(page, 'put', `/api/v1/schedules/${scheduleId}/tasks/${taskId}`, data);

test.beforeAll(async ({ browser }) => {
  page = await signedIn(browser, STAGING_USER);
  const made = await makeProject(page, 'QA – actual dates', '2027-03-01', '2027-04-30');
  projectId = made.projectId;
  scheduleId = made.scheduleId;
  taskId = (await makeTask(page, scheduleId, { name: 'Actuals task', startDate: '2027-03-01', endDate: '2027-03-05' })).id;
});

test.afterAll(async () => {
  if (projectId) await archiveProject(page, projectId);
  await page.context().close();
});

test('Completed with a chosen finish day keeps that day', async () => {
  await put({ status: 'in_progress', actualStartDate: ymd(-5) });
  await put({ status: 'completed', actualEndDate: ymd(-2) });
  const t = await taskNow();
  expect(String(t.actualStartDate).slice(0, 10)).toBe(ymd(-5));
  expect(String(t.actualEndDate).slice(0, 10)).toBe(ymd(-2));
});

test('reopening clears Actual Finish and keeps Actual Start', async () => {
  await put({ status: 'in_progress' });
  const t = await taskNow();
  expect(t.actualEndDate ?? null).toBeNull();
  expect(String(t.actualStartDate).slice(0, 10)).toBe(ymd(-5));
});

test('back to Not started clears both', async () => {
  await put({ status: 'pending' });
  const t = await taskNow();
  expect(t.actualStartDate ?? null).toBeNull();
  expect(t.actualEndDate ?? null).toBeNull();
});

test('a future day is refused with a plain message', async () => {
  const res = await page.evaluate(async ({ sid, tid, day }) => {
    const r = await fetch(`/api/v1/schedules/${sid}/tasks/${tid}`, { method: 'PUT', credentials: 'include', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ status: 'completed', actualEndDate: day }) });
    return { status: r.status, body: await r.text() };
  }, { sid: scheduleId, tid: taskId, day: ymd(7) });
  expect(res.status).toBe(400);
  expect(res.body).toMatch(/future/);
});

test('marking one task done in the form asks "Finished on" and keeps the chosen day', async () => {
  await openSchedule(page, projectId, scheduleId, 'table');
  await page.getByRole('button', { name: 'Edit Actuals task' }).click();
  const form = page.getByRole('dialog');
  await form.getByLabel('Status').selectOption('completed');
  await form.getByRole('button', { name: /^Save|Update/ }).click();
  const ask = page.getByRole('dialog', { name: 'Mark done' });
  await expect(ask).toBeVisible();
  await ask.getByLabel('Finished on').fill(ymd(-1));
  await ask.getByRole('button', { name: 'Mark done' }).click();
  await expect.poll(async () => String((await taskNow()).actualEndDate ?? '').slice(0, 10), { timeout: 15_000 }).toBe(ymd(-1));
});
