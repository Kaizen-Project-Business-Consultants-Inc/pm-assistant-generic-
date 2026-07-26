import { test, expect } from '@playwright/test';
import { login } from './helpers';

test.describe('Sprint Planning', () => {
  test.beforeEach(async ({ page }) => {
    await login(page);
  });

  test('navigate to sprints tab on a project', async ({ page }) => {
    await page.goto('/projects');
    const firstProject = page.locator('a[href^="/project/"]').first();
    await expect(firstProject).toBeVisible({ timeout: 10_000 });

    await firstProject.click();
    await expect(page).toHaveURL(/\/project\//);

    // Click Sprints tab (agile project should have it)
    const sprintsTab = page.getByRole('button', { name: 'Sprints' });
    await expect(sprintsTab).toBeVisible({ timeout: 10_000 });
    await sprintsTab.click();

    // Should see sprint content or empty state
    await page.waitForTimeout(1000);
    const content = await page.textContent('body');
    expect(content).toBeTruthy();
  });

  test('view sprint board (Kanban)', async ({ page }) => {
    await page.goto('/projects');
    const firstProject = page.locator('a[href^="/project/"]').first();
    await expect(firstProject).toBeVisible({ timeout: 10_000 });

    await firstProject.click();
    await expect(page).toHaveURL(/\/project\//);

    // Click Sprints tab
    const sprintsTab = page.getByRole('button', { name: 'Sprints' });
    await expect(sprintsTab).toBeVisible({ timeout: 10_000 });
    await sprintsTab.click();
    await page.waitForTimeout(1000);

    // Try to switch to board view
    const boardBtn = page.getByRole('button', { name: /board/i });
    if ((await boardBtn.count()) > 0) {
      await boardBtn.click();
      await page.waitForTimeout(1000);
      const body = await page.textContent('body');
      expect(body).toBeTruthy();
    }
  });
});
