/**
 * Role permission matrix — calls EVERY server route as each role against a real server and
 * compares the answer with the rules the product owner set (Sep 2026):
 *   - only a project's Manager/Owner (and admin/PMO) change project data;
 *   - a team member reads the projects they're on, and may change only their own work:
 *     own time entries, own stand-ups / retro notes / votes,
 *     status / progress / comments on RAID items they own;
 *   - PM-only tools (RAID Review) are refused to everyone else, reads included;
 *   - nobody sees a project they're not on — neither a colleague in the same company nor
 *     someone from another company.
 *
 * Roles:
 *   team         the QA team member, on the QA project (as a Viewer)
 *   teamPrivate  the same team member, against a project in their company they're NOT on
 *                (the real leak test: another company's data lives in a separate database)
 *   outsider     a user from another company, against the QA project
 * The PM only READS (nothing is destroyed); the others call every route with an empty body.
 *
 * Verdicts: PASS · FAIL (data or a write reached the wrong person) · REVIEW (not a leak, but
 * the permission check let the request through: empty answer, or it reached validation) ·
 * ERROR (the route crashed on the request — a bug, not a permission problem) · ALLOWED
 * (a team member's own-work route).
 *
 *   node scripts/qa/permission-matrix.cjs [baseUrl] [routes.json]
 *   (routes.json from: npx tsx src/server/scripts/listRoutes.ts routes.json)
 *
 * Logins: the staging QA accounts (e2e/staging-helpers.ts). Staging or the test bed only.
 */
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const BASE = (process.argv[2] || 'https://pm.kpbc.ca').replace(/\/$/, '');
const ROUTES = process.argv[3] || path.join(__dirname, 'routes.json');
if (/kovarti\.com/.test(BASE)) { console.error('Refusing to run against production.'); process.exit(1); }
const PW = 'Test1234!';
const USERS = { pm: 'qa.pm@pm.kpbc.ca', team: 'qa.team@pm.kpbc.ca', outsider: 'qa.outsider@pm.kpbc.ca' };
// On the test bed the projects are created fresh by scripts/testbed/seed.cjs, which writes their ids
const SEEDED = /localhost|127\.0\.0\.1/.test(BASE) && fs.existsSync(path.join(process.cwd(), 'test-results', 'testbed-ids.json'))
  ? JSON.parse(fs.readFileSync(path.join(process.cwd(), 'test-results', 'testbed-ids.json'), 'utf8')) : null;
const PROJECT = SEEDED?.ids.projectId || '94dbbc5a-a9d4-4113-b7d5-e0761b142bc4';                // "QA – team member checks" (team member is a Viewer)
const PRIVATE_PROJECT = SEEDED?.privateIds.projectId || 'df4892df-66c1-4a8d-addc-a0dad060ae3f'; // "QA – private project…" (team member NOT on it)

// Never called: anything acting on the CALLER'S OWN account or session — every /auth/ route
// ('delete my account' deleted two QA logins on 2026-09-29 and silently invalidated the run),
// leaving the company, billing, webhooks
const SKIP = [
  /\/auth\//, /delete-account/, /\/org\/leave/,
  /\/stripe\//, /\/webhooks?\/(incoming|stripe|slack)/, /\/slack\/(events|interactions|oauth)/,
  /^\/mcp/, /\/users\/me$/, /\/account$/, /\/portal\/[^/]*\/:token/, /\/invites\/.*accept/,
];
// Things a team member may change (their own work, their own settings) — "ALLOWED", not failures
const TEAM_OWN_WORK = [
  /\/time-entries/, /\/standups?/, /\/retro/, /\/votes?/,
  /\/risks\/:riskId(\/(comments|updates|progress))?$/, /\/notifications/, /\/feedback/,
  /\/ai-chat/, /\/users\/me/, /\/profile/, /\/preferences/, /\/timesheets?/, /\/favourite$/, /\/telemetry\//,
];
// Reads the team member must NOT get (PM-only tools)
const PM_ONLY_READS = [/\/raid-review/];
// The caller's own preferences, whoever the project belongs to (removing your own favourite)
const PERSONAL = [/\/favourite$/, /\/telemetry\//];
const PROJECT_SCOPED = /:projectId|:scheduleId|:taskId|:riskId|:sprintId|:meetingId|:baselineId|:calendarId|\/projects\/:id|\/schedules\/:id|\/sprints\/:id|\/meetings\/:id/;
const NAMES_PROJECT = /:projectId|:scheduleId|:taskId|\/projects\/:id|\/schedules\/:id/;

const sleep = ms => new Promise(r => setTimeout(r, ms));

async function login(email) {
  const r = await fetch(`${BASE}/api/v1/auth/login`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ username: email, password: PW }) });
  if (!r.ok) throw new Error(`login ${email}: ${r.status}`);
  return r.headers.getSetCookie().map(c => c.split(';')[0]).join('; ');
}

