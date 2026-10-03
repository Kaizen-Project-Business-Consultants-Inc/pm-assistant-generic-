import { test, expect, Page } from '@playwright/test';
import { STAGING_USER, STAGING_TEAM_MEMBER } from './staging-helpers';
import { signedIn, api, makeProject, makeTask, archiveProject, plusDays } from './qa-data';

/**
 * Weekly timesheets against real staging: the QA team member logs hours on a task, submits the
 * week to their line manager (the QA PM), the PM approves, and the task picks up the hours.
 * An approved week is final, so each run finds a week of its own that is still empty and open
 * (2027 onwards — never a locked month).
 */

let pm: Page;
let team: Page;
let ids: { projectId: string; scheduleId: string; task: string };
let W = ''; // a Monday
let fri = '';

test.describe.configure({ mode: 'serial' });

test.beforeAll(async ({ browser }) => {
  pm = await signedIn(browser, STAGING_USER);
  team = await signedIn(browser, STAGING_TEAM_MEMBER);
  // first week from a run-dependent start that nobody has logged anything on
  const start = Math.floor(Date.now() / 60_000) % 500;
  for (let i = 0; i < 40 && !W; i++) {
    const monday = plusDays('2027-01-04', (start + i) * 7);
    const week = await api(team, 'get', `/api/v1/time-entries/week?date=${monday}`);
    if (!week.sheet && week.lines.every((l: any) => !l.workedThisWeek) && week.lockedDays.length === 0) W = monday;
  }
  expect(W, 'an empty, open week for the timesheet test').not.toBe('');
  fri = plusDays(W, 4);
  const me = await api(team, 'get', '/api/v1/auth/me');
  const userId = me.user?.id ?? me.id;
  const resources = (await api(pm, 'get', '/api/v1/resources?limit=200')).resources as any[];
  const person = resources.find(r => r.userId === userId);
  expect(person, 'the QA team member needs a resource on the team').toBeTruthy();
  const p = await makeProject(pm, 'QA – e2e timesheet', W, plusDays(W, 30));
  await api(pm, 'post', `/api/v1/projects/${p.projectId}/members`, { userName: 'QA Team Member', email: STAGING_TEAM_MEMBER.username, role: 'viewer' });
  const task = await makeTask(pm, p.scheduleId, { name: 'E2E timesheet task', startDate: W, endDate: fri, assignedTo: person.id });
  ids = { ...p, task: task.id };
});

test.afterAll(async () => {
  if (ids) await archiveProject(pm, ids.projectId);
  await team?.context().close();
});

test('the team member sees the task with its planned hours, logs time and submits the week', async () => {
  for (const [date, hours] of [[W, 6], [plusDays(W, 1), 2]] as const) {
    await api(team, 'post', '/api/v1/time-entries', { taskId: ids.task, scheduleId: ids.scheduleId, projectId: ids.projectId, date, hours });
  }
  const week = await api(team, 'get', `/api/v1/time-entries/week?date=${W}`);
  const line = week.lines.find((l: any) => l.taskId === ids.task);
  expect(line).toMatchObject({ workedThisWeek: 8 });
  expect(line.plannedThisWeek).toBeGreaterThan(0);
  expect(week.approver?.userId).toBeTruthy();

  const sent = await api(team, 'post', '/api/v1/time-entries/week/submit', { date: W });
  expect(sent.status).toBe('submitted');
  // a submitted week can't take more hours
  const more = await team.request.post('/api/v1/time-entries', { data: { taskId: ids.task, scheduleId: ids.scheduleId, projectId: ids.projectId, date: plusDays(W, 2), hours: 1 } });
  expect(more.status()).toBeGreaterThanOrEqual(400);
  expect(more.status()).toBeLessThan(500);
});

test('the line manager approves it and the task picks up the hours', async () => {
  const { timesheets } = await api(pm, 'get', '/api/v1/time-entries/approvals');
  const sheet = (timesheets as any[]).find(s => s.weekStart === W);
  expect(sheet, `week of ${W} waiting for the PM`).toBeTruthy();
  await api(pm, 'post', `/api/v1/time-entries/timesheets/${sheet.id}/approve`, {});

  const week = await api(team, 'get', `/api/v1/time-entries/week?date=${W}`);
  expect(week.status).toBe('approved');
  const tasks = (await api(pm, 'get', `/api/v1/schedules/${ids.scheduleId}/tasks`)) as any;
  const t = (tasks.tasks ?? tasks.data ?? tasks).find((x: any) => x.id === ids.task);
  expect(Number(t.labourHours)).toBe(8);
  expect(t.status).toBe('in_progress');
  expect(t.progressPercentage).toBeGreaterThan(0);
  expect(t.progressPercentage).toBeLessThan(100);
});
