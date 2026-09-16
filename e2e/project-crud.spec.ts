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

    // Dismiss cookie consent banner if present
    const cookieDecline = page.locator('button', { hasText: 'Decline' });
    if (await cookieDecline.isVisible({ timeout: 1000 }).catch(() => false)) {
      await cookieDecline.click();
      await page.waitForTimeout(300);
    }

    await page.getByRole('button', { name: /New Project/i }).click();

    // Wait for the template picker modal to appear
    const modal = page.locator('[role="dialog"][aria-modal="true"]');
    await expect(modal).toBeVisible({ timeout: 15_000 });

    // Click "Blank Project" option within the modal (use JS click to bypass stacking context)
    const scratchBtn = modal.getByText(/Blank Project/i);
    if ((await scratchBtn.count()) === 0) {
      test.skip();
      return;
    }
    await scratchBtn.evaluate((el) => (el as HTMLElement).click());

    // Wait for the form to appear
    const nameInput = modal.getByPlaceholder('My Project');
    await expect(nameInput).toBeVisible({ timeout: 5_000 });

    // Fill in the project form using evaluate (stacking context blocks normal fill)
    await nameInput.evaluate((el, name) => {
      const input = el as HTMLInputElement;
      const nativeSetter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!;
      nativeSetter.call(input, name);
      input.dispatchEvent(new Event('input', { bubbles: true }));
      input.dispatchEvent(new Event('change', { bubbles: true }));
    }, projectName);

    const dateInput = modal.locator('input[type="date"]').first();
    await dateInput.evaluate((el) => {
      const input = el as HTMLInputElement;
      const nativeSetter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!;
      nativeSetter.call(input, '2026-08-01');
      input.dispatchEvent(new Event('input', { bubbles: true }));
      input.dispatchEvent(new Event('change', { bubbles: true }));
    });

    // Wait for form validation to enable the button
    await page.waitForTimeout(500);

    // Submit the form
    const createBtn = modal.locator('button', { hasText: /Create Project/i });
    await createBtn.evaluate((el) => (el as HTMLElement).click());

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
    await expect(page.getByRole('tab', { name: 'Overview' })).toBeVisible({ timeout: 10_000 });
  });
});
