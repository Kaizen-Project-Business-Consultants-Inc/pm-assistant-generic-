import { test, expect, Page } from '@playwright/test';
import { signedIn, makeProject, makeTask, archiveProject, api } from './qa-data';
import { STAGING_USER, STAGING_TEAM_MEMBER } from './staging-helpers';
import { openSchedule, getTasks } from './schedule-helpers';

/**
 * Review → pick tasks (U81): findings and decision tasks can be ticked and clicked; the ticked tasks
 * are deleted after one question, Schedule History records it and its Undo puts them back.
 * Real staging, real server: the plan has tasks outside the project dates ("Dates outside project window").
 */
test.describe.configure({ mode: 'serial' });

let page: Page;
let projectId = '';
let scheduleId = '';

const NAMES = ['Outside A', 'Outside B', 'Outside C'];

test.beforeAll(async ({ browser }) => {
  page = await signedIn(browser, STAGING_USER);
  const made = await makeProject(page, 'QA – review pick tasks', '2027-01-04', '2027-03-26');
  projectId = made.projectId;
  scheduleId = made.scheduleId;
  await makeTask(page, scheduleId, { name: 'Inside', startDate: '2027-01-11', endDate: '2027-01-15' });
  for (const [i, name] of NAMES.entries()) {
    await makeTask(page, scheduleId, { name, startDate: `2027-0${4 + i}-05`, endDate: `2027-0${4 + i}-09` }); // after the project end
  }
  await api(page, 'post', `/api/v1/schedules/${scheduleId}/review`, {});
});

test.afterAll(async () => {
  if (projectId) await archiveProject(page, projectId);
  await page.context().close();
});

async function openReview() {
  await openSchedule(page, projectId, scheduleId, 'table');
  await page.getByRole('button', { name: 'Review', exact: true }).click();
  await expect(page.getByRole('dialog', { name: 'Schedule Review' })).toBeVisible();
}

test('click a finding to light its rows; tick it, Show in plan; Delete asks first, then Undo in History puts them back', async () => {
  await openReview();
  const panel = page.getByRole('dialog', { name: 'Schedule Review' });
  // the review gives one finding per task here: click the first, it is pressed
  const first = panel.getByRole('button', { name: /Show rows in the plan: Dates outside project window/ }).first();
  await first.click();
  await expect(first).toHaveAttribute('aria-pressed', 'true');

  await panel.getByRole('checkbox', { name: 'Select all in High' }).check();
  await expect(panel.getByText('3 findings ticked · 3 tasks')).toBeVisible();
  await panel.getByRole('button', { name: 'Delete 3 tasks…' }).click();
  await expect(panel.getByRole('alertdialog', { name: 'Delete tasks' })).toContainText('Delete 3 tasks?');
  await panel.getByRole('button', { name: 'Keep them' }).click();
  expect((await getTasks(page, scheduleId)).length).toBe(4); // nothing deleted

  await panel.getByRole('button', { name: 'Delete 3 tasks…' }).click();
  await panel.getByRole('button', { name: 'Yes, delete 3' }).click();
  await expect.poll(async () => (await getTasks(page, scheduleId)).map(t => t.name).sort(), { timeout: 20_000 }).toEqual(['Inside']);

  // one History entry; its Undo puts the three back
  const changes = await api<{ changes?: Array<{ id: string; kind: string; undoable: boolean }> }>(page, 'get', `/api/v1/schedules/${scheduleId}/changes`);
  const list = (changes.changes ?? changes) as Array<{ id: string; kind: string; undoable: boolean }>;
  expect(list[0].kind).toBe('bulk_delete');
  expect(list[0].undoable).toBe(true);
  await api(page, 'post', `/api/v1/schedules/${scheduleId}/changes/${list[0].id}/undo`, {});
  await expect.poll(async () => (await getTasks(page, scheduleId)).map(t => t.name).sort(), { timeout: 20_000 }).toEqual(['Inside', ...NAMES].sort());
});

test('Propose fixes lists the decision\'s tasks; tick one, Delete 1 task removes only it; the summary line follows', async () => {
  await openReview();
  await page.getByRole('dialog', { name: 'Schedule Review' }).getByRole('button', { name: /Propose fixes|Decisions needed/ }).click();
  const fixes = page.getByRole('dialog', { name: 'Propose fixes' });
  await expect(fixes).toBeVisible();
  await expect(fixes.getByText(/\d+ findings? → \d+ fixes? the app can make, 3 decisions for you\./)).toBeVisible({ timeout: 30_000 });
  const list = fixes.getByRole('list', { name: 'Tasks: Dates outside project window' });
  await expect(list.getByRole('checkbox')).toHaveCount(3);
  await expect(fixes.getByText(/These tasks run from .* 2027 to .* 2027\./)).toBeVisible();

  await list.getByRole('button', { name: /Outside B/ }).click(); // lights its row
  await list.getByRole('checkbox', { name: /Outside B/ }).check();
  await expect(fixes.getByText('1 task ticked')).toBeVisible();
  await fixes.getByRole('button', { name: 'Delete 1 task…' }).click();
  await fixes.getByRole('button', { name: 'Yes, delete 1' }).click();
  await expect.poll(async () => (await getTasks(page, scheduleId)).map(t => t.name).sort(), { timeout: 20_000 }).toEqual(['Inside', 'Outside A', 'Outside C']);
  // the review and proposal are made again: two tasks left in the decision
  await expect(fixes.getByRole('list', { name: 'Tasks: Dates outside project window' }).getByRole('checkbox')).toHaveCount(2, { timeout: 30_000 });
});

test('the server refuses a bulk delete from someone who is not a manager of the plan', async ({ browser }) => {
  const member = await signedIn(browser, STAGING_TEAM_MEMBER);
  try {
    // the team member is not on this plan: the delete route must refuse them
    const r = await member.request.delete('/api/v1/bulk/tasks', { data: { scheduleId, taskIds: ['00000000-0000-0000-0000-000000000000'] } });
    expect([401, 403, 404]).toContain(r.status());
  } finally {
    await member.context().close();
  }
});
