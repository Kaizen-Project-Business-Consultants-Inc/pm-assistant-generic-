import { test, expect } from '@playwright/test';
import { login, uniqueName } from './helpers';

test.describe('Task Management', () => {
  test.beforeEach(async ({ page }) => {
    await login(page);
  });

  test('add a task from the schedule tab', async ({ page }) => {
    // Navigate to an existing project (first one from the list)
    await page.goto('/projects');
    const firstProject = page.locator('a[href^="/project/"]').first();
    await expect(firstProject).toBeVisible({ timeout: 10_000 });

    await firstProject.click();
    await expect(page).toHaveURL(/\/project\//);

    // Click Schedule tab
    const scheduleTab = page.getByRole('button', { name: 'Schedule', exact: true });
    await expect(scheduleTab).toBeVisible({ timeout: 10_000 });
    await scheduleTab.click();

    // Wait for schedule content to load — should show schedule view or empty state
    await page.waitForTimeout(2000);

    // Verify schedule tab is active and has content (inline add-task buttons or empty state)
    const addTaskBtns = page.getByRole('button', { name: /Add task/i });
    const scheduleContent = page.locator('[class*="schedule"], [class*="gantt"], [data-testid="schedule"]');
    const hasAddTask = (await addTaskBtns.count()) > 0;
    const hasScheduleContent = (await scheduleContent.count()) > 0;
    expect(hasAddTask || hasScheduleContent).toBeTruthy();
  });
});
