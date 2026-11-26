import { test, expect, Page } from '@playwright/test';
import { signedIn, makeProject, archiveProject } from './qa-data';
import { STAGING_USER } from './staging-helpers';
import { openSchedule, getTasks, tableHeaders } from './schedule-helpers';

/**
 * One Assigned To instead of Assigned To + Resource (2026-11-26): the task form has one list of people
 * (first = main), the Table and Gantt show "Main +N", and there is no Resource column any more.
 * Own QA project, archived afterwards.
 */
test.describe.configure({ mode: 'serial' });

let page: Page;
let projectId = '';
let scheduleId = '';
const stamp = Date.now().toString(36);
const WHO = [`Merge Ann ${stamp} Test`, `Merge Bo ${stamp} Test`];

test.beforeAll(async ({ browser }) => {
  page = await signedIn(browser, STAGING_USER);
  const made = await makeProject(page, 'QA – assigned merge', '2027-02-01', '2027-04-30');
  projectId = made.projectId;
  scheduleId = made.scheduleId;
  await page.addInitScript((p) => {
    try { localStorage.setItem(`readiness-dismissed-${p}`, '1'); localStorage.setItem(`schedule-view-mode-${p}`, 'table'); } catch { /* private window */ }
  }, projectId);
  await page.goto(`/project/${projectId}?tab=schedule`);
  await expect(page.getByRole('button', { name: 'More actions' })).toBeVisible({ timeout: 30_000 });
  // two tasks and two people, made by an import (the people come from the Responsibility column)
  await page.getByRole('button', { name: 'More actions' }).click();
  await page.getByRole('button', { name: /^Import/ }).first().click();
  const csv = ['Task Name,Responsibility,Start Date,End Date', `Task one,${WHO[0]},2027-02-01,2027-02-05`, `Task two,${WHO[1]},2027-02-08,2027-02-12`].join('\n');
  await page.getByLabel('Choose a file to import').setInputFiles({ name: 'who.csv', mimeType: 'text/csv', buffer: Buffer.from(csv) });
  await page.getByRole('button', { name: /^Import 2 rows/ }).click();
  await expect(page.getByText(/2 people added/i)).toBeVisible({ timeout: 30_000 });
  await page.getByRole('button', { name: /close/i }).first().click().catch(() => page.keyboard.press('Escape'));
});

test.afterAll(async () => {
  if (projectId) await archiveProject(page, projectId);
  await page.context().close();
});

test('there is no Resource column; Assigned To is the one people column', async () => {
  await openSchedule(page, projectId, scheduleId, 'table');
  const headers = await tableHeaders(page);
  expect(headers).toContain('Assigned To');
  expect(headers).not.toContain('Resource');
  await page.getByRole('button', { name: /^Columns/ }).click();
  await expect(page.getByRole('menu, dialog, listbox').getByText(/^Resource$/)).toHaveCount(0);
  await page.keyboard.press('Escape');
});

test('adding a second person in the task form shows "Main +1", survives a reload, and the Gantt agrees', async () => {
  await openSchedule(page, projectId, scheduleId, 'table');
  await page.getByRole('button', { name: 'Edit Task one' }).click();
  const form = page.getByRole('dialog');
  await expect(form.getByText(/^Assigned To \(1\/10\)/)).toBeVisible();
  await expect(form.getByText('Resource Assignments')).toHaveCount(0); // the old second section is gone
  await form.getByRole('button', { name: '+ Add person' }).click();
  await form.getByRole('button', { name: 'Assigned To, person 2' }).click();
  await page.getByRole('textbox', { name: 'Search resources' }).fill(WHO[1]);
  await page.getByRole('button', { name: new RegExp(WHO[1]) }).first().click();
  await form.getByRole('button', { name: /^Save|Update/ }).click();
  await expect(form).toBeHidden({ timeout: 15_000 });

  const t = (await getTasks(page, scheduleId)).find(x => x.name === 'Task one') as any;
  expect(t.assignments.map((a: any) => a.resourceId)).toHaveLength(2); // main + the second person
  expect(t.assignedTo).toBe(t.assignments[0].resourceId); // the first person is the main one

  await openSchedule(page, projectId, scheduleId, 'table');
  const table = page.locator('table[role="treegrid"]');
  await expect(table.getByText(`${WHO[0]} +1`)).toBeVisible();
  await expect(table.getByText(`${WHO[1]}`).first()).toBeVisible();
  await openSchedule(page, projectId, scheduleId, 'gantt');
  await expect(page.getByRole('treegrid', { name: 'Task list' }).getByText(`${WHO[0]} +1`)).toBeVisible();
});

test('taking the second person off in the form is saved (back to one person), and so is Unassign in the cell', async () => {
  await openSchedule(page, projectId, scheduleId, 'table');
  await page.getByRole('button', { name: 'Edit Task one' }).click();
  const form = page.getByRole('dialog');
  await form.getByRole('button', { name: 'Remove person 2' }).click();
  await form.getByRole('button', { name: /^Save|Update/ }).click();
  await expect(form).toBeHidden({ timeout: 15_000 });
  let t = (await getTasks(page, scheduleId)).find(x => x.name === 'Task one') as any;
  expect((t.assignments ?? []).map((a: any) => a.resourceId)).toHaveLength(1);
  await openSchedule(page, projectId, scheduleId, 'table');
  await expect(page.locator('table[role="treegrid"]').getByText(`${WHO[0]} +1`)).toHaveCount(0);
  await expect(page.locator('table[role="treegrid"]').getByText(WHO[0], { exact: true })).toBeVisible();
});

test('a task with one person stays plain: no list stored, no "+N"', async () => {
  const t = (await getTasks(page, scheduleId)).find(x => x.name === 'Task two') as any;
  expect(t.assignments ?? []).toHaveLength(0);
  await openSchedule(page, projectId, scheduleId, 'table');
  await expect(page.locator('table[role="treegrid"]').getByText(WHO[1], { exact: true })).toBeVisible();
});
