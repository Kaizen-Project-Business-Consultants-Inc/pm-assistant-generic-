import { test, expect, Page } from '@playwright/test';
import { signedIn, makeProject, makeTask, archiveProject, api } from './qa-data';
import { STAGING_USER } from './staging-helpers';
import { openSchedule, getTasks, ganttRow } from './schedule-helpers';

/**
 * Deleting a summary task that has tasks under it asks "heading only, or its tasks too?" (2026-10-29).
 * Own QA project on staging; every step is checked against the server's task list, not just the screen.
 */
test.describe.configure({ mode: 'serial' });

let page: Page;
let projectId = '';
let scheduleId = '';
let ids: { phase: string; head: string; kid: string; inner: string; deep: string; plain: string };

const dates = { startDate: '2027-01-11', endDate: '2027-01-15' };
const names = async () => (await getTasks(page, scheduleId)).map(t => t.name).sort();
const parentOf = async (name: string) => (await getTasks(page, scheduleId)).find(t => t.name === name)?.parentTaskId ?? null;
const lastChange = async () => {
  const r = await api<any>(page, 'get', `/api/v1/schedules/${scheduleId}/changes`);
  return ((r.changes ?? r) as Array<{ id: string; kind: string; undoable: boolean }>)[0];
};

test.beforeAll(async ({ browser }) => {
  page = await signedIn(browser, STAGING_USER);
  const made = await makeProject(page, 'QA – delete summary', '2027-01-04', '2027-03-26');
  projectId = made.projectId;
  scheduleId = made.scheduleId;
  const phase = await makeTask(page, scheduleId, { name: 'Phase', ...dates });
  const head = await makeTask(page, scheduleId, { name: 'Heading', ...dates, parentTaskId: phase.id });
  const kid = await makeTask(page, scheduleId, { name: 'Child', ...dates, parentTaskId: head.id });
  const inner = await makeTask(page, scheduleId, { name: 'Inner heading', ...dates, parentTaskId: head.id });
  const deep = await makeTask(page, scheduleId, { name: 'Deep child', ...dates, parentTaskId: inner.id });
  const plain = await makeTask(page, scheduleId, { name: 'Plain', ...dates });
  ids = { phase: phase.id, head: head.id, kid: kid.id, inner: inner.id, deep: deep.id, plain: plain.id };
});

test.afterAll(async () => {
  if (projectId) await archiveProject(page, projectId);
  await page.context().close();
});

test('heading only: its tasks stay and move up a level; Undo puts everything back as it was', async () => {
  await api(page, 'delete', `/api/v1/bulk/tasks`, { scheduleId, taskIds: [ids.head], children: 'keep' });
  expect(await names()).toEqual(['Child', 'Deep child', 'Inner heading', 'Phase', 'Plain']);
  expect(await parentOf('Child')).toBe(ids.phase);
  expect(await parentOf('Inner heading')).toBe(ids.phase);
  expect(await parentOf('Deep child')).toBe(ids.inner); // untouched

  const change = await lastChange();
  expect(change.kind).toBe('bulk_delete');
  await api(page, 'post', `/api/v1/schedules/${scheduleId}/changes/${change.id}/undo`, {});
  expect(await names()).toEqual(['Child', 'Deep child', 'Heading', 'Inner heading', 'Phase', 'Plain']);
  expect(await parentOf('Child')).toBe(ids.head);
  expect(await parentOf('Inner heading')).toBe(ids.head);
  expect(await parentOf('Heading')).toBe(ids.phase);
});

test('heading and its tasks: every level below goes in one step; Undo brings them all back', async () => {
  await api(page, 'delete', `/api/v1/schedules/${scheduleId}/tasks/${ids.head}?children=delete`);
  expect(await names()).toEqual(['Phase', 'Plain']);
  const change = await lastChange();
  await api(page, 'post', `/api/v1/schedules/${scheduleId}/changes/${change.id}/undo`, {});
  expect(await names()).toEqual(['Child', 'Deep child', 'Heading', 'Inner heading', 'Phase', 'Plain']);
  expect(await parentOf('Deep child')).toBe(ids.inner);
});

test('a refused children value changes nothing', async () => {
  const r = await page.request.delete('/api/v1/bulk/tasks', { data: { scheduleId, taskIds: [ids.head], children: 'everything' } });
  expect(r.status()).toBe(400);
  expect(await names()).toHaveLength(6);
});

test('in the Gantt: Delete on a heading asks; Cancel and Escape change nothing; "heading only" keeps the tasks', async () => {
  await openSchedule(page, projectId, scheduleId, 'gantt');
  const pick = async () => {
    await ganttRow(page, ids.head).locator(':scope > div').first().click({ modifiers: ['Control'] });
    await page.getByRole('button', { name: 'Delete', exact: true }).first().click();
  };

  await pick();
  const dlg = page.getByRole('alertdialog', { name: 'Delete "Heading"?' });
  await expect(dlg).toBeVisible();
  await expect(dlg).toContainText('This heading has 3 tasks under it');
  await expect(dlg.getByRole('button', { name: /Delete the heading only/ })).toBeFocused();
  await page.keyboard.press('Escape');
  await expect(dlg).toBeHidden();
  expect(await names()).toHaveLength(6);

  await pick();
  await dlg.getByRole('button', { name: 'Cancel' }).click();
  expect(await names()).toHaveLength(6);

  await pick();
  await dlg.getByRole('button', { name: /Delete the heading only/ }).click();
  await expect.poll(names).toEqual(['Child', 'Deep child', 'Inner heading', 'Phase', 'Plain']);
  await expect(page.getByText("Deleted 'Heading'. 3 tasks kept").first()).toBeVisible();
  expect(await parentOf('Child')).toBe(ids.phase);

  await page.keyboard.press('Control+z');
  await expect.poll(names).toEqual(['Child', 'Deep child', 'Heading', 'Inner heading', 'Phase', 'Plain']);
});

test('in the Gantt: "heading and its tasks" deletes them all with one Undo; a plain task gets no choice', async () => {
  await openSchedule(page, projectId, scheduleId, 'gantt');
  await ganttRow(page, ids.head).locator(':scope > div').first().click({ modifiers: ['Control'] });
  await page.getByRole('button', { name: 'Delete', exact: true }).first().click();
  await page.getByRole('alertdialog', { name: 'Delete "Heading"?' }).getByRole('button', { name: /Delete the heading and its 3 tasks/ }).click();
  await expect.poll(names).toEqual(['Phase', 'Plain']);
  await expect(page.getByText("Deleted 'Heading' and 3 tasks").first()).toBeVisible();
  await page.keyboard.press('Control+z');
  await expect.poll(names).toEqual(['Child', 'Deep child', 'Heading', 'Inner heading', 'Phase', 'Plain']);

  await ganttRow(page, ids.plain).locator(':scope > div').first().click({ modifiers: ['Control'] });
  await page.getByRole('button', { name: 'Delete', exact: true }).first().click();
  await expect(page.getByRole('alertdialog')).toHaveCount(0);
  await expect(page.getByRole('dialog', { name: /Delete/ })).toBeVisible();
});
