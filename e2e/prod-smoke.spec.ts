import { test, expect } from '@playwright/test';

// Uses prod auth from globalSetup — storageState injected automatically
const E2E_PROJECT_ID = 'e2e-test-proj-001';

test.describe('Prod Smoke Tests', () => {

  test('Auth: dashboard loads with saved session', async ({ page }) => {
    await page.goto('/dashboard');
    await expect(page).toHaveURL(/\/dashboard/);
    await expect(page.locator('body')).not.toBeEmpty();
  });

  test('Dashboard: content renders', async ({ page }) => {
    await page.goto('/dashboard');
    await expect(page.locator('h1, h2, h3').first()).toBeVisible({ timeout: 15_000 });
  });

  test('Projects: page loads', async ({ page }) => {
    await page.goto('/projects');
    await expect(page.getByRole('button', { name: /New Project/i })).toBeVisible({ timeout: 15_000 });
  });

  test('Projects: New Project modal opens with 3 options', async ({ page }) => {
    await page.goto('/projects');
    await page.getByRole('button', { name: /New Project/i }).click();
    await expect(page.getByRole('heading', { name: /New Project/i })).toBeVisible();
    // Should show the 3-option start screen
    await expect(page.getByText(/Start from Scratch|Blank Project/i).first()).toBeVisible({ timeout: 5_000 });
  });

  test('Analytics: page loads', async ({ page }) => {
    await page.goto('/analytics');
    await expect(
      page.locator('canvas, svg, [class*="chart"], [class*="analytics"], h1, h2').first()
    ).toBeVisible({ timeout: 15_000 });
  });

  test('Portfolio: page loads', async ({ page }) => {
    await page.goto('/portfolio');
    await expect(page.getByText(/portfolio/i).first()).toBeVisible({ timeout: 15_000 });
  });

  test('Settings: page loads', async ({ page }) => {
    await page.goto('/settings');
    await expect(page.getByText(/settings|preferences|profile/i).first()).toBeVisible({ timeout: 15_000 });
  });

  test('Notifications: page loads', async ({ page }) => {
    await page.goto('/notifications');
    await expect(page.getByText(/notification/i).first()).toBeVisible({ timeout: 15_000 });
  });

  test('Gantt: schedule tab loads with tasks', async ({ page }) => {
    await page.goto(`/project/${E2E_PROJECT_ID}?tab=schedule`);
    await expect(
      page.locator('table, [class*="gantt"], canvas, svg').first()
    ).toBeVisible({ timeout: 20_000 });
  });

  test('Gantt: column picker has MPP columns', async ({ page }) => {
    await page.goto(`/project/${E2E_PROJECT_ID}?tab=schedule`);
    await expect(
      page.locator('table, [class*="gantt"], canvas, svg').first()
    ).toBeVisible({ timeout: 20_000 });

    // Open column picker
    const colBtn = page.locator('button[title="Choose columns"]')
      .or(page.getByRole('button', { name: /Columns/i }));
    await expect(colBtn.first()).toBeVisible({ timeout: 10_000 });
    await colBtn.first().click();
    await page.waitForTimeout(500);

    // Verify new MPP columns exist
    await expect(page.getByText('Actual Start').first()).toBeVisible({ timeout: 5_000 });
    await expect(page.getByText('Actual Finish').first()).toBeVisible();
    await expect(page.getByText('Baseline Duration').first()).toBeVisible();
    await expect(page.getByText('Baseline Cost').first()).toBeVisible();
  });
});
