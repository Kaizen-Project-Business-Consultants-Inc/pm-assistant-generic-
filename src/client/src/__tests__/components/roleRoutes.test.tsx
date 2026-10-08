/**
 * Which pages each role may open (user, 2026-10-08: "hide them"). One list —
 * constants/roleRoutes.ts — drives the sidebar menu and the router's RoleRouteGuard:
 *  - the sidebar per role must agree with canOpenPath() item for item, so they can't drift;
 *  - the per-role table below is the deliberate answer; changing who sees what fails here;
 *  - the guard sends a role to the dashboard (replacing the history entry) and lets the rest through.
 */
import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, cleanup, screen, fireEvent } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter, Routes, Route, useLocation, useNavigate } from 'react-router-dom';

vi.mock('../../services/api', () => ({
  apiService: {
    getFavouriteProjects: vi.fn().mockResolvedValue({ projects: [] }),
    getAiBudget: vi.fn().mockResolvedValue({ percentUsed: 0 }),
  },
}));

import Sidebar from '../../components/layout/Sidebar';
import { RoleRouteGuard } from '../../components/layout/RoleRouteGuard';
import { PM_NAV_SECTIONS, GUEST_HIDDEN_PATHS, canOpenPath } from '../../constants/roleRoutes';
import { useAuthStore, type User } from '../../stores/authStore';
import { ROUTES } from '../../routes';
import en from '../../i18n/en.json';

afterEach(() => { cleanup(); useAuthStore.setState({ user: null, isAuthenticated: false, isLoading: false }); });

const ALL_ROLES: User['role'][] = ['admin', 'executive', 'project_manager', 'team_member', 'scrum_master', 'finance_officer', 'risk_manager', 'pmo', 'ba', 'qa', 'tester', 'devops', 'claude_sme', 'viewer'];

function signIn(role: User['role'], extra: Partial<User> = {}) {
  const user = {
    id: 'u1', username: 'u', email: 'u@x', fullName: 'Q Person', role, emailVerified: true,
    organization: { id: 'o1', name: 'Co', slug: 'co', isOwner: false }, ...extra,
  } as User;
  useAuthStore.setState({ user, isAuthenticated: true, isLoading: false });
  return user;
}

const label = (key: string) => key.split('.').reduce<any>((o, k) => o?.[k], en) as string;

/** What the real sidebar shows: [label, opens?] per menu item, in order */
function sidebarItems(): Array<[string, boolean]> {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  render(
    <MemoryRouter initialEntries={['/dashboard']}>
      <QueryClientProvider client={qc}><Sidebar collapsed={false} onToggle={() => {}} /></QueryClientProvider>
    </MemoryRouter>,
  );
  const nav = screen.getByRole('navigation', { name: 'Primary' });
  const rows = [...nav.querySelectorAll('a[href], [aria-disabled="true"]')]
    .filter(el => !el.getAttribute('href')?.startsWith('/project/')); // pinned projects
  return rows.map(el => [el.textContent!.trim(), el.tagName === 'A']);
}

const MENU = PM_NAV_SECTIONS.flatMap(s => s.items);

describe('sidebar ⇄ role map (they cannot drift)', () => {
  for (const role of ALL_ROLES) {
    for (const isGuest of role === 'viewer' ? [false, true] : [false]) {
      it(`${role}${isGuest ? ' (guest)' : ''}: every menu item is shown and opens exactly when the map allows it`, () => {
        const user = signIn(role, { isGuest });
        const expected = MENU
          .filter(i => !(isGuest && GUEST_HIDDEN_PATHS.has(i.path)))
          .map(i => [label(i.labelKey), canOpenPath(user, i.path)]);
        expect(sidebarItems()).toEqual(expected);
      });
    }
  }
});

