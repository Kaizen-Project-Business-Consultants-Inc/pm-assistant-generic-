import { test, expect } from '@playwright/test';
import { login } from './helpers';

test.describe('Prod Smoke Tests', () => {
  test.beforeEach(async ({ page }) => {
    await login(page);
  });

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

  test('Projects: New Project modal opens with options', async ({ page }) => {
    await page.goto('/projects');
    await page.getByRole('button', { name: /New Project/i }).click();
    // Wait for the template picker modal to appear
    const modal = page.locator('[role="dialog"][aria-modal="true"]');
    await expect(modal).toBeVisible({ timeout: 15_000 });
    // Should show the blank project option
    await expect(page.getByText(/Blank Project/i).first()).toBeVisible({ timeout: 5_000 });
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

  test('Gantt: schedule tab loads', async ({ page }) => {
    // Navigate to first project's schedule tab
    await page.goto('/projects');
    const firstProject = page.locator('a[href^="/project/"]').first();
    await expect(firstProject).toBeVisible({ timeout: 10_000 });
    const href = await firstProject.getAttribute('href');
    await page.goto(`${href}?tab=schedule`);
    await expect(
      page.locator('table, [class*="gantt"], canvas, svg').first()
    ).toBeVisible({ timeout: 20_000 });
  });

  test('Gantt: column picker has MPP columns', async ({ page }) => {
    // Navigate to first project's schedule tab
    await page.goto('/projects');
    const firstProject = page.locator('a[href^="/project/"]').first();
    await expect(firstProject).toBeVisible({ timeout: 10_000 });
    const href = await firstProject.getAttribute('href');
    await page.goto(`${href}?tab=schedule`);
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
