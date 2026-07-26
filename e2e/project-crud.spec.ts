import { test, expect } from '@playwright/test';
import { login, uniqueName } from './helpers';

test.describe('Project CRUD', () => {
  test.beforeEach(async ({ page }) => {
    await login(page);
  });

  test('navigate to projects page', async ({ page }) => {
    await page.goto('/projects');
    await expect(page).toHaveURL(/\/projects/);
    // Should see the "New Project" button
    await expect(page.getByRole('button', { name: /New Project/i })).toBeVisible();
  });

  test('create a blank project from scratch', async ({ page }) => {
    const projectName = uniqueName('E2E Test Project');

    await page.goto('/projects');
    await page.getByRole('button', { name: /New Project/i }).click();

    // Template picker modal should open
    await expect(page.getByRole('heading', { name: /New Project/i })).toBeVisible();

    // Click "Start from Scratch" (blank project option)
    const scratchBtn = page.getByText(/Start from Scratch|Blank Project/i);
    if ((await scratchBtn.count()) === 0) {
      test.skip();
      return;
    }
    await scratchBtn.click();

    // Fill in the project form — name and start date are both required
    const nameInput = page.getByPlaceholder('My Project');
    await nameInput.clear();
    await nameInput.fill(projectName);

    const dateInput = page.locator('input[type="date"]').first();
    await dateInput.fill('2026-08-01');

    // Submit the form
    const createBtn = page.getByRole('button', { name: /Create Project/i });
    await expect(createBtn).toBeEnabled({ timeout: 5_000 });
    await createBtn.click();

    // Should navigate to the new project detail page
    await expect(page).toHaveURL(/\/project\//, { timeout: 15_000 });
  });

  test('view project detail page with tabs', async ({ page }) => {
    // Navigate to projects and wait for project links to render
    await page.goto('/projects');
    const firstProject = page.locator('a[href^="/project/"]').first();
    await expect(firstProject).toBeVisible({ timeout: 10_000 });

    await firstProject.click();
    await expect(page).toHaveURL(/\/project\//);

    // Should have tabs (Overview, Schedule, etc.)
    await expect(page.getByText('Overview')).toBeVisible({ timeout: 10_000 });
  });
});
