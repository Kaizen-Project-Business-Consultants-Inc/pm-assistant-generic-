import { defineConfig } from '@playwright/test';

/**
 * Full staging test suite — pre-launch, Gantt columns, Team Planner, timesheets, financials,
 * weekly review and the schedule behaviour safety net (e2e/schedule-behaviour.spec.ts)
 * against the real staging server with real auth.
 *
 * Usage: npx playwright test --config playwright.staging-full.config.ts
 */
export default defineConfig({
  testDir: './e2e',
  testMatch: ['pre-launch.spec.ts', 'gantt-columns.spec.ts', 'team-planner.spec.ts', 'timesheets.spec.ts', 'financials.spec.ts', 'weekly-review.spec.ts', 'platform-admin.spec.ts', 'key-rights.spec.ts', 'people-rights.spec.ts', 'schedule-behaviour.spec.ts'],
  globalSetup: './e2e/staging-auth.setup.ts',
  timeout: 60_000,
  expect: { timeout: 15_000 },
  fullyParallel: false,
  retries: 1,
  workers: 1,
  reporter: [['html', { open: 'never' }], ['list']],
  use: {
    baseURL: 'https://pm.kpbc.ca',
    headless: true,
    screenshot: 'only-on-failure',
    trace: 'retain-on-failure',
    storageState: './test-results/.staging-auth.json',
    // e2e/qa-data.ts works out dates in UTC; the browser must agree (specs with a fixed clock override this)
    timezoneId: 'UTC',
  },
  projects: [
    {
      name: 'chromium',
      use: { browserName: 'chromium' },
    },
  ],
});
