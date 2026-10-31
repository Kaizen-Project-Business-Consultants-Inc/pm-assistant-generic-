import { test, expect, Page } from '@playwright/test';
import { signedIn, makeProject, makeTask, archiveProject } from './qa-data';
import { STAGING_USER } from './staging-helpers';
import { openSchedule, getTasks, ganttCell, ganttRow, tableRow } from './schedule-helpers';

/**
 * Indent / outdent in the Gantt and Table (2026-10-30): right-click Outdent / Indent, the message
 * with Undo after any move, the "nothing to move" line, and the Gantt's selection line.
 * Own QA project on staging (archived at the end); every move is checked on the server too.
 */
test.describe.configure({ mode: 'serial' });

let page: Page;
let projectId = '';
let scheduleId = '';
let ids: { phase: string; a: string; b: string; solo: string };

const dates = { startDate: '2027-01-11', endDate: '2027-01-15' };
const parentOf = async (id: string) => (await getTasks(page, scheduleId)).find(t => t.id === id)?.parentTaskId ?? null;
const toast = () => page.getByTestId('undo-toast');
const notice = () => page.getByTestId('indent-notice');
const menu = () => page.getByRole('menu', { name: 'Row menu' });

test.beforeAll(async ({ browser }) => {
  page = await signedIn(browser, STAGING_USER);
  const made = await makeProject(page, 'QA – gantt indent', '2027-01-04', '2027-03-26');
  projectId = made.projectId;
  scheduleId = made.scheduleId;
  const phase = await makeTask(page, scheduleId, { name: 'Phase', ...dates });
  const a = await makeTask(page, scheduleId, { name: 'Task A', ...dates, parentTaskId: phase.id });
  const b = await makeTask(page, scheduleId, { name: 'Task B', ...dates, parentTaskId: phase.id });
  const solo = await makeTask(page, scheduleId, { name: 'Solo', ...dates });
  ids = { phase: phase.id, a: a.id, b: b.id, solo: solo.id };
});

test.afterAll(async () => {
  if (projectId) await archiveProject(page, projectId);
  await page.context().close();
});

test('Gantt right-click: Outdent moves the task, says so, and Undo puts it back', async () => {
  await openSchedule(page, projectId, scheduleId, 'gantt');
  await (await ganttCell(page, ids.b, 'Task Name')).click({ button: 'right' });
  await expect(menu()).toBeVisible();
  await expect(menu().getByRole('menuitem', { name: 'Outdent' })).toBeVisible();
  await expect(menu().getByRole('menuitem', { name: 'Indent' })).toBeVisible();
  await menu().getByRole('menuitem', { name: 'Outdent' }).click();
  await expect(toast()).toContainText('Outdented "Task B" to the top level.');
  await expect.poll(() => parentOf(ids.b)).toBeNull();
  await toast().getByRole('button', { name: 'Undo' }).click();
  await expect.poll(() => parentOf(ids.b)).toBe(ids.phase);
});

test('Gantt right-click: Indent puts the task under the row above, with a message', async () => {
  await (await ganttCell(page, ids.solo, 'Task Name')).click({ button: 'right' });
  await menu().getByRole('menuitem', { name: 'Indent' }).click();
  await expect(toast()).toContainText('Indented "Solo" under "Task B".');
  await expect.poll(() => parentOf(ids.solo)).toBe(ids.b);
  await toast().getByRole('button', { name: 'Undo' }).click();
  await expect.poll(() => parentOf(ids.solo)).toBeNull();
});

test('Gantt right-click: no Outdent / Indent where they would do nothing', async () => {
  await (await ganttCell(page, ids.phase, 'Task Name')).click({ button: 'right' });
  await expect(menu()).toBeVisible();
  await expect(menu().getByRole('menuitem', { name: 'Outdent' })).toHaveCount(0);
  await expect(menu().getByRole('menuitem', { name: 'Indent' })).toHaveCount(0);
  await page.keyboard.press('Escape');
  await expect(menu()).toHaveCount(0);
});

test('Gantt: Shift+Tab on a top-level task says why nothing moved', async () => {
  await (await ganttCell(page, ids.solo, 'Task Name')).click();
  await page.keyboard.press('Shift+Tab');
  await expect(notice()).toContainText('Nothing to outdent: "Solo" is already at the top level.');
  expect(await parentOf(ids.solo)).toBeNull();
});

test('Gantt: a line names the selected rows; Tab moves them; Escape clears the selection', async () => {
  const hint = page.getByTestId('gantt-selection-hint');
  await ganttRow(page, ids.solo).locator('input[type="checkbox"]').first().check();
  await expect(hint).toContainText('1 task selected: "Solo". Tab / Shift+Tab indent or outdent. Esc clears.');
  await page.keyboard.press('Tab');
  await expect(toast()).toContainText('Indented "Solo" under "Task B".');
  await expect.poll(() => parentOf(ids.solo)).toBe(ids.b);
  await page.keyboard.press('Shift+Tab');
  await expect.poll(() => parentOf(ids.solo)).toBeNull();
  await page.keyboard.press('Escape');
  await expect(hint).toHaveCount(0);
});

test('Table: right-click Outdent says what it did; Shift+Tab on a top-level task says why not', async () => {
  await openSchedule(page, projectId, scheduleId, 'table');
  await tableRow(page, ids.b).click({ button: 'right' });
  await menu().getByRole('menuitem', { name: 'Outdent' }).click();
  await expect(toast()).toContainText('Outdented "Task B" to the top level.');
  await expect.poll(() => parentOf(ids.b)).toBeNull();
  await toast().getByRole('button', { name: 'Undo' }).click();
  await expect.poll(() => parentOf(ids.b)).toBe(ids.phase);

  await tableRow(page, ids.solo).click();
  await page.keyboard.press('Shift+Tab');
  await expect(notice()).toContainText('Nothing to outdent: "Solo" is already at the top level.');
});
