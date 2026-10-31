import { test, expect, Page } from '@playwright/test';
import { STAGING_USER, STAGING_TEAM_MEMBER } from './staging-helpers';
import { signedIn, api, makeProject, makeTask, archiveProject, thisMonday, plusDays } from './qa-data';

/**
 * "No task longer than one reporting period" (warn only), against real staging. The spec makes its own
 * project (new projects have the warning ON), adds a short task, a 12-day task and a 62-hour task, and
 * goes through the real path: the review warns about the two long ones, "Cannot be split" asks why and
 * takes one out, switching to 2 weeks changes the limit, switching the warning off clears it; the weekly
 * review lists what is not finished; a team member never sees any of it. The project is archived at the end.
 */
test.describe.configure({ mode: 'serial' });

let pm: Page;
let team: Page;
let ids: { projectId: string; scheduleId: string };
let longTaskId = '';
let heavyTaskId = '';

const start = plusDays(thisMonday(), 7);
const reviewFindings = async () => {
  const r = await api<{ findings: Array<{ ruleId: string; taskIds: string[]; message: string }> }>(pm, 'post', `/api/v1/schedules/${ids.scheduleId}/review`, {});
  return r.findings.filter(f => f.ruleId === 'R42');
};

test.beforeAll(async ({ browser }) => {
  pm = await signedIn(browser, STAGING_USER);
  team = await signedIn(browser, STAGING_TEAM_MEMBER);
  ids = await makeProject(pm, 'QA – e2e reporting period', plusDays(thisMonday(), -28), plusDays(thisMonday(), 90));
  await makeTask(pm, ids.scheduleId, { name: 'E2E short job', startDate: start, endDate: plusDays(start, 2), estimatedDays: 3 });
  longTaskId = (await makeTask(pm, ids.scheduleId, { name: 'E2E build login screens', startDate: start, endDate: plusDays(start, 15), estimatedDays: 12 })).id;
  heavyTaskId = (await makeTask(pm, ids.scheduleId, { name: 'E2E data migration', startDate: start, endDate: plusDays(start, 2), estimatedDays: 3, workHours: 62 })).id;
  // one task planned to finish last week and not done, one done on time
  await makeTask(pm, ids.scheduleId, { name: 'E2E vendor sign-off', startDate: plusDays(thisMonday(), -14), endDate: plusDays(thisMonday(), -10), estimatedDays: 5, status: 'in_progress' });
  await makeTask(pm, ids.scheduleId, { name: 'E2E finished on time', startDate: plusDays(thisMonday(), -14), endDate: plusDays(thisMonday(), -10), estimatedDays: 5, status: 'completed', progressPercentage: 100 });
  await api(pm, 'post', `/api/v1/projects/${ids.projectId}/members`, { userName: 'QA Team Member', email: STAGING_TEAM_MEMBER.username, role: 'viewer' });
});

test.afterAll(async () => {
  if (ids) await archiveProject(pm, ids.projectId);
});

test('a new project has the warning on, 1 week, and a worked-out limit', async () => {
  const p = (await api<any>(pm, 'get', `/api/v1/projects/${ids.projectId}`)).project;
  expect(p.periodRuleEnabled).toBe(true);
  expect(p.reportingPeriod).toBe('week');
  const limit = await api<{ workingDays: number; hours: number; text: string }>(pm, 'get', `/api/v1/projects/${ids.projectId}/reporting-period-limit?period=week`);
  expect(limit.workingDays).toBeGreaterThan(0);
  expect(limit.workingDays).toBeLessThanOrEqual(5);
  expect(limit.text).toBe(`${limit.workingDays} working day${limit.workingDays === 1 ? '' : 's'} / ${limit.hours} hours`);
});

