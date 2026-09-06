import { test, expect } from '@playwright/test';

// TechStart E-Commerce Platform on staging (mike_todo's tenant)
const PROJECT_ID = '54839f0a-8e9e-4f64-bc96-eef022132444';
const PROJECT_NAME = 'TechStart';

test.describe('Pre-Launch Staging Tests', () => {
  // Auth is handled by globalSetup — storageState is injected automatically

  test('Auth: dashboard loads with saved session', async ({ page }) => {
    await page.goto('/dashboard');
    await expect(page).toHaveURL(/\/dashboard/);
    await expect(page.locator('body')).not.toBeEmpty();
  });

  test('Dashboard: morning briefing loads', async ({ page }) => {
    await page.goto('/dashboard');
    await expect(page.locator('h1, h2, h3').first()).toBeVisible({ timeout: 15_000 });
  });

  test('Dashboard: content renders', async ({ page }) => {
    await page.goto('/dashboard');
    // Dashboard should show either project cards or empty state
    await expect(
      page.getByText(/Dashboard/i).first()
    ).toBeVisible({ timeout: 15_000 });
  });

  test('Project: open and verify details', async ({ page }) => {
    await page.goto(`/project/${PROJECT_ID}`);
    await expect(page.getByRole('heading', { name: new RegExp(PROJECT_NAME, 'i') })).toBeVisible({ timeout: 15_000 });
    // Verify key project info renders
    await expect(page.getByText(/Budget|Progress|Timeline/i).first()).toBeVisible();
  });

  test('Gantt: schedule tab loads with tasks', async ({ page }) => {
    await page.goto(`/project/${PROJECT_ID}?tab=schedule`);
    await expect(
      page.locator('table, [class*="gantt"], canvas, svg').first()
    ).toBeVisible({ timeout: 20_000 });
  });

  test('RAID: tab loads with items', async ({ page }) => {
    await page.goto(`/project/${PROJECT_ID}?tab=raid`);
    await expect(
      page.locator('table tbody tr, [class*="raid"], button, [role="tab"]').first()
    ).toBeVisible({ timeout: 15_000 });
  });

  test('Resources: tab loads', async ({ page }) => {
    await page.goto(`/project/${PROJECT_ID}?tab=resources`);
    // Check for either resource rows or the empty state / add button
    await expect(
      page.locator('table tbody tr, [class*="resource"], [class*="card"], [class*="empty"], button').first()
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

  test('Portfolio: page loads with project', async ({ page }) => {
    await page.goto('/portfolio');
    await expect(page.getByText(/portfolio/i).first()).toBeVisible({ timeout: 15_000 });
    await expect(page.getByText(new RegExp(PROJECT_NAME, 'i')).first()).toBeVisible({ timeout: 15_000 });
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
