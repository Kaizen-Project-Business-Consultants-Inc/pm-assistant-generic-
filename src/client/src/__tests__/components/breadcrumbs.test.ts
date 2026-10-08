import { describe, it, expect } from 'vitest';
import { readFileSync } from 'fs';
import { join } from 'path';
import { matchPath } from 'react-router-dom';
import { buildBreadcrumbs } from '../../components/layout/TopBar';
import { ROUTES, ROUTE_PATTERNS } from '../../routes';

/**
 * Top-bar breadcrumbs (2026-10-08): a crumb links only to a page that exists. The KPI page's
 * "KPI" crumb used to link to /kpi and a client page's crumb to /clients/<id> — both "Page not found".
 */
const ALL_ROUTES: string[] = [...Object.values(ROUTES), ...Object.values(ROUTE_PATTERNS)];
const isRealPage = (path: string) => ALL_ROUTES.some(p => matchPath({ path: p, end: true }, path));

const ID = '0b6f1e2a-3c4d-4e5f-8a9b-0c1d2e3f4a5b';
/** A real path for a route pattern: params filled in, the trailing * given a sub-path */
const samplePath = (pattern: string) =>
  pattern.replace(/:id/g, ID).replace(':type', 'health').replace(':tab', 'risks').replace(':token', 'abc123').replace('/*', '/more');

describe('buildBreadcrumbs', () => {
  it.each(ALL_ROUTES.map(samplePath))('every crumb link on %s is a real page', path => {
    const crumbs = buildBreadcrumbs(path);
    expect(crumbs[0]).toEqual({ label: 'Home', to: ROUTES.dashboard });
    const bad = crumbs.filter(c => c.to && !isRealPage(c.to)).map(c => c.to);
    expect(bad).toEqual([]);
  });

  it('KPI page: "KPI" is plain text, not a link to /kpi', () => {
    const crumbs = buildBreadcrumbs('/kpi/health');
    expect(crumbs.map(c => c.label)).toEqual(['Home', 'KPI', 'Health']);
    expect(crumbs[1].to).toBeUndefined();
  });

  it('client RAID page: Clients (link) › client name (text) › RAID', () => {
    const crumbs = buildBreadcrumbs(`/clients/${ID}/raid`, { client: 'Acme Bank' });
    expect(crumbs).toEqual([
      { label: 'Home', to: '/dashboard' },
      { label: 'Clients', to: '/clients' },
      { label: 'Acme Bank' },
      { label: 'RAID', to: `/clients/${ID}/raid` },
    ]);
  });

  it('client report page before the name is known says "Client", never "Project"', () => {
    expect(buildBreadcrumbs(`/clients/${ID}/report`).map(c => c.label)).toEqual(['Home', 'Clients', 'Client', 'Report']);
  });

  it('project page: Projects links to /projects, then the project name', () => {
    expect(buildBreadcrumbs(`/project/${ID}`, { project: 'Loans' })).toEqual([
      { label: 'Home', to: '/dashboard' },
      { label: 'Projects', to: '/projects' },
      { label: 'Loans', to: `/project/${ID}` },
    ]);
    expect(buildBreadcrumbs(`/project/${ID}`)[2].label).toBe('Project');
  });

  it('a path with no page at all links nothing past Home', () => {
    expect(buildBreadcrumbs('/no-such/page').slice(1).every(c => !c.to)).toBe(true);
  });
});

describe('App.tsx routes come from routes.ts (so breadcrumbs know every page)', () => {
  it('every <Route path> is a ROUTES / ROUTE_PATTERNS value, apart from the known extras', () => {
    const app = readFileSync(join(__dirname, '../../App.tsx'), 'utf-8');
    const paths = [...app.matchAll(/<Route\s+path=(\{[^}]+\}|"[^"]*")/g)].map(m => m[1]);
    expect(paths.length).toBeGreaterThan(40);
    // '*' is "Page not found"; the OAuth callback is a hand-off, not a page with crumbs
    const extras = new Set(['"*"', '"/oauth/callback"']);
    const other = paths.filter(p => !extras.has(p) && !/^\{(ROUTES|ROUTE_PATTERNS)\.\w+\}$/.test(p));
    expect(other, 'declare new routes in routes.ts and use the constant in App.tsx').toEqual([]);
    // …and the other way: every constant really has a <Route>, so a crumb never links to a missing page
    const declared = new Set(paths);
    const unrouted = [
      ...Object.keys(ROUTES).map(k => `{ROUTES.${k}}`),
      ...Object.keys(ROUTE_PATTERNS).map(k => `{ROUTE_PATTERNS.${k}}`),
    ].filter(p => !declared.has(p));
    expect(unrouted, 'routes.ts constants with no <Route> in App.tsx').toEqual([]);
  });
});