test('the review warns about the 12-day task and the 62-hour task, not the short one', async () => {
  const f = await reviewFindings();
  expect(f.map(x => x.taskIds[0]).sort()).toEqual([longTaskId, heavyTaskId].sort());
  expect(f.find(x => x.taskIds[0] === longTaskId)!.message).toContain('12 working days');
  expect(f.find(x => x.taskIds[0] === heavyTaskId)!.message).toContain('62 hours');
});

test('in the Review panel: Go to task, then Cannot be split asks why and the task becomes an accepted exception', async () => {
  await pm.goto(`/project/${ids.projectId}?tab=schedule`);
  await pm.getByRole('button', { name: 'Review', exact: true }).first().click();
  const panel = pm.getByRole('dialog', { name: 'Schedule Review' });
  await expect(panel).toBeVisible();
  await panel.getByRole('button', { name: /^Medium/ }).click();
  await expect(panel.getByText(/it runs 12 working days/)).toBeVisible();
  await panel.getByRole('button', { name: 'Go to task: E2E build login screens' }).click();

  await panel.getByRole('button', { name: 'Cannot be split: E2E build login screens' }).click();
  const save = panel.getByRole('button', { name: 'Save exception' });
  await expect(save).toBeDisabled();
  await panel.getByLabel(/Why can it not be split/).fill('One vendor delivers it as a single drop');
  await save.click();

  await expect(panel.getByText('Accepted exceptions (1)')).toBeVisible({ timeout: 20_000 });
  await expect(panel.getByText('One vendor delivers it as a single drop')).toBeVisible();
  await expect(panel.getByText(/it runs 12 working days/)).toHaveCount(0);
  await expect(panel.getByText(/planned effort is 62 hours/)).toBeVisible();

  const { exceptions } = await api<{ exceptions: Array<{ taskId: string; reason: string; createdByName: string; createdAt: string }> }>(pm, 'get', `/api/v1/schedules/${ids.scheduleId}/review/exceptions`);
  expect(exceptions).toHaveLength(1);
  expect(exceptions[0]).toMatchObject({ taskId: longTaskId, reason: 'One vendor delivers it as a single drop' });
  expect(exceptions[0].createdByName).toContain('qa.pm');
  expect(exceptions[0].createdAt).toBeTruthy();
  expect((await reviewFindings()).map(x => x.taskIds[0])).toEqual([heavyTaskId]);
});

test('Remove puts the accepted task back into the count, and Cannot be split can be done again', async () => {
  const r = await api<{ exceptions: unknown[]; review: { findings: Array<{ ruleId: string }> } }>(pm, 'delete', `/api/v1/schedules/${ids.scheduleId}/review/exceptions/${longTaskId}`);
  expect(r.exceptions).toHaveLength(0);
  expect(r.review.findings.filter(f => f.ruleId === 'R42')).toHaveLength(2);
  const again = await pm.request.delete(`/api/v1/schedules/${ids.scheduleId}/review/exceptions/${longTaskId}`);
  expect(again.status()).toBe(404);
  await api(pm, 'post', `/api/v1/schedules/${ids.scheduleId}/review/exceptions`, { taskId: longTaskId, reason: 'Still one drop from the vendor' });
  expect((await reviewFindings()).map(x => x.taskIds[0])).toEqual([heavyTaskId]);
});

test('a reason is required, and a task from another plan is refused', async () => {
  const blank = await pm.request.post(`/api/v1/schedules/${ids.scheduleId}/review/exceptions`, { data: { taskId: heavyTaskId, reason: '  ' } });
  expect(blank.status()).toBe(400);
  const stranger = await pm.request.post(`/api/v1/schedules/${ids.scheduleId}/review/exceptions`, { data: { taskId: '00000000-0000-0000-0000-000000000000', reason: 'Not on this plan' } });
  expect(stranger.status()).toBe(404);
});

