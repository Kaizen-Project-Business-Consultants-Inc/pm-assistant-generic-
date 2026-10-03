import { test, expect, Page } from '@playwright/test';
import { STAGING_USER, STAGING_TEAM_MEMBER } from './staging-helpers';
import { signedIn, api, makeProject, makeTask, archiveProject, thisMonday, plusDays } from './qa-data';

/**
 * Team Planner (Resources → Team Planner) and booked hours following their task, against real
 * staging as the QA PM. The spec makes its own project: next week, person A has a 40 h task
 * ("E2E build") and a 20 h/wk booking ("E2E review"). It's archived at the end.
 */

let pm: Page;
let ids: { projectId: string; scheduleId: string; build: string; review: string };
let A: { id: string; name: string };
let B: { id: string; name: string };
const nextMon = plusDays(thisMonday(), 7);
const nextFri = plusDays(nextMon, 4);

const board = (from = thisMonday()) => api(pm, 'get', `/api/v1/resources/planner?from=${from}&weeks=8`);
const blocksOf = async (personId: string) => ((await board()).people.find((p: any) => p.id === personId)?.blocks ?? []) as any[];

test.describe.configure({ mode: 'serial' });

test.beforeAll(async ({ browser }) => {
  pm = await signedIn(browser, STAGING_USER);
  const people = ((await board()).people as any[]).filter(p => !p.isGeneric);
  expect(people.length, 'QA Staging Co needs at least two people').toBeGreaterThan(1);
  [A, B] = people.slice(-2).map(p => ({ id: p.id, name: p.name }));
  const p = await makeProject(pm, 'QA – e2e planner', thisMonday(), plusDays(thisMonday(), 60));
  const build = await makeTask(pm, p.scheduleId, { name: 'E2E build', startDate: nextMon, endDate: nextFri, assignedTo: A.id });
  const review = await makeTask(pm, p.scheduleId, { name: 'E2E review', startDate: nextMon, endDate: nextFri });
  await api(pm, 'post', '/api/v1/resources/assignments', { resourceId: A.id, taskId: review.id, scheduleId: p.scheduleId, hoursPerWeek: 20, startDate: nextMon, endDate: nextFri });
  ids = { ...p, build: build.id, review: review.id };
});

test.afterAll(async () => {
  if (ids) await archiveProject(pm, ids.projectId);
});

test('the board counts all of a person\'s work, week by week', async () => {
  const person = (await board()).people.find((p: any) => p.id === A.id);
  // next week = column 1: the 40 h task + the 20 h booking at least (plus anything else they have)
  expect(person.load[1]).toBeGreaterThanOrEqual(60);
  expect(person.blocks.find((b: any) => b.taskId === ids.build)).toMatchObject({ editable: true, hoursPerWeek: 40, startDate: nextMon });
  expect(person.blocks.find((b: any) => b.taskId === ids.review)).toMatchObject({ editable: true, hoursPerWeek: 20 });
});

test('dragging a task onto another person shows the check, saves, and Undo puts it back', async () => {
  await pm.goto('/resources?tab=planner');
  await expect(pm.getByRole('heading', { name: 'Team Planner' })).toBeVisible({ timeout: 20_000 });
  const src = pm.getByRole('button', { name: /^E2E build/ });
  await expect(src).toBeVisible();
  const row = pm.locator('div.flex.border-t', { has: pm.getByText(B.name, { exact: true }) }).locator('div.relative.flex-1.grid').first();
  const box = (await row.boundingBox())!;
  const sb = (await src.boundingBox())!;
  // grab the block at its first week (next week), drop on B's row in the same week
  await src.dragTo(row, { sourcePosition: { x: 6, y: sb.height / 2 }, targetPosition: { x: box.width * (1.5 / 8), y: 12 } });

  const dialog = pm.getByRole('dialog');
  await expect(dialog.getByText(`Give "E2E build" to ${B.name}?`)).toBeVisible({ timeout: 15_000 });
  await expect(dialog.getByText('The dates stay the same.')).toBeVisible();
  await expect(dialog.getByRole('cell', { name: A.name }).or(dialog.getByRole('rowheader', { name: A.name }))).toBeVisible();
  await dialog.getByRole('button', { name: `Give it to ${B.name}` }).click();

  await expect(pm.getByRole('status').filter({ hasText: 'Saved in' })).toBeVisible({ timeout: 15_000 });
  expect((await blocksOf(B.id)).some(b => b.taskId === ids.build)).toBe(true);
  expect((await blocksOf(A.id)).some(b => b.taskId === ids.build)).toBe(false);

  await pm.getByRole('status').filter({ hasText: 'Saved in' }).getByRole('button', { name: 'Undo' }).click();
  await expect(pm.getByText('Undone.')).toBeVisible({ timeout: 15_000 });
  expect((await blocksOf(A.id)).some(b => b.taskId === ids.build)).toBe(true);
});

test('Enter on a task opens the same check (keyboard)', async () => {
  await pm.goto('/resources?tab=planner');
  const block = pm.getByRole('button', { name: /^E2E review/ });
  await block.focus();
  await pm.keyboard.press('Enter');
  const dialog = pm.getByRole('dialog');
  await expect(dialog.getByLabel('Person')).toBeVisible();
  await dialog.getByLabel('When').selectOption({ label: '1 week later' });
  await expect(dialog.getByText('Tasks linked after it')).toBeVisible({ timeout: 15_000 });
  await pm.keyboard.press('Escape');
  await expect(dialog).toHaveCount(0);
});

test('booked hours move when the task moves (the save the Gantt makes)', async () => {
  const later = plusDays(nextMon, 14);
  await api(pm, 'put', `/api/v1/schedules/${ids.scheduleId}/tasks/${ids.review}`, { startDate: later, endDate: plusDays(later, 4) });
  const booking = (await blocksOf(A.id)).find(b => b.taskId === ids.review);
  expect(booking).toMatchObject({ startDate: later, endDate: plusDays(later, 4), hoursPerWeek: 20 });
  const person = (await board()).people.find((p: any) => p.id === A.id);
  // 20 h left next week, arrived three weeks from now
  expect(person.load[3]).toBeGreaterThanOrEqual(20);
});

test('a team member doesn\'t get the planner, and the server refuses their moves', async ({ browser }) => {
  const team = await signedIn(browser, STAGING_TEAM_MEMBER);
  await team.goto('/resources?tab=planner');
  await team.waitForTimeout(3000);
  await expect(team.getByRole('button', { name: /Team Planner/ })).toHaveCount(0);
  const r = await team.request.post('/api/v1/resources/planner/move', { data: { taskId: ids.build, fromResourceId: A.id, toResourceId: B.id, weeks: 0 } });
  expect([403, 404]).toContain(r.status());
  await team.context().close();
});
