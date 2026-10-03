import { test, expect, Page } from '@playwright/test';
import { STAGING_USER } from './staging-helpers';
import { signedIn, api, makeProject, makeTask, archiveProject, thisMonday, plusDays, day } from './qa-data';

/**
 * Money spent includes expenses everywhere (2026-10-03), and EVM's actual cost counts what was
 * spent by each date. Real staging, as the QA PM, on a project the spec makes and archives.
 */

let pm: Page;
let ids: { projectId: string; scheduleId: string };
let expenseId = '';
const today = day(new Date());

const spentOf = async () => Number((await api(pm, 'get', `/api/v1/projects/${ids.projectId}`)).project.budgetSpent ?? 0);

test.describe.configure({ mode: 'serial' });

test.beforeAll(async ({ browser }) => {
  pm = await signedIn(browser, STAGING_USER);
  ids = await makeProject(pm, 'QA – e2e financials', plusDays(thisMonday(), -14), plusDays(thisMonday(), 40));
  await api(pm, 'put', `/api/v1/projects/${ids.projectId}`, { budgetAllocated: 50000 });
  await makeTask(pm, ids.scheduleId, { name: 'E2E work', startDate: plusDays(thisMonday(), -14), endDate: plusDays(thisMonday(), 30), progressPercentage: 20 });
});

test.afterAll(async () => {
  if (ids) await archiveProject(pm, ids.projectId);
});

test('an expense raises the project\'s spent, and EVM counts it from its date', async () => {
  const before = await spentOf();
  expenseId = (await api(pm, 'post', '/api/v1/expenses', { projectId: ids.projectId, date: today, amount: 500, category: 'software', description: 'E2E licence' })).expense.id;
  expect(await spentOf()).toBe(before + 500);

  const evm = await api(pm, 'get', `/api/v1/evm-forecast/${ids.projectId}`);
  expect(evm.sample, 'the QA PM must not be on a trial (sample EVM data)').toBeFalsy();
  const metrics = evm.result.currentMetrics;
  expect(metrics.AC).toBe(before + 500);
});

test('Financials shows spent as the total, without adding expenses twice', async () => {
  const spent = await spentOf();
  await pm.goto(`/project/${ids.projectId}`);
  await pm.getByRole('tab', { name: 'Financials' }).or(pm.getByRole('button', { name: 'Financials', exact: true })).first().click();
  const card = pm.locator('div', { has: pm.getByText('Total Spent', { exact: true }) }).last();
  await expect(card).toContainText(`$${spent.toLocaleString('en-US')}`, { timeout: 20_000 });
  await expect(card).toContainText('expenses $500');
});

test('removing the expense takes it off spent again', async () => {
  const before = await spentOf();
  await api(pm, 'delete', `/api/v1/expenses/${expenseId}`);
  expect(await spentOf()).toBe(before - 500);
});
