/**
 * Page robot (2026-10-08): walks the app on staging as the QA PM and as the QA team member and
 * fails on a link to "Page not found", a page crash, a failing request to our own server, or a
 * dead outside link. Read-only: it only opens pages — no buttons are pressed, nothing is saved.
 *
 * It starts at the dashboard, opens every screen in the app's route list (src/client/src/routes.ts,
 * ids filled in with real ones the user can see), every project tab, then follows in-app links
 * breadth-first. Pages are counted once per kind (/project/<any id>?tab=raid is one kind).
 *
 * Today's known problems are on ALLOW_LIST with a reason. The list can only shrink: an entry that
 * no longer happens fails the run with "remove it from the allow-list".
 */
import { test, expect, Browser, Page, Request } from '@playwright/test';
import { STAGING_USER, STAGING_TEAM_MEMBER, STAGING_URL } from './staging-helpers';
import { signedIn, api } from './qa-data';
import { ROUTES, ROUTE_PATTERNS } from '../src/client/src/routes';

type Who = 'pm' | 'team';
/** onlyIf: the entry is only checked when that kind of page was opened (it needs data the user may not have) */
interface Allowed { key: string; who: Who[]; reason: string; onlyIf?: string }

const ALLOW_LIST: Allowed[] = [
  { key: 'http: GET /api/v1/workflows/executions 400', who: ['team'], reason: 'KNOWN — efficiency report: Workflows page asks for executions a team member cannot list' },
];

/** Screens not opened from the route list: sign-in/sign-up flows, one-time tokens, and the
 *  onboarding wizard (which saves as you go) */
const SKIP_ROUTES = new Set<string>([
  ROUTES.home, ROUTES.login, ROUTES.register, ROUTES.smeRegister, ROUTES.verifyEmail, ROUTES.verifyEmailPending,
  ROUTES.forgotPassword, ROUTES.resetPassword, ROUTES.onboarding, ROUTE_PATTERNS.portal, '/oauth/callback',
]);
const PROJECT_TABS = ['overview', 'schedule', 'raid', 'insights', 'ai-insights', 'performance', 'scenarios', 'team', 'agent-activity', 'change-requests', 'sprints', 'backlog', 'resources', 'time', 'files', 'budget', 'automations', 'documents', 'weekly-review'];
const KPI_TYPES = ['health', 'overdue', 'risks', 'at-risk', 'budget-variance', 'budget-utilization'];
const MAX_PAGES = 90; // per user; the whole spec must stay around 3 minutes
const ORIGIN = new URL(STAGING_URL).origin;

/** One "kind" of page: ids replaced, only the ?tab= kept */
const ID_RE = /^([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}|\d+|[A-Za-z0-9_-]{24,})$/i;
const pathKind = (path: string) => path.split('/').map(s => (ID_RE.test(s) ? ':id' : s)).join('/') || '/';
function pageKind(u: URL) {
  const tab = u.searchParams.get('tab');
  return pathKind(u.pathname) + (tab ? `?tab=${tab}` : '');
}

function listOf(r: any, key: string): any[] {
  const v = r?.[key] ?? r?.data?.[key] ?? r?.data ?? r;
  return Array.isArray(v) ? v : [];
}

/** Every screen in the route list, with real ids this user can see */
async function routeListUrls(page: Page): Promise<string[]> {
  const projects = listOf(await api(page, 'get', '/api/v1/projects'), 'projects');
  const project = projects.find((p: any) => !p.isDemo) ?? projects[0];
  const groups = listOf(await page.request.get('/api/v1/project-groups').then(r => (r.ok() ? r.json() : [])), 'groups');
  const clientId = groups[0]?.id ?? projects.find((p: any) => p.clientId)?.clientId;
  const fill = (pattern: string): string[] => {
    if (pattern.startsWith('/project/')) return project ? [pattern.replace(':id', project.id).replace('/:tab/*', '/risks')] : [];
    if (pattern.startsWith('/clients/:id')) return clientId ? [pattern.replace(':id', clientId)] : [];
    if (pattern === ROUTE_PATTERNS.kpi) return KPI_TYPES.map(t => `/kpi/${t}`);
    return [pattern];
  };
  const urls = [...Object.values(ROUTES), ...Object.values(ROUTE_PATTERNS)].filter(r => !SKIP_ROUTES.has(r)).flatMap(fill);
  if (project) urls.push(...PROJECT_TABS.map(t => `/project/${project.id}?tab=${t}`));
  return urls;
}

/** Waits until our own server has been quiet for a moment. The app keeps some requests open for
 *  good (live updates), so a request older than a few seconds no longer counts as "busy". */
async function settle(page: Page, inflight: Map<Request, number>, lastActivity: () => number) {
  const start = Date.now();
  while (Date.now() - start < 6000) {
    await page.waitForTimeout(100);
    const now = Date.now();
    const busy = [...inflight.values()].some(t => now - t < 4000);
    if (!busy && now - lastActivity() >= 400 && now - start >= 500) return;
  }
}

