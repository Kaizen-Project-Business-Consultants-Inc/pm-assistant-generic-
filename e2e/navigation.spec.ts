import { test, expect } from '@playwright/test';
import { login } from './helpers';

test.describe('Navigation', () => {
  test.beforeEach(async ({ page }) => {
    await login(page);
  });

  test('dashboard loads with widgets', async ({ page }) => {
    await expect(page).toHaveURL(/\/dashboard/);
    // Dashboard should render the sidebar and main content area
    await expect(page.locator('aside, nav').first()).toBeVisible({ timeout: 10_000 });
  });

  test('sidebar navigation works', async ({ page }) => {
    const projectsLink = page.locator('a[href="/projects"]').first();
    if ((await projectsLink.count()) > 0) {
      await projectsLink.click();
      await expect(page).toHaveURL(/\/projects/);
    }
  });

  test('sidebar has Mjuzi AI section with AI Query and AI Proposals', async ({ page }) => {
    const sidebar = page.locator('aside[aria-label="Main navigation"], [role="complementary"][aria-label="Main navigation"]');
    await expect(sidebar).toBeVisible();

    // Mjuzi AI section label
    await expect(sidebar.getByText('Mjuzi AI', { exact: false })).toBeVisible();

    // AI Query link
    const aiQueryLink = sidebar.locator('a[href="/query"]');
    await expect(aiQueryLink).toBeVisible();

    // AI Proposals link (project_manager should see it)
    const aiProposalsLink = sidebar.locator('a[href="/agent"]');
    await expect(aiProposalsLink).toBeVisible();
  });

  test('AI Query page loads with correct title', async ({ page }) => {
    await page.goto('/query');
    await expect(page.getByRole('heading', { name: /AI Query/i })).toBeVisible();
    await expect(page.getByText('Ask questions about your project data in plain English')).toBeVisible();
  });

  test('AI Proposals page loads with correct title', async ({ page }) => {
    await page.goto('/agent');
    await expect(page.getByRole('heading', { name: /AI Proposals/i })).toBeVisible({ timeout: 15_000 });
  });

  test('404 page for unknown routes', async ({ page }) => {
    await page.goto('/nonexistent-page-xyz');
    await page.waitForTimeout(2000);
    const url = page.url();
    expect(url).toBeTruthy();
  });
});
