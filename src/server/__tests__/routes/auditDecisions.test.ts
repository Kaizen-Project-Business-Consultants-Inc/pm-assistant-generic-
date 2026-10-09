import { describe, it, expect } from 'vitest';
import { readFileSync } from 'fs';
import { join } from 'path';
import { neverConfirmedSql } from '../../constants/neverConfirmed';
import { UPGRADE_REQUIRED_MESSAGE } from '../../middleware/requireTier';

/**
 * The user's decisions on the 2026-10-04 audit (2026-10-05): a paid-plan feature shows an upgrade
 * window; never-confirmed sign-ups are labelled and not counted, never deleted.
 */
const server = (...p: string[]) => readFileSync(join(__dirname, '..', '..', ...p), 'utf-8');
const client = (...p: string[]) => readFileSync(join(__dirname, '..', '..', '..', 'client', 'src', ...p), 'utf-8');

describe('paid-plan features: an upgrade window, not a bare error', () => {
  it('the refusal says what it is and that nothing is lost', () => {
    expect(UPGRADE_REQUIRED_MESSAGE).toMatch(/paid plans/);
    expect(UPGRADE_REQUIRED_MESSAGE).not.toMatch(/trial has ended/i);
  });

  it('the app opens the upgrade window when someone tries a paid action (not on quiet page loads)', () => {
    const http = client('services', 'apiAreas', 'http.ts');
    expect(http).toMatch(/error\.response\?\.data\?\.code === 'UPGRADE_REQUIRED' &&\s*method !== 'get'/);
    expect(http).toMatch(/detail: \{ message: error\.response\.data\.message, upgrade: true \}/);
    expect(client('components', 'layout', 'UpgradePrompt.tsx')).toMatch(/detail\?\.upgrade \? 'Part of a paid plan'/);
  });
});

describe('never-confirmed sign-ups: labelled, not counted, never deleted', () => {
  it('one rule: email never confirmed and never signed in', () => {
    expect(neverConfirmedSql('u')).toBe('(COALESCE(u.email_verified, 0) = 0 AND u.last_login_at IS NULL)');
  });

  it('the admin counts leave them out and say how many there are', () => {
    const admin = server('routes', 'admin', 'admin.ts');
    expect(admin).toMatch(/FROM users WHERE NOT \$\{neverConfirmedSql\(\)\}\) AS total_users/);
    expect(admin).toMatch(/AS never_confirmed_users/);
    // each company's count, all in one read since 2026-10-09: the never-confirmed are still left out
    expect(server('routes', 'admin', 'operations.ts')).toMatch(/FROM users WHERE NOT \$\{neverConfirmedSql\(\)\} GROUP BY organization_id/);
    expect(server('routes', 'admin', 'tenants.ts')).toMatch(/\$\{neverConfirmedSql\('u'\)\} AS never_confirmed/);
  });

  it('nothing deletes them', () => {
    for (const f of [['routes', 'admin', 'admin.ts'], ['routes', 'admin', 'tenants.ts'], ['routes', 'admin', 'operations.ts']]) {
      expect(server(...f)).not.toMatch(/DELETE FROM (users|organizations)[^;]*email_verified/);
    }
  });

  it('the admin pages show the label', () => {
    for (const f of [['pages', 'admin', 'AdminTenantsPage.tsx'], ['pages', 'admin', 'AdminOperationsPage.tsx'], ['pages', 'admin', 'AdminUsersPage.tsx']]) {
      expect(client(...f)).toMatch(/<NeverConfirmedBadge/);
    }
    // the live Operations page (pages/AdminPage.tsx was never routed — the figure is shown here)
    expect(client('pages', 'admin', 'AdminOperationsPage.tsx')).toMatch(/data\.summary\.neverConfirmedUsers/);
    expect(server('routes', 'admin', 'operations.ts')).toMatch(/summary: \{ totalTenants, totalUsers, neverConfirmedUsers, estimatedHeadroom \}/);
  });
});
