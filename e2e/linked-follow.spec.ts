import { test, expect, Page } from '@playwright/test';
import { signedIn, api, makeProject, makeTask, archiveProject, plusDays } from './qa-data';
import { STAGING_USER } from './staging-helpers';
import { openSchedule, getTasks, tableCell, tableRow, ymd } from './schedule-helpers';

/**
 * Linked tasks follow both ways (2026-11-28): after a date change the tasks that follow move to just after it,
 * earlier or later; a completed task, one with an actual start and one with a date of its own stay, and the answer says
 * which and why. One Undo (Schedule History) puts everything back. Own QA project, archived afterwards.
 *
 *   A Mon 1 Mar – Fri 5 Mar 2027 → B (waits a week: Mon 15 – Fri 19) → C (Mon 22 – Fri 26)
 *   A → D (completed), A → E (starts no earlier than Mon 15 Mar), A → F (actual start)
 */
test.describe.configure({ mode: 'serial' });

const START = '2027-03-01'; // a Monday
let page: Page;
let projectId = '';
let scheduleId = '';
const id: Record<string, string> = {};
const task = async (key: string) => (await getTasks(page, scheduleId)).find(t => t.id === id[key]) as any;
const put = (key: string, data: Record<string, unknown>) => api<any>(page, 'put', `/api/v1/schedules/${scheduleId}/tasks/${id[key]}`, data);
const after = (dep: string) => [{ dependencyId: id[dep], dependencyType: 'FS', lagDays: 0 }];

test.beforeAll(async ({ browser }) => {
  page = await signedIn(browser, STAGING_USER);
  const made = await makeProject(page, 'QA – linked follow', START, plusDays(START, 60));
  projectId = made.projectId;
  scheduleId = made.scheduleId;
  const mk = async (key: string, name: string, body: Record<string, unknown>) => { id[key] = (await makeTask(page, scheduleId, { name, ...body })).id; };
  await mk('A', 'Design review', { startDate: START, endDate: plusDays(START, 4) });
  await mk('B', 'Build screens', { startDate: plusDays(START, 14), endDate: plusDays(START, 18), dependencies: after('A') });
  await mk('C', 'Test screens', { startDate: plusDays(START, 21), endDate: plusDays(START, 25), dependencies: after('B') });
  await mk('D', 'Sign-off', { startDate: plusDays(START, 14), endDate: plusDays(START, 18), dependencies: after('A'), status: 'completed' });
  await mk('E', 'Go live', { startDate: plusDays(START, 14), endDate: plusDays(START, 18), dependencies: after('A'), constraintType: 'SNET', constraintDate: plusDays(START, 14) });
  await mk('F', 'Training', { startDate: plusDays(START, 14), endDate: plusDays(START, 18), dependencies: after('A'), actualStartDate: plusDays(START, 14) });
});

test.afterAll(async () => {
  if (projectId) await archiveProject(page, projectId);
  await page.context().close();
});

test('a new project placed the tasks where the test expects them (setup)', async () => {
  expect(ymd((await task('B')).startDate)).toBe(plusDays(START, 14));
  expect(ymd((await task('D')).startDate)).toBe(plusDays(START, 14));
});

test('finishing the first task earlier pulls the tasks after it up; completed, actual-dated and date-of-their-own tasks stay and are listed', async () => {
  const res = await put('A', { endDate: plusDays(START, 2) }); // Mon 1 – Wed 3 Mar
  // B follows A: Thu 4 Mar, keeping its 5 working days (to Wed 10 Mar); C follows B (Thu 11 – Wed 17)
  expect(ymd((await task('B')).startDate)).toBe(plusDays(START, 3));
  expect(ymd((await task('B')).endDate)).toBe(plusDays(START, 9));
  expect(ymd((await task('C')).startDate)).toBe(plusDays(START, 10));
  for (const key of ['D', 'E', 'F']) expect(ymd((await task(key)).startDate), key).toBe(plusDays(START, 14));
  const held = res.cascadedChanges.held as Array<{ name: string; reason: string }>;
  expect(held.map(h => [h.name, h.reason])).toEqual([
    ['Sign-off', 'is completed'],
    ['Go live', expect.stringMatching(/^has a date of its own \(starts no earlier than 15 Mar\)$/)],
    ['Training', expect.stringMatching(/^has an actual start \(15 Mar\)$/)],
  ]);
  expect(res.cascadedChanges.affectedTasks.map((t: any) => t.taskName).sort()).toEqual(['Build screens', 'Test screens']);
});

