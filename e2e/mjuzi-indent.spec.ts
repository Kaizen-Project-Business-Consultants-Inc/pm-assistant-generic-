import { test, expect, Page } from '@playwright/test';
import { signedIn, makeProject, makeTask, archiveProject, plusDays, api } from './qa-data';
import { STAGING_USER } from './staging-helpers';
import { openSchedule, getTasks } from './schedule-helpers';

/**
 * Mjuzi can move existing tasks under a heading (indent_tasks, 2026-10-29): the same tasks (same ids,
 * so links and history stay), one Schedule History line, Undo puts them back. Real staging; this one
 * talks to Claude (a few cents of AI credit), so it asks in plain words and checks the plan, not the wording.
 */
test.describe.configure({ mode: 'serial' });

let page: Page;
let projectId = '';
let scheduleId = '';
const NAMES = ['Kickoff', 'Design', 'Build', 'Test'];

test.beforeAll(async ({ browser }) => {
  page = await signedIn(browser, STAGING_USER);
  const made = await makeProject(page, 'QA – Mjuzi indent', '2027-01-04', '2027-03-26');
  projectId = made.projectId;
  scheduleId = made.scheduleId;
  for (const [i, name] of NAMES.entries()) {
    const start = plusDays('2027-01-11', i * 7);
    await makeTask(page, scheduleId, { name, startDate: start, endDate: plusDays(start, 4) });
  }
});

test.afterAll(async () => {
  if (projectId) await archiveProject(page, projectId);
  await page.context().close();
});

const byName = async (name: string) => (await getTasks(page, scheduleId)).find(t => t.name === name);

test('asking Mjuzi to nest two tasks under a heading moves the same tasks, and Undo puts them back', async () => {
  test.setTimeout(180_000);
  await openSchedule(page, projectId, scheduleId, 'table');
  const box = page.getByLabel('Chat message input');
  if (!(await box.isVisible())) await page.getByRole('button', { name: 'Open AI Assistant' }).click();
  await expect(box).toBeVisible();

  const before = await getTasks(page, scheduleId);
  const ids = Object.fromEntries(before.map(t => [t.name, t.id]));
  const kickoffBefore = before.find(t => t.name === 'Kickoff')!;

  await box.fill('Put Design and Build under Kickoff, so Kickoff becomes their heading. Move the existing tasks; do not delete or recreate them.');
  await box.press('Enter');

  // the plan changes (the model may take a moment)
  await expect.poll(async () => (await byName('Design'))?.parentTaskId, { timeout: 120_000 }).toBe(ids.Kickoff);
  expect((await byName('Build'))?.parentTaskId).toBe(ids.Kickoff);
  // the same tasks: nothing was deleted and recreated, and the one left alone stayed at the top
  const after = await getTasks(page, scheduleId);
  expect(after.map(t => t.id).sort()).toEqual(before.map(t => t.id).sort());
  expect((await byName('Test'))?.parentTaskId ?? null).toBeNull();

  // one Schedule History line, and its Undo puts both back at the top
  const { changes } = await api<{ changes: Array<{ id: string; summary: string; undoable: boolean }> }>(page, 'get', `/api/v1/schedules/${scheduleId}/changes`);
  expect(changes[0].summary).toMatch(/(Moved|Indented) 2 tasks under row 1/);
  expect(changes[0].undoable).toBe(true);
  await api(page, 'post', `/api/v1/schedules/${scheduleId}/changes/${changes[0].id}/undo`);
  expect((await byName('Design'))?.parentTaskId ?? null).toBeNull();
  expect((await byName('Build'))?.parentTaskId ?? null).toBeNull();
  // Kickoff was a plain task with its own dates before it became a heading (the roll-up rewrote them): Undo gives them back
  const kickoffAfter = (await byName('Kickoff'))!;
  expect(kickoffAfter.startDate?.slice(0, 10)).toBe(kickoffBefore.startDate?.slice(0, 10));
  expect(kickoffAfter.endDate?.slice(0, 10)).toBe(kickoffBefore.endDate?.slice(0, 10));
  expect(kickoffAfter.isSummary).toBeFalsy();
});
