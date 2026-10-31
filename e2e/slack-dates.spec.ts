import { test, expect, Page } from '@playwright/test';
import { signedIn, makeProject, makeTask, archiveProject, api } from './qa-data';
import { STAGING_USER } from './staging-helpers';
import { openSchedule, ganttCell } from './schedule-helpers';

/**
 * Total slack follows the dates the user set (2026-10-31). A chain dated weeks after day one
 * used to read "free to start on day one" (huge false slack), and a finished task showed slack.
 * Own QA project on staging (archived at the end): a long chain ending Fri 26 Mar 2027, a shorter
 * chain with NO predecessor on its first task dated later and ending Fri 19 Mar (5 working days
 * of slack), and a completed task in front of it (a dash, not critical).
 */
test.describe.configure({ mode: 'serial' });

let page: Page;
let projectId = '';
let scheduleId = '';
const id: Record<string, string> = {};
const fs = (dependencyId: string) => [{ dependencyId, dependencyType: 'FS', lagDays: 0 }];

test.beforeAll(async ({ browser }) => {
  page = await signedIn(browser, STAGING_USER);
  const made = await makeProject(page, 'QA – slack dates', '2027-01-04', '2027-03-26');
  projectId = made.projectId;
  scheduleId = made.scheduleId;
  const mk = async (key: string, name: string, startDate: string, endDate: string, extra: Record<string, unknown> = {}) => {
    id[key] = (await makeTask(page, scheduleId, { name, startDate, endDate, ...extra })).id;
  };
  await mk('x1', 'Long one', '2027-01-04', '2027-01-29');
  await mk('x2', 'Long two', '2027-02-01', '2027-03-26', { dependencies: fs(id.x1) });
  await mk('done', 'Finished work', '2027-01-04', '2027-01-08');
  await api(page, 'put', `/api/v1/schedules/${scheduleId}/tasks/${id.done}`, { status: 'completed', progressPercentage: 100 });
  await mk('y1', 'Short one', '2027-02-01', '2027-02-26', { dependencies: fs(id.done) }); // dated later, only the finished task before it
  await mk('y2', 'Short two', '2027-03-01', '2027-03-19', { dependencies: fs(id.y1) });
});

test.afterAll(async () => {
  if (projectId) await archiveProject(page, projectId);
  await page.close();
});

test('the API gives dated slack: 0 on the long chain, 5 on the shorter one, none for the finished task', async () => {
  const cpm = await api<any>(page, 'get', `/api/v1/schedules/${scheduleId}/critical-path`);
  const rows = (cpm.data ?? cpm).tasks as Array<{ taskId: string; totalFloat: number | null; isCritical: boolean }>;
  const of = (k: string) => rows.find(r => r.taskId === id[k])!;
  expect([of('x1').totalFloat, of('x2').totalFloat]).toEqual([0, 0]);
  expect([of('y1').totalFloat, of('y2').totalFloat]).toEqual([5, 5]);
  expect(of('done').totalFloat).toBeNull();
  expect(of('done').isCritical).toBe(false);
});

test('the Gantt Slack column shows the same, and a dash for the finished task', async () => {
  await openSchedule(page, projectId, scheduleId, 'gantt');
  const slack = async (k: string) => (await ganttCell(page, id[k], 'Slack')).textContent();
  await expect.poll(() => slack('x2')).toBe('0 d');
  expect(await slack('x1')).toBe('0 d');
  expect(await slack('y1')).toBe('5 d');
  expect(await slack('y2')).toBe('5 d');
  expect(await slack('done')).toBe('—');
});
