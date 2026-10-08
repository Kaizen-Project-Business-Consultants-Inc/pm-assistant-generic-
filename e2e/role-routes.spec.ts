import { test, expect, Page } from '@playwright/test';
import { STAGING_USER, STAGING_TEAM_MEMBER } from './staging-helpers';
import { signedIn } from './qa-data';

/**
 * Pages a role can't open are hidden (user, 2026-10-08: "hide them"). One list —
 * src/client/src/constants/roleRoutes.ts — drives the sidebar and the router: typing the address
 * of a page your role can't open lands on the dashboard. Read-only: it only opens pages.
 *
 * QA team member (Team Member role): every page below → /dashboard; the command palette (Ctrl+K)
 * doesn't offer them; the Account page shows no billing buttons.
 * QA PM (the company's owner, who works as PMO): every page below still opens.
 */
const HIDDEN_FOR_TEAM = [
  '/clients', '/portfolio', '/resources', '/meetings', '/change-requests', '/workflows', '/intake',
  '/integrations', '/analytics', '/evm', '/monte-carlo', '/scenarios', '/report-builder', '/agent',
];

async function openAndWait(page: Page, path: string) {
  await page.goto(path);
  // the app shell is up (the router has decided where we are)
  await expect(page.getByRole('navigation', { name: 'Primary' })).toBeVisible({ timeout: 30_000 });
}

test('team member: hidden pages land on the dashboard; no billing buttons; palette leaves them out', async ({ browser }) => {
  test.setTimeout(240_000);
  const team = await signedIn(browser, STAGING_TEAM_MEMBER);
  try {
    for (const path of [...HIDDEN_FOR_TEAM, '/workflows/some-id', '/resources?tab=workload']) {
      await openAndWait(team, path);
      await expect(team, `${path} should redirect`).toHaveURL(/\/dashboard$/);
    }

    // Back after a redirect doesn't bounce into it again
    await openAndWait(team, '/projects');
    await openAndWait(team, '/portfolio');
    await expect(team).toHaveURL(/\/dashboard$/);
    await team.goBack();
    await expect(team).toHaveURL(/\/projects$/);

    // pages reached from inside allowed pages still open
    for (const path of ['/projects', '/help', '/settings', '/timesheet', '/account', '/kpi/health']) {
      await openAndWait(team, path);
      await expect(team, `${path} should open`).toHaveURL(new RegExp(`${path.replace(/[/?]/g, '\\$&')}$`));
    }

    // Account: plan and usage only — the owner manages billing
    await openAndWait(team, '/account');
    await expect(team.getByRole('heading', { name: 'Account & Billing' })).toBeVisible({ timeout: 20_000 });
    await expect(team.getByText(/owner manages the plan/).first()).toBeVisible();
    for (const name of ['Manage Billing', 'Buy More Tokens', 'Add Seat', 'View Plans & Subscribe']) {
      await expect(team.getByText(name, { exact: true }), name).toHaveCount(0);
    }

    // Command palette: no hidden pages offered
    await openAndWait(team, '/dashboard');
    await team.keyboard.press('Control+k');
    await expect(team.getByText('Go to Projects')).toBeVisible();
    for (const label of ['Go to Workflows', 'Go to Portfolio', 'Go to Resources', 'Go to Analytics', 'Build Report', 'Go to Agent Proposals']) {
      await expect(team.getByText(label, { exact: true }), label).toHaveCount(0);
    }
  } finally {
    await team.context().close();
  }
});

test('QA PM (owner, works as PMO): every one of those pages still opens', async ({ browser }) => {
  test.setTimeout(240_000);
  const pm = await signedIn(browser, STAGING_USER);
  try {
    for (const path of HIDDEN_FOR_TEAM) {
      await openAndWait(pm, path);
      await expect(pm, `${path} should open for the PM`).toHaveURL(new RegExp(`${path}$`));
      await expect(pm.getByRole('heading', { name: 'Page not found' })).toHaveCount(0);
    }
    // the owner keeps the billing button (paid: Manage Billing; trial: View Plans & Subscribe)
    await openAndWait(pm, '/account');
    await expect(pm.getByText(/^(Manage Billing|View Plans & Subscribe)$/).first()).toBeVisible({ timeout: 20_000 });
  } finally {
    await pm.context().close();
  }
});
