import { describe, it, expect } from 'vitest';
import { readFileSync, readdirSync } from 'fs';
import { join } from 'path';
import { isPlatformAdmin } from '../../utils/platformAdmin';

/**
 * Guard (2026-10-04, user rule "admin owns nothing"): 'admin' is the Kovarti platform admin
 * only — the role AND no company. Until then every platform screen checked only the role, and
 * a company owner could hand that role to a member (see utils/platformAdmin.ts).
 */
const server = join(__dirname, '..', '..');
const client = join(server, '..', 'client', 'src');
const read = (p: string) => readFileSync(p, 'utf-8');
const code = (p: string) => read(p).split('\n').filter(l => !/^\s*(\/\/|\*)/.test(l)).join('\n');

describe('isPlatformAdmin', () => {
  it('is the admin role with no company — nothing else', () => {
    expect(isPlatformAdmin({ role: 'admin', hasCompany: false })).toBe(true);
    expect(isPlatformAdmin({ role: 'admin', hasCompany: true })).toBe(false);
    expect(isPlatformAdmin({ role: 'admin' })).toBe(false); // unknown → no (fail closed)
    expect(isPlatformAdmin({ role: 'pmo', hasCompany: false })).toBe(false);
    expect(isPlatformAdmin(undefined)).toBe(false);
  });
});

describe('platform screens use the platform-admin check, never the bare role', () => {
  const adminDir = join(server, 'routes', 'admin');
  const files = readdirSync(adminDir).filter(f => f.endsWith('.ts'));

  it.each(files)('routes/admin/%s', (f) => {
    const src = code(join(adminDir, f));
    expect(src, 'checks the bare role').not.toMatch(/role\s*[!=]==?\s*'admin'/);
    // every file that registers a route and is admin-only must use the shared check
    if (/fastify\.(get|post|put|patch|delete)\(/.test(src) && f !== 'auditTrail.ts') {
      expect(src).toMatch(/isPlatformAdmin\(|platformAdminOnly/);
    }
  });

  it.each([
    ['routes/core/feedback.ts', 2],
    ['routes/agent/killSwitch.ts', 3],
    ['routes/ai/skills.ts', 2],
  ])('%s: every all-company admin route is platform-admin only', (file, n) => {
    const src = code(join(server, file));
    const adminScoped = src.match(/requireScope\('admin'\)[^\]]*\]/g) ?? [];
    expect(adminScoped).toHaveLength(n as number);
    for (const h of adminScoped) expect(h).toMatch(/platformAdminOnly/);
  });

  it('the support-visit switch checks the platform admin', () => {
    expect(code(join(server, 'middleware', 'tenantResolver.ts'))).toMatch(/if \(isPlatformAdmin\(request\.user\)\)/);
  });

  it('system alerts go only to the platform admin', () => {
    const src = code(join(server, 'services', 'AlertService.ts'));
    for (const m of src.match(/role = 'admin'[^"]*/g) ?? []) expect(m).toMatch(/organization_id IS NULL/);
  });
});

describe('no company screen offers admin', () => {
  it('server: invite and role-change lists come from COMPANY_ASSIGNABLE_ROLES', () => {
    const src = code(join(server, 'routes', 'core', 'org.ts'));
    expect(src).not.toMatch(/z\.enum\(\[[^\]]*'admin'/);
    expect(src.match(/z\.enum\(COMPANY_ASSIGNABLE_ROLES\)/g)?.length).toBe(2);
  });

  it('client: Settings → Team has no Admin option', () => {
    expect(code(join(client, 'pages', 'settings', 'TeamTab.tsx'))).not.toMatch(/value:\s*'admin'/);
  });

  it('client: admin pages and the admin menu need the platform admin', () => {
    expect(code(join(client, 'App.tsx'))).toMatch(/requiredRole === 'admin' && !isPlatformAdmin\(user\)/);
    expect(code(join(client, 'pages', 'admin', 'AdminPageWrapper.tsx'))).toMatch(/!isPlatformAdmin\(user\)/);
    expect(code(join(client, 'components', 'layout', 'Sidebar.tsx'))).toMatch(/const isAdmin = isPlatformAdmin\(user\)/);
  });
});
