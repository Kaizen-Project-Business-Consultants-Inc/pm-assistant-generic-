import { test, expect } from '@playwright/test';
import { login, TEST_USER } from './helpers';

test.describe('Authentication', () => {
  test('shows login page with form fields', async ({ page }) => {
    await page.goto('/login');
    await expect(page.locator('h2')).toContainText('Kovarti PM Assistant');
    await expect(page.locator('#username')).toBeVisible();
    await expect(page.locator('#password')).toBeVisible();
    await expect(page.getByRole('button', { name: 'Sign in' })).toBeVisible();
  });

  test('shows error on invalid credentials', async ({ page }) => {
    // Mock the login endpoint to return 401
    await page.route('**/api/v1/auth/login', async (route) => {
      return route.fulfill({
        status: 401,
        contentType: 'application/json',
        body: JSON.stringify({ message: 'Invalid username or password' }),
      });
    });

    await page.goto('/login');
    await page.fill('#username', 'nonexistent');
    await page.fill('#password', 'wrongpassword');
    await page.getByRole('button', { name: 'Sign in' }).click();
    // Wait for error message
    await expect(page.locator('.bg-red-50')).toBeVisible({ timeout: 10_000 });
  });

  test('logs in successfully and redirects to dashboard', async ({ page }) => {
    await login(page);
    // Should be on dashboard
    await expect(page).toHaveURL(/\/dashboard/);
    // Dashboard should have some content (sidebar, header, etc.)
    await expect(page.locator('body')).not.toBeEmpty();
  });

  test('redirects unauthenticated users to login', async ({ page }) => {
    await page.goto('/projects');
    await expect(page).toHaveURL(/\/login/);
  });

  test('toggle password visibility', async ({ page }) => {
    await page.goto('/login');
    const passwordInput = page.locator('#password');
    await expect(passwordInput).toHaveAttribute('type', 'password');

    await page.getByRole('button', { name: 'Show password' }).click();
    await expect(passwordInput).toHaveAttribute('type', 'text');

    await page.getByRole('button', { name: 'Hide password' }).click();
    await expect(passwordInput).toHaveAttribute('type', 'password');
  });
});
