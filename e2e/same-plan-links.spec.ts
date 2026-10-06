import { test, expect } from '@playwright/test';
import { STAGING_USER } from './staging-helpers';
import { signedIn, makeProject, makeTask, archiveProject, thisMonday, plusDays } from './qa-data';

/**
 * A parent (summary), epic or predecessor must be a task in the SAME plan (2026-10-05 audit).
 * Against real staging: two projects of the QA PM; pointing A's task at B's task is refused on
 * create, edit and bulk edit, and the same thing inside A still works. Both archived at the end.
 */
test('parents, epics and links stay inside one plan', async ({ browser }) => {
  const pm = await signedIn(browser, STAGING_USER);
  const a = await makeProject(pm, 'QA – e2e same plan A', thisMonday(), plusDays(thisMonday(), 30));
  const b = await makeProject(pm, 'QA – e2e same plan B', thisMonday(), plusDays(thisMonday(), 30));
  try {
    const dates = { startDate: plusDays(thisMonday(), 7), endDate: plusDays(thisMonday(), 9) };
    const summaryA = await makeTask(pm, a.scheduleId, { name: 'A summary', ...dates });
    const taskA = await makeTask(pm, a.scheduleId, { name: 'A task', ...dates });
    const taskB = await makeTask(pm, b.scheduleId, { name: 'B task', ...dates });

    // create under another plan's task
    const create = await pm.request.post(`/api/v1/schedules/${a.scheduleId}/tasks`, { data: { name: 'stray', ...dates, parentTaskId: taskB.id } });
    expect(create.status()).toBe(400);
    expect(JSON.stringify(await create.json())).toMatch(/same schedule/);

    // edit: parent and epic from another plan
    for (const field of ['parentTaskId', 'epicId']) {
      const res = await pm.request.put(`/api/v1/schedules/${a.scheduleId}/tasks/${taskA.id}`, { data: { [field]: taskB.id } });
      expect(res.status(), field).toBe(400);
    }

    // bulk edit: predecessor and parent from another plan
    for (const field of ['dependency', 'parentTaskId']) {
      const res = await pm.request.put('/api/v1/bulk/tasks', { data: { updates: [{ id: taskA.id, scheduleId: a.scheduleId, [field]: taskB.id }] } });
      const body = await res.json();
      expect(JSON.stringify(body), field).toMatch(/same schedule/);
    }

    // inside the same plan it still works
    const ok = await pm.request.put(`/api/v1/schedules/${a.scheduleId}/tasks/${taskA.id}`, { data: { parentTaskId: summaryA.id } });
    expect(ok.status()).toBe(200);
  } finally {
    await archiveProject(pm, a.projectId);
    await archiveProject(pm, b.projectId);
    await pm.close();
  }
});
