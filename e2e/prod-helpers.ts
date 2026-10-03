import { Page, expect } from '@playwright/test';

export const PROD_URL = 'https://kovarti.com';

import { readFileSync } from 'fs';

/**
 * The prod test login comes from the same file as scripts/prod-smoke.cjs
 * (SMOKE_CREDENTIALS=path/to/prod-smoke-account.json, kept outside the repository).
 * It used to be hard-coded to mike_todo@yahoo.com, an account that no longer exists (2026-10-03).
 */
function prodCredentials(): { username: string; password: string } {
  const file = process.env.SMOKE_CREDENTIALS;
  if (!file) throw new Error('Set SMOKE_CREDENTIALS to the prod smoke-account JSON file ({ email, password }) to run the prod tests.');
  const c = JSON.parse(readFileSync(file, 'utf8'));
  return { username: c.email, password: c.password };
}

export const PROD_USER = prodCredentials();

export async function prodLogin(page: Page) {
  await page.goto('/login');
  await page.fill('#username', PROD_USER.username);
  await page.fill('#password', PROD_USER.password);
  await page.getByRole('button', { name: 'Sign in' }).click();
  await expect(page).toHaveURL(/\/dashboard/, { timeout: 30_000 });
}
