import { test, expect } from '@playwright/test';
import { setupMockApi } from './helpers';

/**
 * Mock user WITHOUT fullName — triggers onboarding flow.
 * After login, the frontend navigates to /onboarding when fullName is empty.
 */
const ONBOARDING_USER = {
  id: 'test-user-onboarding',
  username: 'newuser',
  email: 'newuser@test.com',
  fullName: '',
  role: 'project_manager',
  subscriptionTier: 'trial',
  subscriptionStatus: 'trialing',
};

test.describe('Onboarding Wizard', () => {
  // Log in as a user without fullName so the app redirects to /onboarding
  test.beforeEach(async ({ page }) => {
    // Override the default mock to return a user without fullName
    await page.route('**/api/v1/**', async (route) => {
      const url = route.request().url();
      const method = route.request().method();

      if (url.includes('/auth/login') && method === 'POST') {
        return route.fulfill({
          status: 200,
          contentType: 'application/json',
          body: JSON.stringify({ user: ONBOARDING_USER }),
        });
      }

      if (method === 'GET') {
        return route.fulfill({
          status: 200,
          contentType: 'application/json',
          body: JSON.stringify([]),
        });
      }

      return route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({ success: true }),
      });
    });

    // Login → frontend sees empty fullName → navigates to /onboarding
    await page.goto('/login');
    await page.fill('#username', 'newuser');
    await page.fill('#password', 'password');
    await page.getByRole('button', { name: 'Sign in' }).click();
    await expect(page).toHaveURL(/\/onboarding/, { timeout: 15_000 });
  });

  test('onboarding page renders 3-step indicator', async ({ page }) => {
    // Step indicator should show 3 steps
    const stepCircles = page.locator('.rounded-full.flex.items-center.justify-center');
    await expect(stepCircles.first()).toBeVisible();
    expect(await stepCircles.count()).toBeGreaterThanOrEqual(3);
  });

  test('step 1 has profile, role, and methodology fields', async ({ page }) => {
    // Profile fields
    await expect(page.locator('#fullName')).toBeVisible();
    await expect(page.locator('#username')).toBeVisible();
    await expect(page.locator('#organizationName')).toBeVisible();

    // Role selector
    await expect(page.getByText('Your Role')).toBeVisible();
    await expect(page.getByText('Project Manager')).toBeVisible();
    await expect(page.getByText('Team Member')).toBeVisible();
    await expect(page.getByText('Executive')).toBeVisible();
    await expect(page.getByText('Scrum Master')).toBeVisible();

    // Methodology selector — use exact match to avoid matching
    // "Mix of waterfall and agile" in the Hybrid card description
    await expect(page.getByText('Preferred Methodology')).toBeVisible();
    await expect(page.getByText('Waterfall', { exact: true })).toBeVisible();
    await expect(page.getByText('Agile', { exact: true })).toBeVisible();
    await expect(page.getByText('Hybrid', { exact: true })).toBeVisible();
  });

  test('role cards toggle selection on click', async ({ page }) => {
    // Click "Executive" role
    const execCard = page.getByText('Executive').locator('..');
    await execCard.click();
    await expect(execCard).toHaveClass(/border-primary-500/);

    // Click "Team Member" — should deselect executive
    const memberCard = page.getByText('Team Member').locator('..');
    await memberCard.click();
    await expect(memberCard).toHaveClass(/border-primary-500/);
    await expect(execCard).not.toHaveClass(/border-primary-500/);
  });

  test('methodology cards toggle selection on click', async ({ page }) => {
    const agileCard = page.getByText('Agile', { exact: true }).locator('..');
    await agileCard.click();
    await expect(agileCard).toHaveClass(/border-primary-500/);
  });

  test('continue button is disabled without required fields', async ({ page }) => {
    const continueBtn = page.getByRole('button', { name: /Continue/i });
    // Empty fullName should keep button disabled
    await expect(continueBtn).toBeDisabled();

    // Fill fullName and username
    await page.fill('#fullName', 'Test User');
    await page.fill('#username', 'testuser');
    await expect(continueBtn).toBeEnabled();
  });

  test('page title says Welcome to Kovarti PM', async ({ page }) => {
    await expect(page.getByText('Welcome to Kovarti PM')).toBeVisible();
    await expect(page.getByText('Tell us about yourself')).toBeVisible();
  });
});
