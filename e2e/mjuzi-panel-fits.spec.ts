import { test, expect } from '@playwright/test';
import { signedIn } from './qa-data';
import { STAGING_USER } from './staging-helpers';

/**
 * The Mjuzi panel fits the window: the box to type in and the Send button stay on screen however short
 * the window is (the panel used to be the window height plus its own header, so the box fell off the bottom).
 */
for (const height of [560, 420]) {
  test(`the chat box and Send are on screen in a window ${height}px tall`, async ({ browser }) => {
    const page = await signedIn(browser, STAGING_USER);
    try {
      await page.setViewportSize({ width: 1400, height });
      await page.goto('/dashboard');
      const box = page.getByLabel('Chat message input');
      // the page loads lazily and the panel's open state is saved per user: wait for either control, then open if closed
      const open = page.getByRole('button', { name: 'Open AI Assistant' });
      await expect(box.or(open)).toBeVisible();
      await page.waitForLoadState('networkidle'); // the saved open/closed state arrives after the page: clicking before it toggles the panel shut again
      if (await open.isVisible()) await open.click();
      await expect(box).toBeVisible();
      // a chat with some answers in it (the app answers `help` itself, no AI credit): that is when the panel overflowed
      for (let i = 0; i < 3; i++) {
        await box.fill('help');
        await box.press('Enter');
        await expect(page.getByText('Commands you can type')).toHaveCount(i + 1);
      }
      for (const target of [box, page.getByRole('button', { name: 'Send message' })]) {
        const b = await target.boundingBox();
        expect(b, 'on the page').not.toBeNull();
        expect(b!.y).toBeGreaterThanOrEqual(0);
        expect(b!.y + b!.height).toBeLessThanOrEqual(height);
      }
    } finally {
      await page.context().close();
    }
  });
}
