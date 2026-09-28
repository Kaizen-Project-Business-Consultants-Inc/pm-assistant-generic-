// Post-deploy smoke check (read-only): sign in as the dedicated smoke-test customer, open the
// dashboard and a project, and fail on any server error or error screen.
//
//   SMOKE_CREDENTIALS=path/to/prod-smoke-account.json node scripts/prod-smoke.cjs
//
// The credentials file ({ email, password, site }) is kept outside the repository. Never use a
// real customer's account, and never make changes here — this only looks.
const { chromium } = require('@playwright/test');
const fs = require('fs');

(async () => {
  const cred = JSON.parse(fs.readFileSync(process.env.SMOKE_CREDENTIALS, 'utf8'));
  const failures = [];
  const browser = await chromium.launch();
  const page = await browser.newPage({ baseURL: cred.site, viewport: { width: 1400, height: 900 } });
  page.on('response', (r) => { if (r.status() >= 500 && r.url().includes('/api/')) failures.push(`${r.status()} ${r.url()}`); });

  await page.goto('/login');
  await page.fill('#username', cred.email);
  await page.fill('#password', cred.password);
  await page.click('button[type="submit"]');
  await page.waitForURL((u) => !u.pathname.startsWith('/login'), { timeout: 30000 });

  await page.goto('/dashboard');
  await page.waitForTimeout(6000);
  if (!(await page.getByText('Morning Briefing').count())) failures.push('dashboard: no Morning Briefing');
  if (await page.getByText('This page encountered an error').count()) failures.push('dashboard: error screen');

  // Open the first project the account can see
  const projects = await page.request.get('/api/v1/projects');
  const body = await projects.json();
  const list = body.projects ?? body.data ?? [];
  if (list.length > 0) {
    await page.goto(`/project/${list[0].id}`);
    await page.waitForTimeout(5000);
    if (await page.getByText('This page encountered an error').count()) failures.push('project page: error screen');
    await page.goto(`/project/${list[0].id}?tab=schedule`);
    await page.waitForTimeout(5000);
    if (await page.getByText('This page encountered an error').count()) failures.push('schedule: error screen');
  } else failures.push('no projects visible');

  await page.goto('/notifications');
  await page.waitForTimeout(3000);
  await browser.close();

  if (failures.length) { console.log('SMOKE FAILED\n' + failures.join('\n')); process.exit(1); }
  console.log(`SMOKE OK — dashboard, project "${list[0]?.name}", schedule, notifications; no server errors`);
})().catch((e) => { console.log('SMOKE FAILED', e.message); process.exit(1); });
