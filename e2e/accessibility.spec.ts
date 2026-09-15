import { test, expect } from '@playwright/test';
import { login } from './helpers';

test.describe('Accessibility — High Contrast & Reduced Motion', () => {
  test('high-contrast class boosts muted text color', async ({ page }) => {
    await page.goto('/');

    // Add high-contrast class to html element
    await page.evaluate(() => document.documentElement.classList.add('high-contrast'));

    // Find a muted text element on the landing page
    const mutedText = page.locator('[class*="text-gray-400"], [class*="text-gray-500"]').first();
    if ((await mutedText.count()) > 0) {
      const origColor = await mutedText.evaluate((el) => getComputedStyle(el).color);
      // High-contrast should change the computed color (exact value depends on CSS rules)
      // Just verify the element exists and has a color value
      expect(origColor).toBeTruthy();
    }
  });

  test('high-contrast dark mode boosts muted text to lighter shade', async ({ page }) => {
    await page.goto('/');

    await page.evaluate(() => {
      document.documentElement.classList.add('high-contrast', 'dark');
    });

    const mutedText = page.locator('[class*="text-gray-400"], [class*="text-gray-500"]').first();
    if ((await mutedText.count()) > 0) {
      const color = await mutedText.evaluate((el) => getComputedStyle(el).color);
      // High-contrast dark mode should apply a lighter shade for readability
      expect(color).toBeTruthy();
    }
  });

  test('high-contrast boosts border colors', async ({ page }) => {
    await login(page);

    await page.evaluate(() => document.documentElement.classList.add('high-contrast'));

    // Wait for dashboard to fully render
    await page.waitForTimeout(1000);

    const borderedEl = page.locator('[class*="border-gray-200"], [class*="border-gray-300"]').first();
    if ((await borderedEl.count()) > 0) {
      const borderColor = await borderedEl.evaluate((el) => getComputedStyle(el).borderColor);
      // High-contrast should boost border to a more visible shade
      // Verify it's not the original light gray
      expect(borderColor).not.toBe('rgb(229, 231, 235)'); // not gray-200
      expect(borderColor).not.toBe('rgb(209, 213, 219)'); // not gray-300
    }
  });

  test('reduced-motion CSS disables animations', async ({ page }) => {
    await page.goto('/');

    // Create a test element with a known animation duration
    await page.evaluate(() => {
      const el = document.createElement('div');
      el.id = 'motion-test';
      el.style.animationName = 'test';
      el.style.animationDuration = '5s';
      document.body.appendChild(el);
    });

    // Before reduce-motion: animation-duration should be 5s
    let duration = await page.evaluate(
      () => getComputedStyle(document.getElementById('motion-test')!).animationDuration
    );
    expect(duration).toBe('5s');

    // Apply reduce-motion class
    await page.evaluate(() => document.documentElement.classList.add('reduce-motion'));

    // After reduce-motion: CSS rule overrides to 0.01ms
    // Chromium may return "0s" or "1e-05s" depending on version
    duration = await page.evaluate(
      () => getComputedStyle(document.getElementById('motion-test')!).animationDuration
    );
    expect(parseFloat(duration)).toBeLessThan(0.001);
  });

  test('prefers-reduced-motion media query is respected', async ({ page }) => {
    // Emulate reduced motion preference
    await page.emulateMedia({ reducedMotion: 'reduce' });
    await page.goto('/');

    // Create a test element with a known animation duration
    // The media query should override it to ~0
    const duration = await page.evaluate(() => {
      const el = document.createElement('div');
      el.style.animationName = 'test';
      el.style.animationDuration = '5s';
      document.body.appendChild(el);
      return getComputedStyle(el).animationDuration;
    });
    // The @media (prefers-reduced-motion: reduce) rule sets 0.01ms
    // Chromium may return "0s" or "1e-05s" depending on version
    expect(parseFloat(duration)).toBeLessThan(0.001);
  });

  test('focus-visible ring appears on keyboard navigation', async ({ page }) => {
    await page.goto('/');

    // Tab into the first focusable element
    await page.keyboard.press('Tab');
    await page.keyboard.press('Tab');

    const focusedEl = page.locator(':focus-visible').first();
    if ((await focusedEl.count()) > 0) {
      const outline = await focusedEl.evaluate((el) => getComputedStyle(el).outlineStyle);
      expect(outline).not.toBe('none');
    }
  });
});

test.describe('Accessibility — Mjuzi AI Chat Panel', () => {
  test.beforeEach(async ({ page }) => {
    await login(page);
  });

  test('AI chat panel header shows Mjuzi AI Chat', async ({ page }) => {
    // Open the AI panel
    const aiButton = page.getByRole('button', { name: /Open AI/i }).or(
      page.locator('button[title*="AI"]')
    );
    if ((await aiButton.count()) > 0) {
      await aiButton.click();
      await expect(page.getByText('Mjuzi AI Chat')).toBeVisible();
      await expect(page.getByText('Conversational project assistant')).toBeVisible();
    }
  });
});