async function call(cookie, method, url, body) {
  for (let attempt = 0; attempt < 4; attempt++) {
    const r = await fetch(BASE + url, {
      // No JSON header on GET/DELETE: an empty body labelled as JSON is rejected (400) before
      // any permission check, which made every DELETE look like it "reached validation"
      method, headers: method === 'GET' || method === 'DELETE' ? { cookie } : { 'content-type': 'application/json', cookie },
      body: method === 'GET' || method === 'DELETE' ? undefined : JSON.stringify(body ?? {}),
      redirect: 'manual',
    });
    if (r.status === 429) { await sleep(3000 * (attempt + 1)); continue; }
    return { status: r.status, text: await r.text() };
  }
  return { status: 429, text: '' };
}

const pick = (o, ...keys) => { for (const k of keys) { const v = k.split('.').reduce((a, p) => a?.[p], o); if (v) return v; } return undefined; };

/** Find-or-create the items routes point at, as the QA PM. Missing ones get a random id. */
async function fixtures(pm) {
  const ids = { projectId: PROJECT };
  const j = async (m, u, b) => { const r = await call(pm, m, u, b); try { return JSON.parse(r.text); } catch { return {}; } };
  const sch = await j('GET', `/api/v1/schedules/project/${PROJECT}`);
  ids.scheduleId = pick(sch, 'schedules.0.id', 'data.0.id');
  const tasks = await j('GET', `/api/v1/schedules/${ids.scheduleId}/tasks`);
  ids.taskId = pick(tasks, 'tasks.0.id', 'data.0.id'); ids.predecessorId = pick(tasks, 'tasks.1.id', 'data.1.id');
  const risks = await j('GET', `/api/v1/projects/${PROJECT}/risks`);
  ids.riskId = pick(risks, 'data.0.id');
  const sprints = await j('GET', `/api/v1/sprints?projectId=${PROJECT}`);
  ids.sprintId = pick(sprints, 'sprints.0.id', 'data.0.id')
    || pick(await j('POST', '/api/v1/sprints', { projectId: PROJECT, scheduleId: ids.scheduleId, name: 'QA sprint', startDate: '2026-10-05', endDate: '2026-10-16' }), 'sprint.id', 'data.id', 'id');
  ids.meetingId = pick(await j('POST', '/api/v1/meetings', { projectId: PROJECT, title: 'QA meeting', meetingDate: '2026-10-06' }), 'meeting.id', 'data.id', 'id');
  const baselines = await j('GET', `/api/v1/schedules/${ids.scheduleId}/baselines`);
  ids.baselineId = pick(baselines, 'baselines.0.id', 'data.0.id')
    || pick(await j('POST', `/api/v1/schedules/${ids.scheduleId}/baselines`, { name: 'QA baseline' }), 'baseline.id', 'data.id', 'id');
  ids.calendarId = pick(await j('GET', `/api/projects/${PROJECT}/calendars/default`), 'calendar.id');
  ids.memberId = pick(await j('GET', `/api/v1/projects/${PROJECT}/members`), 'members.0.id', 'data.0.id');
  return ids;
}

async function privateFixtures(pm) {
  const j = async (u) => { const r = await call(pm, 'GET', u); try { return JSON.parse(r.text); } catch { return {}; } };
  const ids = { projectId: PRIVATE_PROJECT };
  ids.scheduleId = pick(await j(`/api/v1/schedules/project/${PRIVATE_PROJECT}`), 'schedules.0.id');
  ids.taskId = pick(await j(`/api/v1/schedules/${ids.scheduleId}/tasks`), 'tasks.0.id', 'data.0.id');
  return ids;
}

/** Fill a route's :params. `:id` is read from the path segment before it. */
function fill(url, ids) {
  let missing = false;
  const out = url.replace(/:([A-Za-z]+)/g, (_, name, offset) => {
    if (name === 'id') {
      const seg = url.slice(0, offset).split('/').filter(Boolean).pop() || '';
      const byPrefix = { projects: 'projectId', schedules: 'scheduleId', sprints: 'sprintId', meetings: 'meetingId', tasks: 'taskId', risks: 'riskId', baselines: 'baselineId' };
      const v = ids[byPrefix[seg]];
      if (v) return v;
      missing = true; return crypto.randomUUID();
    }
    if (ids[name]) return ids[name];
    missing = true;
    return name === 'type' || name === 'entityType' ? 'project' : crypto.randomUUID();
  });
  return { url: out, missing };
}

const carries = (text, needles) => needles.some(n => n && text.includes(n));

