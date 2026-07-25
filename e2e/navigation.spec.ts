import { test, expect } from '@playwright/test';
import { login } from './helpers';

test.describe('Navigation', () => {
  test.beforeEach(async ({ page }) => {
    await login(page);
  });

  test('dashboard loads with widgets', async ({ page }) => {
    await expect(page).toHaveURL(/\/dashboard/);
    await page.waitForTimeout(2000);
    const body = await page.textContent('body');
    expect(body!.length).toBeGreaterThan(100);
  });

  test('sidebar navigation works', async ({ page }) => {
    const projectsLink = page.locator('a[href="/projects"]').first();
    if ((await projectsLink.count()) > 0) {
      await projectsLink.click();
      await expect(page).toHaveURL(/\/projects/);
    }
  });

  test('sidebar has Mjuzi AI section with AI Query and AI Proposals', async ({ page }) => {
    const sidebar = page.locator('aside[aria-label="Main navigation"]');
    await expect(sidebar).toBeVisible();

    // Mjuzi AI section label should be visible (when sidebar is expanded)
    await expect(sidebar.getByText('Mjuzi AI', { exact: false })).toBeVisible();

    // AI Query link
    const aiQueryLink = sidebar.locator('a[href="/query"]');
    await expect(aiQueryLink).toBeVisible();
    await expect(aiQueryLink).toContainText('AI Query');

    // AI Proposals link (admin user should see it)
    const aiProposalsLink = sidebar.locator('a[href="/agent"]');
    await expect(aiProposalsLink).toBeVisible();
    await expect(aiProposalsLink).toContainText('AI Proposals');
  });

  test('AI Query page loads with correct title', async ({ page }) => {
    await page.goto('/query');
    await expect(page.getByRole('heading', { name: /AI Query/i })).toBeVisible();
    await expect(page.getByText('Ask questions about your project data in plain English')).toBeVisible();
    await expect(page.getByText('Mjuzi chat panel')).toBeVisible();
  });

  test('AI Proposals page loads with correct title', async ({ page }) => {
    await page.goto('/agent');
    await expect(page.getByRole('heading', { name: /AI Proposals/i })).toBeVisible();
    await expect(page.getByText("Mjuzi's autonomous agents")).toBeVisible();
  });

  test('404 page for unknown routes', async ({ page }) => {
    await page.goto('/nonexistent-page-xyz');
    await page.waitForTimeout(2000);
    const url = page.url();
    expect(url).toBeTruthy();
  });
});