test('Schedule History holds one entry with the details, and Undo puts every task back', async () => {
  const { changes } = await api<{ changes: Array<{ id: string; summary: string; undoable: boolean; details?: string[] }> }>(page, 'get', `/api/v1/schedules/${scheduleId}/changes`);
  const change = changes[0];
  expect(change.summary).toBe('Re-dated Design review; 2 tasks moved earlier · 3 tasks not moved');
  expect(change.undoable).toBe(true);
  expect((change.details ?? []).join('\n')).toContain('Sign-off is completed, so it was not moved');
  await api(page, 'post', `/api/v1/schedules/${scheduleId}/changes/${change.id}/undo`, {});
  expect(ymd((await task('A')).endDate)).toBe(plusDays(START, 4));
  expect(ymd((await task('B')).startDate)).toBe(plusDays(START, 14));
  expect(ymd((await task('C')).startDate)).toBe(plusDays(START, 21));
});

test('pushing the first task later still pushes the tasks after it later', async () => {
  await put('A', { endDate: plusDays(START, 18) }); // ends Fri 19 Mar
  expect(ymd((await task('B')).startDate)).toBe(plusDays(START, 21)); // Mon 22 Mar
  await put('A', { endDate: plusDays(START, 4) });
  expect(ymd((await task('B')).startDate), 'pulled back up to A when A comes back').toBe(plusDays(START, 7));
});

test('on the screen: the End Date edit says what moved earlier and what was not moved, Details lists them, Undo puts them back', async () => {
  await openSchedule(page, projectId, scheduleId, 'table');
  const end = await tableCell(page, id.A, 'End Date');
  await end.click();
  await end.click();
  await tableRow(page, id.A).locator('input[type="date"]').fill(plusDays(START, 2));
  const toast = page.getByTestId('undo-toast');
  await expect(toast).toContainText('2 tasks moved earlier, 3 not moved', { timeout: 20_000 });
  await toast.getByRole('button', { name: /Details/ }).click();
  await expect(toast.getByText(/Build screens: 8 Mar → 4 Mar/)).toBeVisible();
  await expect(toast.getByText(/Sign-off is completed/)).toBeVisible();
  await expect(toast.getByText(/Go live has a date of its own \(starts no earlier than 15 Mar\)/)).toBeVisible();
  await expect(toast.getByText(/Training has an actual start \(15 Mar\)/)).toBeVisible();
  await toast.getByRole('button', { name: 'Undo' }).click();
  await expect.poll(async () => ymd((await task('B')).startDate), { timeout: 20_000 }).toBe(plusDays(START, 7));
  expect(ymd((await task('A')).endDate)).toBe(plusDays(START, 4));
});

test('adding a link pulls a task sitting later than its predecessor up to it', async () => {
  const late = (await makeTask(page, scheduleId, { name: 'Late task', startDate: plusDays(START, 28), endDate: plusDays(START, 32) })).id;
  const res = await api<any>(page, 'put', `/api/v1/schedules/${scheduleId}/tasks/${late}`, { dependencies: [{ dependencyId: id.A, dependencyType: 'FS', lagDays: 0 }] });
  const moved = (await getTasks(page, scheduleId)).find(t => t.id === late) as any;
  expect(ymd(moved.startDate)).toBe(plusDays(START, 7)); // the Monday after A ends on Fri 5 Mar
  expect(res.rescheduled.length).toBeGreaterThan(0);
});
