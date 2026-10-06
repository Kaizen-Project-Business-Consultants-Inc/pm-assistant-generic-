import { describe, it, expect } from 'vitest';
import { readFileSync } from 'fs';
import { join } from 'path';
import { permissionRole } from '../../utils/companyOwner';

/**
 * The company owner may do everything a PMO can inside their company (user, 2026-10-05).
 * One rule, applied where the user becomes known (authMiddleware) and sent to the app
 * (/auth/login, /auth/me), so server checks and the app's menus agree.
 */
const src = (...p: string[]) => readFileSync(join(__dirname, '..', '..', ...p), 'utf-8');
const client = (...p: string[]) => readFileSync(join(__dirname, '..', '..', '..', 'client', 'src', ...p), 'utf-8');

describe('the company owner works as PMO', () => {
  it('owner → pmo, whatever their own role', () => {
    for (const role of ['project_manager', 'team_member', 'executive', 'viewer']) {
      expect(permissionRole(role, { isOwner: true })).toBe('pmo');
    }
  });

  it('everyone else keeps their role; guests and the platform admin are never elevated', () => {
    expect(permissionRole('project_manager', { isOwner: false })).toBe('project_manager');
    expect(permissionRole('team_member', { isOwner: true, isGuest: true })).toBe('team_member');
    expect(permissionRole('admin', { isOwner: true })).toBe('admin');
  });

  it('applied on sign-in by cookie and by key, and sent to the app with the own role kept for display', () => {
    const auth = src('middleware', 'auth.ts');
    expect(auth.match(/permissionRole\(/g)?.length).toBe(2);
    expect(auth.match(/\(o\.owner_user_id = u\.id\) AS is_owner/g)?.length).toBe(2);
    expect(auth).toMatch(/!request\.supportSession/); // never during the admin's Support view
    const routes = src('routes', 'core', 'auth.ts');
    expect(routes.match(/accountRole: user\.role/g)?.length).toBe(2);
  });

  it("the app shows the person's own role, and PMO (so the owner) sees the managers' menu items", () => {
    for (const f of [['components', 'layout', 'Sidebar.tsx'], ['components', 'layout', 'TopBar.tsx'], ['pages', 'settings', 'ProfileTab.tsx']]) {
      expect(client(...f)).toMatch(/roleLabel\(user\.accountRole \?\? user\.role\)/);
    }
    expect(client('components', 'layout', 'Sidebar.tsx')).toMatch(/NON_VIEWER_ROLES: NavItem\['roles'\] = \['admin', 'executive', 'project_manager', 'pmo'\]/);
  });
});
