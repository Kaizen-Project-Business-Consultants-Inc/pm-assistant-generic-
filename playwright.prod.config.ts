import { defineConfig } from '@playwright/test';

/**
 * Production smoke tests — runs against kovarti.com with real auth.
 *
 * Usage: npx playwright test --config playwright.prod.config.ts
 */
export default defineConfig({
  testDir: './e2e',
  testMatch: 'prod-smoke.spec.ts',
  globalSetup: './e2e/prod-auth.setup.ts',
  timeout: 60_000,
  expect: { timeout: 15_000 },
  fullyParallel: false,
  retries: 1,
  workers: 1,
  reporter: [['html', { open: 'never' }], ['list']],
  use: {
    baseURL: 'https://kovarti.com',
    headless: true,
    screenshot: 'only-on-failure',
    trace: 'retain-on-failure',
    storageState: './test-results/.prod-auth.json',
  },
  projects: [
    {
      name: 'chromium',
      use: { browserName: 'chromium' },
    },
  ],
});
