import { test, expect } from '@playwright/test';

// TechStart E-Commerce Platform on staging (mike_todo's tenant)
const PROJECT_ID = '54839f0a-8e9e-4f64-bc96-eef022132444';

test.describe('Bulk Delete Tasks', () => {

  test('Select all filtered tasks and bulk delete', async ({ page }) => {
    // Navigate to project schedule tab
    await page.goto(`/project/${PROJECT_ID}?tab=schedule`);
    await expect(
      page.locator('table, [class*="gantt"], canvas, svg').first()
    ).toBeVisible({ timeout: 20_000 });
    await page.waitForTimeout(2000);

    // Dismiss cookie banner if present
    const acceptBtn = page.locator('button', { hasText: 'Accept' });
    if (await acceptBtn.isVisible({ timeout: 1000 }).catch(() => false)) {
      await acceptBtn.click();
      await page.waitForTimeout(500);
    }

    // Search for our test tasks to filter to just 2
    const searchInput = page.locator('input[placeholder*="Search tasks"]').first();
    await expect(searchInput).toBeVisible({ timeout: 5_000 });
    await searchInput.fill('E2E_BULK_DEL');
    await page.waitForTimeout(1500);

    // Verify both tasks are visible
    await expect(page.getByText('E2E_BULK_DEL_1').first()).toBeVisible({ timeout: 10_000 });
    await expect(page.getByText('E2E_BULK_DEL_2').first()).toBeVisible({ timeout: 10_000 });

    // Click the "Select all" checkbox in the header to select both filtered tasks
    const selectAll = page.locator('input[aria-label="Select all tasks"]');
    await expect(selectAll).toBeVisible({ timeout: 5_000 });
    await selectAll.click({ force: true });
    await page.waitForTimeout(500);

    // Verify bulk action bar shows "2 selected"
    await expect(page.getByText(/2\s*selected/i)).toBeVisible({ timeout: 5_000 });

    // Click the Delete button in the bulk action bar
    const deleteBtn = page.locator('button').filter({ hasText: /^Delete$/ }).first();
    await deleteBtn.click();

    // Confirm in the modal
    await expect(page.getByText('Delete Tasks')).toBeVisible({ timeout: 5_000 });
    const confirmBtn = page.locator('button').filter({ hasText: /^Delete$/ }).last();
    await confirmBtn.click();

    // Wait for deletion
    await page.waitForTimeout(2000);

    // Verify tasks are gone
    await expect(page.getByText('E2E_BULK_DEL_1')).toHaveCount(0, { timeout: 10_000 });
    await expect(page.getByText('E2E_BULK_DEL_2')).toHaveCount(0, { timeout: 10_000 });
  });
});
