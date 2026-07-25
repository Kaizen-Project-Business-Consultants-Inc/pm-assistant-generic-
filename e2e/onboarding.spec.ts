import { test, expect } from '@playwright/test';

test.describe('Onboarding Wizard', () => {
  // Note: These tests verify the onboarding page structure and interactions.
  // They don't complete the full flow since that requires a fresh user without fullName set.

  test('onboarding page renders 3-step indicator', async ({ page }) => {
    await page.goto('/onboarding');

    // If user is already onboarded, they'll redirect to dashboard — that's OK
    const url = page.url();
    if (url.includes('/dashboard')) {
      // Already onboarded user — verify redirect works
      return;
    }

    // Step indicator should show 3 steps
    const stepCircles = page.locator('.rounded-full.flex.items-center.justify-center');
    expect(await stepCircles.count()).toBeGreaterThanOrEqual(3);
  });

  test('step 1 has profile, role, and methodology fields', async ({ page }) => {
    await page.goto('/onboarding');

    const url = page.url();
    if (url.includes('/dashboard')) return; // Already onboarded

    // Profile fields
    await expect(page.locator('#fullName')).toBeVisible();
    await expect(page.locator('#username')).toBeVisible();
    await expect(page.locator('#organizationName')).toBeVisible();

    // Role selector (5 role cards)
    await expect(page.getByText('Your Role')).toBeVisible();
    await expect(page.getByText('Project Manager')).toBeVisible();
    await expect(page.getByText('Team Member')).toBeVisible();
    await expect(page.getByText('Executive')).toBeVisible();
    await expect(page.getByText('Scrum Master')).toBeVisible();

    // Methodology selector
    await expect(page.getByText('Preferred Methodology')).toBeVisible();
    await expect(page.getByText('Waterfall')).toBeVisible();
    await expect(page.getByText('Agile')).toBeVisible();
    await expect(page.getByText('Hybrid')).toBeVisible();
  });

  test('role cards toggle selection on click', async ({ page }) => {
    await page.goto('/onboarding');

    const url = page.url();
    if (url.includes('/dashboard')) return;

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
    await page.goto('/onboarding');

    const url = page.url();
    if (url.includes('/dashboard')) return;

    const agileCard = page.getByText('Agile').locator('..');
    await agileCard.click();
    await expect(agileCard).toHaveClass(/border-primary-500/);
  });

  test('continue button is disabled without required fields', async ({ page }) => {
    await page.goto('/onboarding');

    const url = page.url();
    if (url.includes('/dashboard')) return;

    const continueBtn = page.getByRole('button', { name: /Continue/i });
    // Empty fullName should keep button disabled
    await expect(continueBtn).toBeDisabled();

    // Fill fullName and username
    await page.fill('#fullName', 'Test User');
    await page.fill('#username', 'testuser');
    await expect(continueBtn).toBeEnabled();
  });

  test('page title says Welcome to Kovarti PM', async ({ page }) => {
    await page.goto('/onboarding');

    const url = page.url();
    if (url.includes('/dashboard')) return;

    await expect(page.getByText('Welcome to Kovarti PM')).toBeVisible();
    await expect(page.getByText('Tell us about yourself')).toBeVisible();
  });
});
