import { test, expect } from '@playwright/test';
import { login } from './helpers';

async function navigateToGantt(page: import('@playwright/test').Page) {
  // The first project that has a plan (the first one listed may have none — 2026-10-03 the
  // list started with a project without a schedule and every test here failed)
  await page.goto('/projects');
  const firstProject = page.locator('a[href^="/project/"]').first();
  await expect(firstProject).toBeVisible({ timeout: 10_000 });
  const hrefs = await page.locator('a[href^="/project/"]').evaluateAll(as => [...new Set(as.map(a => a.getAttribute('href')))]);
  let href: string | null = null;
  for (const h of hrefs) {
    const id = String(h).split('/')[2]?.split('?')[0];
    const r = await page.request.get(`/api/v1/schedules/project/${id}`);
    const body = r.ok() ? await r.json() : {};
    if ((body.schedules ?? body.data ?? body ?? []).length > 0) { href = `/project/${id}`; break; }
  }
  expect(href, 'no project with a schedule for this login').not.toBeNull();
  await page.goto(`${href}?tab=schedule`);
  // Wait for the Gantt table to load
  await expect(
    page.locator('table, [class*="gantt"], canvas, svg').first()
  ).toBeVisible({ timeout: 20_000 });
  // Extra wait for toolbar to render
  await page.waitForTimeout(2000);
}

async function openColumnPicker(page: import('@playwright/test').Page) {
  const colBtn = page.locator('button[title="Choose columns"]')
    .or(page.getByRole('button', { name: /Columns/i }));
  await expect(colBtn.first()).toBeVisible({ timeout: 10_000 });
  await colBtn.first().click();
  // Wait for the dropdown to render
  await page.waitForTimeout(500);
}

test.describe('Gantt Table — MPP Columns', () => {
  test.beforeEach(async ({ page }, testInfo) => {
    // Against real staging the session comes from globalSetup (storageState); the fake
    // sign-in is only for the mocked run — using it there waited forever for a login form
    if (!testInfo.project.use.storageState) await login(page);
  });

  test('column picker shows Actual Start and Actual Finish', async ({ page }) => {
    await navigateToGantt(page);
    await openColumnPicker(page);

    await expect(page.getByText('Actual Start').first()).toBeVisible({ timeout: 5_000 });
    await expect(page.getByText('Actual Finish').first()).toBeVisible();
  });

  test('column picker shows Baseline Duration and Baseline Cost', async ({ page }) => {
    await navigateToGantt(page);
    await openColumnPicker(page);

    await expect(page.getByText('Baseline Duration').first()).toBeVisible({ timeout: 5_000 });
    await expect(page.getByText('Baseline Cost').first()).toBeVisible();
  });

  test('column picker still has existing baseline columns', async ({ page }) => {
    await navigateToGantt(page);
    await openColumnPicker(page);

    await expect(page.getByText('Baseline Start').first()).toBeVisible({ timeout: 5_000 });
    await expect(page.getByText('Baseline End').first()).toBeVisible();
    await expect(page.getByText('Start Variance').first()).toBeVisible();
    await expect(page.getByText('End Variance').first()).toBeVisible();
  });

  test('Actual Start checkbox can be toggled on', async ({ page }) => {
    await navigateToGantt(page);
    await openColumnPicker(page);

    // Find the "Actual Start" label span and its sibling checkbox
    const label = page.locator('span').filter({ hasText: /^Actual Start$/ }).first();
    const row = label.locator('..');
    const checkbox = row.locator('input[type="checkbox"]');

    // Should be unchecked by default (not in defaultVisible)
    await expect(checkbox).not.toBeChecked();

    // Toggle it on
    await checkbox.click();
    await expect(checkbox).toBeChecked();

    // Toggle it back off to leave clean state
    await checkbox.click();
    await expect(checkbox).not.toBeChecked();
  });

  test('Actual Finish checkbox can be toggled on', async ({ page }) => {
    await navigateToGantt(page);
    await openColumnPicker(page);

    const label = page.locator('span').filter({ hasText: /^Actual Finish$/ }).first();
    const row = label.locator('..');
    const checkbox = row.locator('input[type="checkbox"]');

    await expect(checkbox).not.toBeChecked();
    await checkbox.click();
    await expect(checkbox).toBeChecked();

    // Clean up
    await checkbox.click();
    await expect(checkbox).not.toBeChecked();
  });

  test('column picker shows Standard and Baseline group headers', async ({ page }) => {
    await navigateToGantt(page);
    await openColumnPicker(page);

    // Group headers should be visible
    await expect(page.getByText('Standard').first()).toBeVisible({ timeout: 5_000 });
    await expect(page.getByText('Baseline').first()).toBeVisible();
  });
});
