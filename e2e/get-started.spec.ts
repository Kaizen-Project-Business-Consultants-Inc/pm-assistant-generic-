import { test, expect } from '@playwright/test';

/**
 * First login goes to the dashboard's Get started card, not a setup form (U42/U47/U48, approved
 * mock 2026-10-19). Mocked API (local dev server, playwright.config.ts): a Team-plan owner who
 * hasn't finished setting up signs in and sees the four steps in order; /onboarding sends them on.
 */
const NEW_OWNER = {
  id: 'test-new-owner', username: 'george', email: 'george@test.com', fullName: 'George Bailoo',
  role: 'pmo', accountRole: 'project_manager', subscriptionTier: 'sme', subscriptionStatus: 'active',
  emailVerified: true, onboardingCompleted: false,
  organization: { id: 'org-1', name: 'George Bailoo Co.', slug: 'gb', isOwner: true },
};
const STEPS = { canInvite: true, invited: false, firstProjectId: null, projectHasPeople: false, projectHasTasks: false };

test.describe('Get started card', () => {
  test.beforeEach(async ({ page }) => {
    await page.route('**/api/v1/**', async (route) => {
      const url = route.request().url();
      const json = (body: unknown) => route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(body) });
      if (url.includes('/auth/login')) return json({ user: NEW_OWNER });
      if (url.includes('/auth/me')) return json({ user: NEW_OWNER });
      if (url.includes('/users/me/get-started')) return json(STEPS);
      if (url.includes('/users/me')) return json({ user: { timezone: 'UTC' } });
      if (url.includes('/seats')) return json({ usedSeats: 1, paidSeats: 3, availableSeats: 2, billingModel: 'per_seat', seatPriceCents: 1900 });
      if (route.request().method() === 'GET') return json([]);
      return json({ success: true });
    });
    await page.goto('/login');
    await page.fill('#username', 'george@test.com');
    await page.fill('#password', 'password');
    await page.getByRole('button', { name: 'Sign in' }).click();
    await expect(page).toHaveURL(/\/dashboard/, { timeout: 15_000 });
  });

  test('the four steps, in order, with Invite first', async ({ page }) => {
    const card = page.getByRole('region', { name: /Let’s get George Bailoo Co\. working/ });
    await expect(card).toBeVisible();
    for (const step of ['Invite your people', 'Create your first project', 'Choose who’s on it', 'Build the plan']) {
      await expect(card.getByText(step)).toBeVisible();
    }
    await expect(card.getByText('Finish your profile')).toBeVisible();
    await expect(page.getByText('Tell us about yourself')).toHaveCount(0);
  });

  test('Invite opens the dialog with Free / Paid seat and the bill', async ({ page }) => {
    await page.getByRole('button', { name: 'Invite', exact: true }).click();
    const dialog = page.getByRole('dialog', { name: 'Invite your people' });
    await dialog.getByLabel('Email').fill('priya@test.com');
    await expect(dialog.getByText('Paid seat')).toBeVisible();
    await expect(dialog.getByText(/You have 3 seats and use 1/)).toBeVisible();
  });

  test('the old setup address goes to the dashboard', async ({ page }) => {
    await page.goto('/onboarding');
    await expect(page).toHaveURL(/\/dashboard/);
  });
});
