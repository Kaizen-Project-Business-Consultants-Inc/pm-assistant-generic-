/**
 * Fill a freshly reset test bed with known QA data, through the app's own sign-up / verify /
 * invite / change-password flows (the same way a customer would), then write the ids to
 * test-results/testbed-ids.json for the test suites.
 *
 *   node scripts/testbed/seed.cjs [baseUrl=http://localhost:8081]
 *
 * Needs the SSH tunnel to the test bed (see testbed.sh) — and SSH for two database steps the
 * app can't do by itself in a test: reading the email-verification token (no email is sent),
 * and putting the QA companies on paid plans (so trials don't expire or lock features).
 */
const { execFileSync } = require('child_process');
const fs = require('fs');
const path = require('path');
const os = require('os');

const BASE = (process.argv[2] || 'http://localhost:8081').replace(/\/$/, '');
if (!/localhost|127\.0\.0\.1/.test(BASE)) { console.error('The seed only runs against the test bed (through the tunnel).'); process.exit(1); }
const API = `${BASE}/api/v1`;
const PW = 'Test1234!';
const KEY = path.join(os.homedir(), '.ssh', 'ssh-key-2026-07-08 (1).key');

function sql(query) {
  return execFileSync('ssh', ['-i', KEY, 'ubuntu@147.5.127.99', `sudo mariadb pmtb -N -e "${query.replace(/"/g, '\\"')}"`], { encoding: 'utf8' }).trim();
}

async function req(method, url, body, cookie) {
  const headers = cookie ? { cookie } : {};
  if (body !== undefined) headers['content-type'] = 'application/json';
  const r = await fetch(API + url, { method, headers, body: body === undefined ? undefined : JSON.stringify(body) });
  const text = await r.text();
  let json; try { json = JSON.parse(text); } catch { json = text; }
  if (!r.ok) throw new Error(`${method} ${url} → ${r.status} ${text.slice(0, 200)}`);
  return { json, cookie: r.headers.getSetCookie?.().map(c => c.split(';')[0]).join('; ') };
}
const login = async (email, password = PW) => (await req('POST', '/auth/login', { username: email, password })).cookie;

async function signUp(email, username, fullName, company) {
  await req('POST', '/auth/register', { username, email, password: PW, fullName, organizationName: company });
  const token = sql(`SELECT email_verification_token FROM users WHERE email='${email}'`);
  const r = await fetch(`${API}/auth/verify-email?token=${token}`);
  if (!r.ok) throw new Error(`verify ${email}: ${r.status}`);
}

(async () => {
  // 1. Two companies
  await signUp('qa.pm@pm.kpbc.ca', 'qa_pm', 'QA Project Manager', 'QA Staging Co');
  await signUp('qa.outsider@pm.kpbc.ca', 'qa_outsider', 'QA Outsider', 'QA Outsider Co');
  sql(`UPDATE organizations SET subscription_tier='enterprise', subscription_status='active', trial_ends_at=NULL WHERE name='QA Staging Co'; UPDATE organizations SET subscription_tier='sme', subscription_status='active', trial_ends_at=NULL WHERE name='QA Outsider Co'; UPDATE users SET subscription_tier=IF(email='qa.outsider@pm.kpbc.ca','sme','enterprise'), subscription_status='active', trial_ends_at=NULL WHERE email LIKE 'qa.%'`);
  execFileSync('ssh', ['-i', KEY, 'ubuntu@147.5.127.99', 'redis-cli -n 5 FLUSHDB >/dev/null']); // drop cached plans
  const pm = await login('qa.pm@pm.kpbc.ca');

  // 2. The team member, invited the normal way
  const inv = await req('POST', '/org/invite', { email: 'qa.team@pm.kpbc.ca', role: 'team_member' }, pm);
  const temp = inv.json.tempPassword;
  const t0 = await login('qa.team@pm.kpbc.ca', temp);
  await req('POST', '/auth/change-password', { currentPassword: temp, newPassword: PW }, t0);
  const team = await login('qa.team@pm.kpbc.ca');
  const teamId = (await req('GET', '/auth/me', undefined, team)).json.user.id;

  // 3. A project the team member is on (as a Viewer), with a plan and a RAID item
  const ids = {};
  ids.projectId = (await req('POST', '/projects', { name: 'QA – team member checks', startDate: '2026-10-05', endDate: '2026-12-31' }, pm)).json.project.id;
  ids.scheduleId = (await req('POST', '/schedules', { projectId: ids.projectId, name: 'QA plan', startDate: '2026-10-05', endDate: '2026-12-31' }, pm)).json.schedule.id;
  ids.taskId = (await req('POST', `/schedules/${ids.scheduleId}/tasks`, { name: 'Design', startDate: '2026-10-05', endDate: '2026-10-09' }, pm)).json.task.id;
  ids.predecessorId = ids.taskId;
  const build = (await req('POST', `/schedules/${ids.scheduleId}/tasks`, { name: 'Build', startDate: '2026-10-12', endDate: '2026-10-16' }, pm)).json.task.id;
  await req('POST', `/schedules/${ids.scheduleId}/dependencies/bulk`, { links: [{ taskId: build, dependencyId: ids.taskId }] }, pm);
  const risk = await req('POST', `/projects/${ids.projectId}/risks`, { type: 'action', title: 'Book the kickoff workshop', ownerName: 'DBJ' }, pm);
  ids.riskId = risk.json.risk?.id || risk.json.data?.id || risk.json.id;
  await req('POST', `/projects/${ids.projectId}/members`, { userId: teamId, userName: 'QA Team Member', email: 'qa.team@pm.kpbc.ca', role: 'viewer' }, pm);

  // 4. A project in the same company the team member is NOT on
  const priv = {};
  priv.projectId = (await req('POST', '/projects', { name: 'QA – private project (team member NOT on it)' }, pm)).json.project.id;
  priv.scheduleId = (await req('POST', '/schedules', { projectId: priv.projectId, name: 'Private plan', startDate: '2026-10-05', endDate: '2026-12-31' }, pm)).json.schedule.id;
  priv.taskId = (await req('POST', `/schedules/${priv.scheduleId}/tasks`, { name: 'Secret task', startDate: '2026-10-05', endDate: '2026-10-09' }, pm)).json.task.id;

  const out = path.join(process.cwd(), 'test-results', 'testbed-ids.json');
  fs.mkdirSync(path.dirname(out), { recursive: true });
  fs.writeFileSync(out, JSON.stringify({ base: BASE, ids, privateIds: priv }, null, 1));
  console.log(`[seed] test bed ready — ${out}`);
})().catch(e => { console.error('[seed] failed:', e.message); process.exit(1); });