function verdict(role, method, route, status, missing, text, needles) {
  const write = method !== 'GET';
  const scoped = PROJECT_SCOPED.test(route) && !missing;
  // 400 'project_unknown' is the permission check refusing a change it can't place — a refusal
  const refused = status === 401 || status === 403 || status === 404 || (status === 400 && text.includes('project_unknown'));
  const ok = status >= 200 && status < 300;
  if (status >= 500) return ['ERROR', 'server error (the route crashed on this request)'];
  if (PERSONAL.some(r => r.test(route))) return ['ALLOWED', "the caller's own preference"];
  if (role === 'outsider' || role === 'teamPrivate') {
    const who = role === 'outsider' ? 'user from another company' : 'team member on a project they are not on';
    if (scoped && ok && carries(text, needles)) return ['FAIL', `${who} received that project's data`];
    if (scoped && ok && write) return ['FAIL', `${who}: write succeeded`];
    if (scoped && ok) return ['REVIEW', `${who} got an empty answer instead of a refusal`];
    if (scoped && write && (status === 400 || status === 422) && !refused) return ['REVIEW', `${who}: write reached validation before a permission check`];
    return ['PASS', ''];
  }
  // team member, on the QA project as a Viewer
  if (!write) {
    if (PM_ONLY_READS.some(r => r.test(route))) return ok ? ['FAIL', 'PM-only read given to a team member'] : ['PASS', ''];
    return ['PASS', ''];
  }
  if (TEAM_OWN_WORK.some(r => r.test(route))) return ['ALLOWED', 'own-work route'];
  if (refused) return ['PASS', ''];
  if (ok) return [missing ? 'REVIEW' : 'FAIL', 'team member: write succeeded'];
  if (!refused && status === 400 || status === 422 || status === 409) return ['REVIEW', 'team member: write reached validation before a permission check'];
  return ['PASS', ''];
}

(async () => {
  const routes = JSON.parse(fs.readFileSync(ROUTES, 'utf8'));
  const cookies = { pm: await login(USERS.pm), team: await login(USERS.team), outsider: await login(USERS.outsider) };
  const ids = await fixtures(cookies.pm);
  const pids = await privateFixtures(cookies.pm);
  console.error('[fixtures]', JSON.stringify(ids), '[private]', JSON.stringify(pids));
  const needles = [...Object.values(ids), 'QA – team member checks'];
  const privNeedles = [...Object.values(pids), 'QA – private project', 'Secret task'];
  const rows = [];
  for (const rt of routes) {
    const key = `${rt.method} ${rt.url}`;
    if (!rt.url.startsWith('/api') || rt.method === 'TRACE' || SKIP.some(r => r.test(rt.url))) { rows.push({ route: key, skipped: true }); continue; }
    const { url, missing } = fill(rt.url, ids);
    const row = { route: key, missing };
    if (rt.method === 'GET') row.pm = (await call(cookies.pm, 'GET', url)).status;
    for (const role of ['team', 'outsider']) {
      const r = await call(cookies[role], rt.method, url, {});
      const [v, why] = verdict(role, rt.method, rt.url, r.status, missing, r.text, needles);
      row[role] = r.status; row[`${role}Verdict`] = v; if (why) row[`${role}Why`] = why;
    }
    if (NAMES_PROJECT.test(rt.url)) {
      const p = fill(rt.url, pids);
      const r = await call(cookies.team, rt.method, p.url, {});
      const [v, why] = verdict('teamPrivate', rt.method, rt.url, r.status, p.missing, r.text, privNeedles);
      row.teamPrivate = r.status; row.teamPrivateVerdict = v; if (why) row.teamPrivateWhy = why;
    }
    rows.push(row);
    await sleep(40);
  }
  const outFile = path.join(process.cwd(), 'test-results', 'permission-matrix.json');
  fs.mkdirSync(path.dirname(outFile), { recursive: true });
  fs.writeFileSync(outFile, JSON.stringify({ base: BASE, at: new Date().toISOString(), ids, privateIds: pids, rows }, null, 1));
  const ROLES = ['team', 'teamPrivate', 'outsider'];
  const count = (role, v) => rows.filter(r => r[`${role}Verdict`] === v).length;
  const tested = rows.filter(r => !r.skipped).length;
  console.log(`Routes: ${routes.length} · called: ${tested} · skipped: ${routes.length - tested}`);
  for (const role of ROLES) console.log(`${role.padEnd(11)} PASS ${count(role, 'PASS')} · FAIL ${count(role, 'FAIL')} · REVIEW ${count(role, 'REVIEW')} · ERROR ${count(role, 'ERROR')} · own-work ${count(role, 'ALLOWED')}`);
  for (const v of ['FAIL', 'REVIEW', 'ERROR']) {
    console.log(`\n== ${v}`);
    for (const r of rows) for (const role of ROLES) {
      if (r[`${role}Verdict`] === v) console.log(`${r.route}  [${role}=${r[role]}] ${r[`${role}Why`] || ''}${r.missing ? ' [no test item for this route]' : ''}`);
    }
  }
  // A run is only valid if every login still works at the end: a deleted or locked account
  // turns every later answer into a refusal that looks like a pass
  for (const [role, email] of Object.entries(USERS)) {
    try { await login(email); } catch { console.log(`\nRUN INVALID: ${role} (${email}) can no longer sign in`); process.exit(3); }
  }
  console.log(`\nReport: ${outFile}`);
  process.exit(rows.some(r => ROLES.some(role => r[`${role}Verdict`] === 'FAIL')) ? 1 : 0);
})().catch(e => { console.error(e); process.exit(2); });
