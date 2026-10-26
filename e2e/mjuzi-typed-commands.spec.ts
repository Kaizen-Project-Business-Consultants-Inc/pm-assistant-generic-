import { test, expect, Page } from '@playwright/test';
import { signedIn, makeProject, makeTask, archiveProject, plusDays } from './qa-data';
import { STAGING_USER, STAGING_TEAM_MEMBER } from './staging-helpers';
import { openSchedule, getTasks } from './schedule-helpers';

/**
 * Mjuzi typed commands (A1b): a message that is exactly a command is done by the app — no Claude call —
 * with a Confirm for delete and an Undo (Schedule History) for the rest. Real staging, real server.
 */
test.describe.configure({ mode: 'serial' });

let page: Page;
let projectId = '';
let scheduleId = '';

const NAMES = ['Kickoff', 'Design', 'Build', 'Test'];

test.beforeAll(async ({ browser }) => {
  page = await signedIn(browser, STAGING_USER);
  const made = await makeProject(page, 'QA – typed commands', '2027-01-04', '2027-03-26');
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

const names = async () => (await getTasks(page, scheduleId)).map(t => t.name).sort();
const task = async (name: string) => (await getTasks(page, scheduleId)).find(t => t.name === name);

async function openChat() {
  await openSchedule(page, projectId, scheduleId, 'table');
  const box = page.getByLabel('Chat message input');
  // the panel stays open from a page before; the round button shows only when it is closed
  if (!(await box.isVisible())) await page.getByRole('button', { name: 'Open AI Assistant' }).click();
  await expect(box).toBeVisible();
}

async function type(text: string) {
  const box = page.getByLabel('Chat message input');
  await box.fill(text);
  await box.press('Enter');
}

test('help lists the commands and says no AI credit was used', async () => {
  await openChat();
  await type('help');
  await expect(page.getByText('Commands you can type')).toBeVisible();
  await expect(page.getByText('Done by the app · no AI cost').first()).toBeVisible();
});

test('rename changes the task at once; Undo puts the old name back', async () => {
  await type('rename 2 to "Detailed design"');
  await expect(page.getByText('Design → Detailed design')).toBeVisible();
  expect(await names()).toContain('Detailed design');
  await page.getByRole('button', { name: 'Undo' }).last().click();
  await expect(page.getByText('Undone.')).toBeVisible();
  await expect.poll(names).toEqual([...NAMES].sort());
});

test('delete asks first: Cancel keeps the task, Confirm deletes it, Undo brings it back', async () => {
  await type('delete task 3');
  await expect(page.getByText(/Delete task 3, Build\?/)).toBeVisible();
  await page.getByRole('button', { name: 'Cancel' }).last().click();
  await expect(page.getByText('Cancelled. Nothing was deleted.')).toBeVisible();
  expect(await names()).toEqual([...NAMES].sort());

  await type('delete task 3');
  await page.getByRole('button', { name: 'Confirm delete' }).last().click();
  await expect(page.getByText(/Deleted task 3, Build\./)).toBeVisible();
  await expect.poll(names).toEqual(['Design', 'Kickoff', 'Test']);
  await page.getByRole('button', { name: 'Undo' }).last().click();
  await expect(page.getByText('Undone.').last()).toBeVisible();
  await expect.poll(names).toEqual([...NAMES].sort());
});

test('link and unlink: 2 finishes before 3 starts, then not', async () => {
  await type('link 2 to 4');
  await expect(page.getByText(/Linked\. Design \(2\) must finish before Test \(4\) starts/)).toBeVisible();
  const design = await task('Design');
  await expect.poll(async () => (await task('Test'))?.dependencies?.map(d => d.dependencyId)).toContain(design!.id);

  await type('unlink 2 from 4');
  await expect(page.getByText(/Unlinked\. Test \(4\) no longer waits for Design \(2\)/)).toBeVisible();
  await expect.poll(async () => (await task('Test'))?.dependencies?.length ?? 0).toBe(0);
});

test('a date change that pushes the next task: one Undo puts back both tasks\' dates', async () => {
  await type('link 2 to 3');
  await expect(page.getByText(/Linked\. Design \(2\) must finish before Build \(3\) starts/)).toBeVisible();
  const before = { design: await task('Design'), build: await task('Build') };

  // Schedule History orders entries by the second: a person never types two commands within one, a test can
  await page.waitForTimeout(1500);
  await type('task 2 end 2027-02-05');
  await expect(page.getByText(/later task moved to follow/)).toBeVisible();
  await expect.poll(async () => (await task('Build'))?.startDate?.slice(0, 10)).not.toBe(before.build!.startDate!.slice(0, 10));

  await page.getByRole('button', { name: 'Undo' }).last().click();
  await expect(page.getByText('Undone.').last()).toBeVisible();
  await expect.poll(async () => (await task('Build'))?.startDate?.slice(0, 10)).toBe(before.build!.startDate!.slice(0, 10));
  expect((await task('Design'))?.endDate?.slice(0, 10)).toBe(before.design!.endDate!.slice(0, 10));
});

test('status, progress and a bad word', async () => {
  await type('task 1 status in progress');
  await expect.poll(async () => (await task('Kickoff'))?.status).toBe('in_progress');
  await type('task 1 progress 60');
  await expect.poll(async () => (await task('Kickoff'))?.progressPercentage).toBe(60);
  await type('task 1 status banana');
  await expect(page.getByText(/"banana" is not a status/)).toBeVisible();
  await type('delete task 99');
  await expect(page.getByText('There is no task 99. This plan has tasks 1 to 4.')).toBeVisible();
});

test('the app, not Claude, answers: the API says so, and a member who is not on the project is refused', async ({ browser }) => {
  const r = await page.request.post('/api/v1/ai-chat/message', { data: { message: 'help', context: { type: 'project', projectId, scheduleId } } });
  expect(r.status()).toBe(200);
  const body = await r.json();
  expect(body.aiPowered).toBe(false);
  expect(body.reply).toContain('Commands you can type');

  const member = await signedIn(browser, STAGING_TEAM_MEMBER);
  try {
    const denied = await member.request.post('/api/v1/ai-chat/message', { data: { message: 'rename 1 to "X"', context: { type: 'project', projectId, scheduleId } } });
    expect([403, 404]).toContain(denied.status());
    expect((await task('Kickoff'))?.name).toBe('Kickoff');
  } finally {
    await member.context().close();
  }
});
