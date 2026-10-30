import { test, expect, Page } from '@playwright/test';
import { STAGING_USER } from './staging-helpers';
import { signedIn, makeProject, makeTask, archiveProject, api, day, plusDays } from './qa-data';

/**
 * Linking tasks must stay quick on a real-sized plan (2026-10-29: "Link in order" took ~10 s and then
 * two reloads ~7 s more on a 37-task plan, with nothing on screen saying it was working).
 * 4 phases x 10 tasks; link every task to the one before it (35 links), then read the plan back.
 * The bounds are a smoke check, not a benchmark (staging is shared): the old per-task save took
 * ~4 s for these 35 links on a quiet server and ~10 s on the real 37-task plan; now it is well under 1 s.
 */
let pm: Page;
let projectId: string;
let scheduleId: string;
let ids: string[] = [];

test.beforeAll(async ({ browser }) => {
  pm = await signedIn(browser, STAGING_USER);
  const start = day(new Date());
  ({ projectId, scheduleId } = await makeProject(pm, 'E2E link speed', start, plusDays(start, 200)));
  for (let p = 1; p <= 4; p++) {
    const phase = await makeTask(pm, scheduleId, { name: `Phase ${p}`, startDate: start, endDate: plusDays(start, 2), status: 'pending', isSummary: true });
    ids.push(phase.id);
    for (let t = 1; t <= 9; t++) {
      const task = await makeTask(pm, scheduleId, { name: `P${p} task ${t}`, startDate: plusDays(start, t), endDate: plusDays(start, t + 2), status: 'pending', parentTaskId: phase.id });
      ids.push(task.id);
    }
  }
});

test.describe.configure({ mode: 'serial' });

test.afterAll(async () => { await archiveProject(pm, projectId); });

test('linking a 40-task plan in order is quick, and the plan loads quickly afterwards', async () => {
  const leaves = ids.filter((_, i) => i % 10 !== 0);
  const links = leaves.slice(1).map((id, i) => ({ taskId: id, dependencyId: leaves[i] }));
  const t0 = Date.now();
  const res = await pm.request.post(`/api/v1/schedules/${scheduleId}/dependencies/bulk`, { data: { links } });
  const linkMs = Date.now() - t0;
  expect(res.status(), await res.text()).toBeLessThan(300);
  const t1 = Date.now();
  await api(pm, 'get', `/api/v1/schedules/${scheduleId}/tasks?limit=200&offset=0`);
  const loadMs = Date.now() - t1;
  console.log(`LINK_SPEED link=${linkMs}ms links=${links.length} reload=${loadMs}ms`);
  expect(linkMs).toBeLessThan(3000);
  expect(loadMs).toBeLessThan(2000);
});

test('one new link that pushes the whole chain later is just as quick', async () => {
  const start = day(new Date());
  const late = await makeTask(pm, scheduleId, { name: 'Late supplier delivery', startDate: plusDays(start, 120), endDate: plusDays(start, 125), status: 'pending' });
  const leaves = ids.filter((_, i) => i % 10 !== 0);
  const t0 = Date.now();
  const res = await pm.request.post(`/api/v1/schedules/${scheduleId}/dependencies/bulk`, { data: { links: [{ taskId: leaves[0], dependencyId: late.id }] } });
  const linkMs = Date.now() - t0;
  const body = await res.json();
  expect(res.status(), JSON.stringify(body).slice(0, 300)).toBeLessThan(300);
  console.log(`LINK_SPEED one-link-pushes-chain link=${linkMs}ms moved=${(body.moved ?? []).length}`);
  expect((body.moved ?? []).length).toBeGreaterThan(0); // the late task really pushed the chain
  expect(linkMs).toBeLessThan(3000);
});
