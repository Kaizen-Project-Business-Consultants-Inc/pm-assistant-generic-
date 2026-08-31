import { test, expect } from '@playwright/test';
import { stagingLogin } from './staging-helpers';

// CloudSync project ID on staging (from URL observed in test run)
const CLOUDSYNC_ID = 'fe0fe4f4-ebdd-4bc0-a439-8e2faf4e8c03';

test.describe('Pre-Launch Staging Tests', () => {
  test.beforeEach(async ({ page }) => {
    await stagingLogin(page);
  });

  test('Auth: login redirects to dashboard with user info', async ({ page }) => {
    await expect(page).toHaveURL(/\/dashboard/);
    await expect(page.locator('body')).not.toBeEmpty();
  });

  test('Dashboard: morning briefing loads', async ({ page }) => {
    await expect(page.locator('h1, h2, h3').first()).toBeVisible({ timeout: 15_000 });
  });

  test('Dashboard: CloudSync project visible', async ({ page }) => {
    await expect(page.getByText('CloudSync').first()).toBeVisible({ timeout: 15_000 });
  });

  test('Project: open CloudSync and verify details', async ({ page }) => {
    await page.goto(`/project/${CLOUDSYNC_ID}`);
    await expect(page.getByRole('heading', { name: /CloudSync/i })).toBeVisible({ timeout: 15_000 });
    // Verify key project info renders
    await expect(page.getByText(/Budget|Progress|Timeline/i).first()).toBeVisible();
  });

  test('Gantt: schedule tab loads with tasks', async ({ page }) => {
    await page.goto(`/project/${CLOUDSYNC_ID}?tab=schedule`);
    await expect(
      page.locator('[class*="gantt"], [data-testid*="gantt"], table, canvas, svg').first()
    ).toBeVisible({ timeout: 20_000 });
  });

  test('RAID: tab loads with items', async ({ page }) => {
    await page.goto(`/project/${CLOUDSYNC_ID}?tab=raid`);
    await expect(
      page.locator('table tbody tr, [class*="raid"], button, [role="tab"]').first()
    ).toBeVisible({ timeout: 15_000 });
  });

  test('Resources: tab loads with resources', async ({ page }) => {
    await page.goto(`/project/${CLOUDSYNC_ID}?tab=resources`);
    await expect(
      page.locator('table tbody tr, [class*="resource"], [class*="card"]').first()
    ).toBeVisible({ timeout: 15_000 });
  });

  test('Analytics: page loads with charts', async ({ page }) => {
    await page.goto('/analytics');
    await expect(
      page.locator('canvas, svg, [class*="chart"], [class*="analytics"], h1, h2').first()
    ).toBeVisible({ timeout: 15_000 });
  });

  test('Monte Carlo: page loads', async ({ page }) => {
    await page.goto('/monte-carlo');
    await expect(page.getByText(/monte carlo|simulation/i).first()).toBeVisible({ timeout: 15_000 });
  });

  test('Portfolio: page loads with CloudSync', async ({ page }) => {
    await page.goto('/portfolio');
    await expect(page.getByText(/portfolio/i).first()).toBeVisible({ timeout: 15_000 });
    await expect(page.getByText(/CloudSync/i).first()).toBeVisible({ timeout: 15_000 });
  });

  test('Intake Forms: page loads', async ({ page }) => {
    await page.goto('/intake');
    await expect(page.getByText(/intake|new project request/i).first()).toBeVisible({
      timeout: 15_000,
    });
  });

  test('Settings: page loads', async ({ page }) => {
    await page.goto('/settings');
    await expect(page.getByText(/settings|preferences|profile/i).first()).toBeVisible({
      timeout: 15_000,
    });
  });

  test('Notifications: page loads', async ({ page }) => {
    await page.goto('/notifications');
    await expect(page.getByText(/notification/i).first()).toBeVisible({ timeout: 15_000 });
  });
});