async function crawl(who: Who, creds: { username: string; password: string }, browser: Browser) {
  const page = await signedIn(browser, creds);
  const seen = new Map<string, string>(); // problem -> first place it happened
  const note = (key: string, where: string) => { if (!seen.has(key)) seen.set(key, where); };
  let here = '/dashboard';
  const inflight = new Map<Request, number>();
  let last = Date.now();
  const writes = new Set<string>();

  page.on('pageerror', e => note(`pageerror: ${e.message.split('\n')[0].slice(0, 160)}`, here));
  page.on('request', r => {
    if (!r.url().startsWith(ORIGIN)) return;
    inflight.set(r, (last = Date.now()));
    if (r.method() !== 'GET') writes.add(`${r.method()} ${pathKind(new URL(r.url()).pathname)}`);
  });
  const done = (r: Request) => { if (inflight.delete(r)) last = Date.now(); };
  page.on('requestfinished', done);
  page.on('requestfailed', done);
  page.on('response', r => {
    const u = new URL(r.url());
    if (u.origin === ORIGIN && r.status() >= 400) note(`http: ${r.request().method()} ${pathKind(u.pathname)} ${r.status()}`, here);
  });

  const queue: { url: string; from: string }[] = (await routeListUrls(page)).map(url => ({ url, from: 'route list' }));
  queue.unshift({ url: '/dashboard', from: 'start' });
  const visited = new Set<string>();
  const external = new Map<string, string>(); // outside link -> page it is on
  let first = true;
  let pages = 0;
  const t0 = Date.now();

  while (queue.length && pages < MAX_PAGES) {
    const { url, from } = queue.shift()!;
    const kind = pageKind(new URL(url, ORIGIN));
    if (visited.has(kind)) continue;
    visited.add(kind);
    pages++;
    here = kind;
    if (first) {
      await page.goto(url);
      first = false;
    } else {
      // in-app navigation, as a click on a link does (no full reload)
      await page.evaluate(p => { window.history.pushState({}, '', p); window.dispatchEvent(new PopStateEvent('popstate')); }, url);
    }
    await settle(page, inflight, () => last);
    if (await page.getByRole('heading', { name: 'Page not found' }).isVisible().catch(() => false)) {
      note(`not-found: ${kind}`, `linked from ${from}`);
      continue;
    }
    const hrefs: string[] = await page.$$eval('a[href]', as => as.map(a => (a as HTMLAnchorElement).href));
    for (const href of hrefs) {
      if (/^(mailto|tel|javascript):/i.test(href)) continue;
      const u = new URL(href, ORIGIN);
      if (u.origin !== ORIGIN) { if (/^https?:$/.test(u.protocol) && !external.has(u.href.split('#')[0])) external.set(u.href.split('#')[0], kind); continue; }
      if (u.pathname.startsWith('/api/') || /logout|sign-?out/i.test(u.pathname)) continue; // downloads / signing out
      if (!visited.has(pageKind(u))) queue.push({ url: u.pathname + u.search, from: kind });
    }
  }

  // Outside links: a dead one is status >= 400 (HEAD, then GET when HEAD isn't allowed)
  const ext = [...external.entries()];
  for (let i = 0; i < ext.length; i += 6) {
    await Promise.all(ext.slice(i, i + 6).map(async ([href, where]) => {
      try {
        let r = await page.request.head(href, { timeout: 8000, failOnStatusCode: false, maxRedirects: 5 });
        if (r.status() === 405 || r.status() === 403) r = await page.request.get(href, { timeout: 8000, failOnStatusCode: false, maxRedirects: 5 });
        if (r.status() >= 400) note(`external: ${href} ${r.status()}`, where);
      } catch (e) {
        note(`external: ${href} unreachable`, where);
      }
    }));
  }

  console.log(`[linkcrawl ${who}] ${pages} pages, ${external.size} outside links, ${Math.round((Date.now() - t0) / 1000)} s; ${new Set(queue.map(q => pageKind(new URL(q.url, ORIGIN))).filter(k => !visited.has(k))).size} kinds of page left unopened`);
  console.log(`[linkcrawl ${who}] outside links: ${[...external.keys()].join(', ') || 'none'}`);
  console.log(`[linkcrawl ${who}] the app itself sent: ${[...writes].sort().join(', ') || 'nothing but GETs'}`);
  for (const [k, where] of seen) console.log(`[linkcrawl ${who}] ${k}  (at ${where})`);
  await page.context().close();

  const mine = ALLOW_LIST.filter(a => a.who.includes(who) && (!a.onlyIf || visited.has(a.onlyIf)));
  for (const a of ALLOW_LIST) if (a.who.includes(who) && a.onlyIf && !visited.has(a.onlyIf)) console.log(`[linkcrawl ${who}] not checked (no ${a.onlyIf} page to open): ${a.key}`);
  const allowed = new Set(ALLOW_LIST.filter(a => a.who.includes(who)).map(a => a.key));
  const fresh = [...seen.keys()].filter(k => !allowed.has(k)).map(k => `${k}  (at ${seen.get(k)})`);
  const gone = mine.filter(a => !seen.has(a.key)).map(a => a.key);
  return { who, pages, fresh, gone };
}

// Both users walk at the same time (two browser windows, one test worker) to keep the run near 3 minutes
test('page robot — QA PM and QA team member', async ({ browser }) => {
  test.setTimeout(170_000);
  const results = await Promise.all([crawl('pm', STAGING_USER, browser), crawl('team', STAGING_TEAM_MEMBER, browser)]);
  for (const r of results) {
    expect.soft(r.fresh, `${r.who}: new problems — fix them (or, if not fixable today, add to ALLOW_LIST marked "FOUND by linkcrawl <date>")`).toEqual([]);
    expect.soft(r.gone, `${r.who}: these no longer happen — remove it from the allow-list`).toEqual([]);
    expect.soft(r.pages, `${r.who}: opened too few pages — the robot is not getting around`).toBeGreaterThan(30);
  }
});
