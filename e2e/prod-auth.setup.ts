import { chromium } from '@playwright/test';
import { PROD_URL, PROD_USER } from './prod-helpers';
import path from 'path';

export const STORAGE_STATE = path.join(__dirname, '..', 'test-results', '.prod-auth.json');

async function globalSetup() {
  const browser = await chromium.launch({ headless: true });
  const page = await browser.newPage();

  await page.goto(`${PROD_URL}/login`);
  await page.fill('#username', PROD_USER.username);
  await page.fill('#password', PROD_USER.password);
  await page.getByRole('button', { name: 'Sign in' }).click();

  // Wait for any navigation after login
  await page.waitForTimeout(10_000);
  const finalUrl = page.url();
  console.log('Post-login URL:', finalUrl);

  // Take screenshot for debugging
  await page.screenshot({ path: path.join(__dirname, '..', 'test-results', 'prod-login-debug.png') });

  if (finalUrl.includes('/login')) {
    // Login failed — check for error message
    const errorText = await page.locator('.bg-red-50, [role="alert"]').textContent().catch(() => 'no error element');
    throw new Error(`Login failed. Still on login page. Error: ${errorText}`);
  }

  // If on onboarding, navigate to dashboard
  if (finalUrl.includes('/onboarding')) {
    await page.goto(`${PROD_URL}/dashboard`);
    await page.waitForTimeout(3000);
  }

  await page.context().storageState({ path: STORAGE_STATE });
  await browser.close();
}

export default globalSetup;
