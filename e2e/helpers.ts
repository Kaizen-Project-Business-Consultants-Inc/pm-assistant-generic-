import { Page, expect } from '@playwright/test';

/** Test credentials — must match a real user in the dev database */
export const TEST_USER = {
  username: 'admin',
  password: 'admin123',
};

/** Mock user returned by the mocked login API.
 *  Uses project_manager role so the PM sidebar (with Mjuzi AI, etc.) renders
 *  instead of the admin-only sidebar. */
export const MOCK_USER = {
  id: 'test-user-1',
  username: 'admin',
  email: 'admin@test.com',
  fullName: 'Test Admin',
  role: 'project_manager',
  subscriptionTier: 'consultant',
  subscriptionStatus: 'active',
};

/**
 * Set up route interception for all API calls so tests can run
 * without a real backend server.
 */
export async function setupMockApi(page: Page) {
  await page.route('**/api/v1/**', async (route) => {
    const url = route.request().url();
    const method = route.request().method();

    if (url.includes('/auth/login') && method === 'POST') {
      return route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({ user: MOCK_USER }),
      });
    }

    if (url.includes('/auth/me') || url.includes('/users/me')) {
      return route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify(MOCK_USER),
      });
    }

    // Project creation — return a project with ID so the app can redirect
    if (url.includes('/projects') && method === 'POST') {
      return route.fulfill({
        status: 201,
        contentType: 'application/json',
        body: JSON.stringify({
          id: 'proj-new',
          name: 'New Project',
          status: 'active',
          methodology: 'agile',
          health: 0,
        }),
      });
    }

    // Project favourites
    if (url.includes('/projects/favourites') && method === 'GET') {
      return route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify([]),
      });
    }

    // Risk stats for a project
    if (/\/projects\/[^/]+\/risks\/stats/.test(url) && method === 'GET') {
      return route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({ total: 0, open: 0, closed: 0, bySeverity: {} }),
      });
    }

    // Other project sub-routes (risks, members, etc.)
    if (/\/projects\/[^/]+\/(risks|members|goals|health)/.test(url) && method === 'GET') {
      return route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify([]),
      });
    }

    // Single project detail (must come before the list match)
    if (/\/projects\/[^/]+$/.test(new URL(url).pathname) && method === 'GET') {
      return route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          project: {
            id: 'proj-1',
            name: 'Demo Project',
            status: 'active',
            methodology: 'agile',
            health: 75,
            description: 'A demo project for testing',
            startDate: '2026-01-01',
            endDate: '2026-12-31',
          },
        }),
      });
    }

    if (url.includes('/projects') && method === 'GET') {
      return route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          projects: [
            { id: 'proj-1', name: 'Demo Project', status: 'active', methodology: 'agile', health: 75 },
          ],
          total: 1,
        }),
      });
    }

    // Schedules for a project
    if (url.includes('/schedules/project/') && method === 'GET') {
      return route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          schedules: [
            { id: 'sched-1', name: 'Main Schedule', projectId: 'proj-1', status: 'active' },
          ],
        }),
      });
    }

    // Tasks for a schedule
    if (/\/schedules\/[^/]+\/tasks/.test(url) && method === 'GET') {
      return route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({ tasks: [], total: 0 }),
      });
    }

    // Sprints
    if (url.includes('/sprints') && method === 'GET') {
      return route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({ sprints: [], total: 0 }),
      });
    }

    if (url.includes('/notifications') && method === 'GET') {
      return route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({ notifications: [], total: 0 }),
      });
    }

    if (method === 'GET') {
      return route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify([]),
      });
    }

    return route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({ success: true }),
    });
  });
}

/**
 * Log in via the UI login form with mocked backend API.
 * Sets up route interception so the login POST succeeds.
 */
export async function login(page: Page, user = TEST_USER) {
  await setupMockApi(page);
  await page.goto('/login');
  await page.fill('#username', user.username);
  await page.fill('#password', user.password);
  await page.getByRole('button', { name: 'Sign in' }).click();
  // Wait for redirect to dashboard (fullName is set so it goes to dashboard)
  await expect(page).toHaveURL(/\/dashboard/, { timeout: 15_000 });
}

/** Generate a unique name to avoid collisions between test runs */
export function uniqueName(prefix: string): string {
  return `${prefix} ${Date.now().toString(36)}`;
}
