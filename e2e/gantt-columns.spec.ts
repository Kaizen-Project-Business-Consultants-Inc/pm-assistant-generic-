import { test, expect } from '@playwright/test';

// Uses staging auth from globalSetup — storageState injected automatically

// CloudSync project ID on staging (same as pre-launch.spec.ts)
const CLOUDSYNC_ID = 'fe0fe4f4-ebdd-4bc0-a439-8e2faf4e8c03';

async function navigateToGantt(page: import('@playwright/test').Page) {
  await page.goto(`/project/${CLOUDSYNC_ID}?tab=schedule`);
  // Wait for the Gantt table to load
  await expect(
    page.locator('table, [class*="gantt"], canvas, svg').first()
  ).toBeVisible({ timeout: 20_000 });
}

async function openColumnPicker(page: import('@playwright/test').Page) {
  // The column picker button has title="Choose columns" and text "Columns"
  const colBtn = page.locator('button[title="Choose columns"]')
    .or(page.getByRole('button', { name: /Columns/i }));
  await expect(colBtn.first()).toBeVisible({ timeout: 10_000 });
  await colBtn.first().click();
  // Wait for the dropdown to render
  await page.waitForTimeout(500);
}

test.describe('Gantt Table — MPP Columns', () => {

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
