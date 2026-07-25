import { test, expect } from '@playwright/test';

test.describe('Landing Page', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/');
  });

  test('renders hero section with CTA buttons', async ({ page }) => {
    await expect(page.getByRole('heading', { name: /Manage projects/i })).toBeVisible();
    await expect(page.getByText('smarter with AI')).toBeVisible();

    // Primary CTA
    await expect(page.getByRole('link', { name: /Get Started Free/i })).toBeVisible();

    // Secondary CTA links to proof section
    const secondaryCta = page.getByRole('link', { name: /See how it works/i });
    await expect(secondaryCta).toBeVisible();
    await expect(secondaryCta).toHaveAttribute('href', '#see-it-work');
  });

  test('hero mockup is visible on all screen sizes', async ({ page }) => {
    // Hero mockup should NOT have hidden class — visible on mobile too
    const heroSection = page.locator('section').first();
    const mockupContainer = heroSection.locator('.max-w-md, .lg\\:max-w-none').first();
    await expect(mockupContainer).toBeVisible();
  });

  test('feature cards are keyboard-focusable', async ({ page }) => {
    // Feature cards should have tabIndex and role="button"
    const featureCards = page.locator('[role="button"][tabindex="0"]');
    const count = await featureCards.count();
    expect(count).toBe(6); // 6 feature cards

    // First card should be focusable via Tab
    const firstCard = featureCards.first();
    await firstCard.focus();
    await expect(firstCard).toBeFocused();
  });

  test('feature card shows preview on click (touch/keyboard)', async ({ page }) => {
    const featureCards = page.locator('[role="button"][tabindex="0"]');
    const firstCard = featureCards.first();

    // Click to toggle preview
    await firstCard.click();
    // Preview should appear (the mockup popup)
    const preview = firstCard.locator('.absolute.z-50');
    await expect(preview).toBeVisible({ timeout: 2000 });

    // Click again to toggle off
    await firstCard.click();
    await expect(preview).not.toBeVisible();
  });

  test('feature card has aria-expanded attribute', async ({ page }) => {
    const featureCards = page.locator('[role="button"][tabindex="0"]');
    const firstCard = featureCards.first();

    // Initially collapsed
    await expect(firstCard).toHaveAttribute('aria-expanded', 'false');

    // Click to expand
    await firstCard.click();
    await expect(firstCard).toHaveAttribute('aria-expanded', 'true');
  });

  test('"See it in action" section exists with 3 rows', async ({ page }) => {
    const proofSection = page.locator('#see-it-work');
    await expect(proofSection).toBeVisible();
    await expect(proofSection.getByRole('heading', { name: /See it in action/i })).toBeVisible();

    // 3 alternating rows
    await expect(proofSection.getByText('Plan with AI-powered scheduling')).toBeVisible();
    await expect(proofSection.getByText('Catch risks before they escalate')).toBeVisible();
    await expect(proofSection.getByText('Monitor portfolio health at a glance')).toBeVisible();

    // Each row should have a static mockup SVG
    const svgs = proofSection.locator('svg');
    expect(await svgs.count()).toBeGreaterThanOrEqual(3);
  });

  test('pricing section has tier descriptors', async ({ page }) => {
    const pricingSection = page.locator('#pricing');
    await pricingSection.scrollIntoViewIfNeeded();

    // Tier descriptors in comparison table
    await expect(pricingSection.getByText('(Free)')).toBeVisible();
    await expect(pricingSection.getByText('(Solo)')).toBeVisible();
    await expect(pricingSection.getByText('(Team)')).toBeVisible();
  });

  test('refund policy is in a collapsible accordion', async ({ page }) => {
    const pricingSection = page.locator('#pricing');
    await pricingSection.scrollIntoViewIfNeeded();

    const details = pricingSection.locator('details');
    await expect(details).toBeVisible();

    const summary = details.locator('summary');
    await expect(summary).toContainText('Refund');

    // Content should be hidden initially
    const content = details.locator('div');
    await expect(content).not.toBeVisible();

    // Click to expand
    await summary.click();
    await expect(content).toBeVisible();
    await expect(content.getByText('non-refundable')).toBeVisible();
  });

  test('navbar has mobile menu toggle', async ({ page }) => {
    // Set mobile viewport
    await page.setViewportSize({ width: 375, height: 812 });
    await page.goto('/');

    const menuButton = page.getByRole('button', { name: /Toggle menu/i });
    await expect(menuButton).toBeVisible();

    // Toggle opens mobile menu
    await menuButton.click();
    await expect(page.getByRole('link', { name: /Sign In/i })).toBeVisible();
  });

  test('hero secondary CTA scrolls to proof section', async ({ page }) => {
    const link = page.getByRole('link', { name: /See how it works/i });
    await link.click();

    // Should scroll to the proof section
    await page.waitForTimeout(500);
    const proofSection = page.locator('#see-it-work');
    await expect(proofSection).toBeInViewport();
  });
});