test('Edit project: 2 weeks changes the limit and the 62-hour task is no longer over it', async () => {
  await pm.goto(`/project/${ids.projectId}`);
  await pm.getByRole('button', { name: 'Edit', exact: true }).click();
  const dialog = pm.getByRole('dialog', { name: 'Edit Project' });
  const limit = dialog.getByLabel('Limit used for this project');
  await expect(limit).toHaveValue(/\d+ working days? \/ [\d.]+ hours/, { timeout: 15_000 });
  const weekText = await limit.inputValue();
  await expect(limit).toHaveAttribute('readonly', '');
  await expect(dialog.getByLabel('Warn about tasks longer than one reporting period')).toBeChecked();
  await dialog.getByLabel('How often you report status').selectOption('two_weeks');
  await expect(limit).not.toHaveValue(weekText);
  await expect(limit).toHaveValue(/(9|10) working days? \/ /);
  await dialog.getByRole('button', { name: 'Save Changes' }).click();
  await expect(dialog).toBeHidden({ timeout: 15_000 });

  const p = (await api<any>(pm, 'get', `/api/v1/projects/${ids.projectId}`)).project;
  expect(p.reportingPeriod).toBe('two_weeks');
  expect(await reviewFindings()).toEqual([]); // 3 days and 62 hours both fit in 2 weeks (the 12-day one is accepted)
});

test('switching the warning off removes it, and back on brings it back', async () => {
  await api(pm, 'put', `/api/v1/projects/${ids.projectId}`, { periodRuleEnabled: false, reportingPeriod: 'week' });
  expect(await reviewFindings()).toEqual([]);
  await api(pm, 'put', `/api/v1/projects/${ids.projectId}`, { periodRuleEnabled: true });
  expect((await reviewFindings()).map(x => x.taskIds[0])).toEqual([heavyTaskId]);
});

test('weekly review lists what is not finished, and only that', async () => {
  const r = await api<{ asOf: string; total: number; tasks: Array<{ name: string; status: string; plannedFinish: string }> }>(pm, 'get', `/api/v1/projects/${ids.projectId}/weekly-review/not-finished`);
  expect(r.tasks.map(t => t.name)).toEqual(['E2E vendor sign-off']);
  expect(r.total).toBe(1);
  await pm.goto(`/project/${ids.projectId}?tab=weekly-review`);
  const table = pm.getByRole('region', { name: 'Not finished this period' });
  if (!(await table.isVisible().catch(() => false))) {
    await pm.getByRole('button', { name: 'Run my weekly review' }).click();
  }
  await expect(table).toBeVisible({ timeout: 30_000 });
  await expect(table.getByRole('row', { name: /E2E vendor sign-off.*Late/ })).toBeVisible();
  await expect(table.getByText('E2E finished on time')).toHaveCount(0);
});

test('a team member sees none of it', async () => {
  for (const [method, url, data] of [
    ['get', `/api/v1/schedules/${ids.scheduleId}/review/exceptions`, undefined],
    ['post', `/api/v1/schedules/${ids.scheduleId}/review/exceptions`, { taskId: heavyTaskId, reason: 'I say so' }],
    ['delete', `/api/v1/schedules/${ids.scheduleId}/review/exceptions/${longTaskId}`, undefined],
    ['get', `/api/v1/projects/${ids.projectId}/reporting-period-limit?period=week`, undefined],
    ['get', `/api/v1/projects/${ids.projectId}/weekly-review/not-finished`, undefined],
  ] as const) {
    const res = method === 'get' ? await team.request.get(url) : method === 'delete' ? await team.request.delete(url) : await team.request.post(url, { data });
    expect([401, 403, 404], `${method} ${url} gave ${res.status()}`).toContain(res.status());
  }
  const { exceptions } = await api<{ exceptions: unknown[] }>(pm, 'get', `/api/v1/schedules/${ids.scheduleId}/review/exceptions`);
  expect(exceptions).toHaveLength(1); // the refused post saved nothing
  // and the project page offers them no Edit button, no warning setting
  await team.goto(`/project/${ids.projectId}`);
  await expect(team.getByRole('button', { name: 'Edit', exact: true })).toHaveCount(0);
});