describe('who may open what (deliberate — change here only on purpose)', () => {
  const RESTRICTED = ['/clients', '/portfolio', '/resources', '/meetings', '/change-requests', '/workflows', '/intake', '/integrations', '/analytics', '/evm', '/monte-carlo', '/scenarios', '/report-builder', '/agent'];
  const hiddenFor = (role: User['role'], isGuest = false) => RESTRICTED.filter(p => !canOpenPath({ role, isGuest }, p));

  it('PMO (and the company owner, who works as PMO) and admin open everything', () => {
    expect(hiddenFor('pmo')).toEqual([]);
    expect(hiddenFor('admin')).toEqual([]);
  });
  it('project manager: everything but Portfolio', () => {
    expect(hiddenFor('project_manager')).toEqual(['/portfolio']);
  });
  it('executive: everything but Integrations and AI Proposals', () => {
    expect(hiddenFor('executive')).toEqual(['/integrations', '/agent']);
  });
  it('team member, viewer and the other roles: none of the restricted pages', () => {
    for (const r of ['team_member', 'viewer', 'scrum_master', 'ba', 'qa', 'tester', 'devops', 'finance_officer', 'risk_manager', 'claude_sme'] as const) {
      expect(hiddenFor(r), r).toEqual(RESTRICTED);
    }
  });
  it('pages outside the menu stay open to every role (project, help, account, KPI, own settings)', () => {
    for (const p of ['/dashboard', '/projects', '/project/abc?tab=raid', '/help', '/help/guide', '/account', '/kpi/health', '/settings?tab=rate-card', '/notifications', '/timesheet', '/goals', '/my-feedback', '/lessons', '/reports', '/query']) {
      expect(canOpenPath({ role: 'team_member' }, p), p).toBe(true);
      expect(canOpenPath({ role: 'viewer', isGuest: true }, p), `guest ${p}`).toBe(true);
    }
  });
  it('deep links and query strings under a hidden page are hidden too', () => {
    expect(canOpenPath({ role: 'team_member' }, '/workflows/abc-123')).toBe(false);
    expect(canOpenPath({ role: 'team_member' }, '/resources?tab=workload')).toBe(false);
    expect(canOpenPath({ role: 'team_member' }, '/clients/abc')).toBe(false);
    expect(canOpenPath({ role: 'project_manager' }, '/workflows/abc-123')).toBe(true);
  });
  it("a client's RAID and report stay open — Projects links them for everyone", () => {
    expect(canOpenPath({ role: 'team_member' }, '/clients/abc/raid')).toBe(true);
    expect(canOpenPath({ role: 'viewer' }, '/clients/abc/report')).toBe(true);
  });
  it("similar names don't match: /reports is not /report-builder, /project/x is not /projects", () => {
    expect(canOpenPath({ role: 'team_member' }, '/reports')).toBe(true);
    expect(canOpenPath({ role: 'team_member' }, '/report-builder')).toBe(false);
  });
  it('a guest also loses the guest-hidden menu pages, but keeps their own Settings', () => {
    expect(canOpenPath({ role: 'viewer', isGuest: true }, '/settings')).toBe(true);
    expect(canOpenPath({ role: 'viewer', isGuest: true }, '/intake')).toBe(false);
  });
  it('no one signed in: the guard leaves it to the sign-in redirect', () => {
    expect(canOpenPath(null, '/workflows')).toBe(true);
  });
});

describe('RoleRouteGuard', () => {
  function Where() {
    const loc = useLocation();
    const navigate = useNavigate();
    return <><p data-testid="at">{loc.pathname}</p><button onClick={() => navigate(-1)}>back</button></>;
  }
  function renderAt(entries: string[]) {
    render(
      <MemoryRouter initialEntries={entries} initialIndex={entries.length - 1}>
        <RoleRouteGuard>
          <Routes><Route path="*" element={<Where />} /></Routes>
        </RoleRouteGuard>
      </MemoryRouter>,
    );
    return () => screen.getByTestId('at').textContent;
  }

  it('sends a team member who types /workflows (or a deep link) to the dashboard', () => {
    signIn('team_member');
    expect(renderAt(['/workflows'])()).toBe(ROUTES.dashboard);
    cleanup();
    expect(renderAt(['/workflows/abc'])()).toBe(ROUTES.dashboard);
  });

  it('waits for /auth/me: a saved role from before a promotion does not redirect while loading', () => {
    signIn('team_member');
    useAuthStore.setState({ isLoading: true });
    expect(renderAt(['/workflows'])()).toBe('/workflows');
    useAuthStore.setState({ isLoading: false });
  });

  it('replaces the address, so Back goes to the page before — no loop', () => {
    signIn('team_member');
    const at = renderAt(['/projects', '/portfolio']);
    expect(at()).toBe(ROUTES.dashboard);
    fireEvent.click(screen.getByText('back'));
    expect(at()).toBe('/projects');
  });

  it('lets a project manager open /workflows and everyone open their allowed pages', () => {
    signIn('project_manager');
    expect(renderAt(['/workflows'])()).toBe('/workflows');
    cleanup();
    signIn('team_member');
    expect(renderAt(['/project/p1'])()).toBe('/project/p1');
    cleanup();
    expect(renderAt(['/account'])()).toBe('/account');
  });
});
