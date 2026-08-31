import { chromium } from '@playwright/test';
import { STAGING_URL, STAGING_USER } from './staging-helpers';
import path from 'path';

export const STORAGE_STATE = path.join(__dirname, '..', 'test-results', '.staging-auth.json');

async function globalSetup() {
  const browser = await chromium.launch();
  const page = await browser.newPage();

  await page.goto(`${STAGING_URL}/login`);
  await page.fill('#username', STAGING_USER.username);
  await page.fill('#password', STAGING_USER.password);
  await page.getByRole('button', { name: 'Sign in' }).click();
  await page.waitForURL(/\/dashboard/, { timeout: 30_000 });

  // Save auth state (cookies + localStorage) for reuse across all tests
  await page.context().storageState({ path: STORAGE_STATE });

  await browser.close();
}

export default globalSetup;
