import { test, expect } from '@playwright/test';
import { STAGING_USER } from './staging-helpers';
import { signedIn, api, makeProject, makeTask, archiveProject, thisMonday, plusDays } from './qa-data';

/**
 * Client resource pools on real staging (U8, 2026-10-14). As the QA PM: two clients, a person in
 * client A's pool and a placeholder role in client B's; a project for client A.
 *  - Another client's person can't go on the project's tasks — task edit, bulk edit and hours
 *    booking all refuse it with a plain message; client A's person can.
 *  - The project's team takes client A's person, never client B's; the pickers list only A + My resources.
 *  - Each pool's people list, rate card and holiday calendar are its own; switching client A to a
 *    calendar with a holiday on a task's start previews the task moving.
 *  - A client with people in its pool can't be deleted.
 * Everything made here is archived / deleted at the end (the QA calendar is reused across runs).
 */
test("client pools: one client's people never reach another client's project", async ({ browser }) => {
  test.setTimeout(120_000);
  const pm = await signedIn(browser, STAGING_USER);
  const stamp = Date.now().toString(36);
  const start = thisMonday();
  const clientA = await api(pm, 'post', '/api/v1/project-groups', { name: `QA Pool A ${stamp}`, color: '#0f766e' });
  const clientB = await api(pm, 'post', '/api/v1/project-groups', { name: `QA Pool B ${stamp}`, color: '#b45309' });
  const personA = (await api(pm, 'post', '/api/v1/resources', {
    name: `QA Pool Ann ${stamp}`, role: 'Developer', email: `qa.pool.ann.${stamp}@pm.kpbc.ca`, clientId: clientA.id,
  })).resource;
  const genericB = (await api(pm, 'post', '/api/v1/resources', { name: `QA Pool B Dev ${stamp}`, role: 'Developer', isGeneric: true, clientId: clientB.id })).resource;
  const project = await makeProject(pm, `QA – pool project ${stamp}`, start, plusDays(start, 40));
  try {
    await api(pm, 'put', `/api/v1/projects/${project.projectId}`, { clientId: clientA.id });
    const holiday = plusDays(start, 14); // a Monday
    const task = await makeTask(pm, project.scheduleId, { name: 'Build', startDate: holiday, endDate: plusDays(holiday, 2) });

    // ── tasks: B's person refused everywhere, with a message a PM can act on ──
    const viaEdit = await pm.request.put(`/api/v1/schedules/${project.scheduleId}/tasks/${task.id}`, { data: { assignedTo: genericB.id } });
    expect(viaEdit.status()).toBe(400);
    expect((await viaEdit.json()).message).toMatch(/another client's resource pool/);
    const viaBulk = await api(pm, 'put', '/api/v1/bulk/tasks', { updates: [{ id: task.id, scheduleId: project.scheduleId, assignedTo: genericB.id }] });
    expect(viaBulk.failed[0].error).toMatch(/another client's resource pool/);
    const viaBooking = await pm.request.post('/api/v1/resources/assignments', {
      data: { resourceId: genericB.id, taskId: task.id, scheduleId: project.scheduleId, hoursPerWeek: 10, startDate: holiday, endDate: plusDays(holiday, 2) },
    });
    expect(viaBooking.status()).toBe(400);
    // …while A's person goes on, and an edit of the task's name afterwards still saves
    await api(pm, 'put', `/api/v1/schedules/${project.scheduleId}/tasks/${task.id}`, { assignedTo: personA.id });
    await api(pm, 'put', `/api/v1/schedules/${project.scheduleId}/tasks/${task.id}`, { name: 'Build it' });

    // ── team ──
    const pool = await api(pm, 'get', `/api/v1/projects/${project.projectId}/team-pool`);
    expect(pool.clientPool.map((p: any) => p.id)).toContain(personA.id);
    expect([...pool.clientPool, ...pool.mine].map((p: any) => p.id)).not.toContain(genericB.id);
    expect((await pm.request.post(`/api/v1/projects/${project.projectId}/team`, { data: { resourceId: genericB.id } })).status()).toBe(400);
    const team = await api(pm, 'post', `/api/v1/projects/${project.projectId}/team`, { resourceId: personA.id });
    expect(team.team.map((p: any) => p.id)).toEqual([personA.id]);

    // ── each pool's own people and rate card ──
    const peopleA = (await api(pm, 'get', `/api/v1/resources?pool=${clientA.id}`)).resources.map((r: any) => r.id);
    expect(peopleA).toContain(personA.id);
    expect(peopleA).not.toContain(genericB.id);
    await api(pm, 'post', '/api/v1/rate-card', { role: 'Developer', hourlyRate: 123, effectiveFrom: start, poolId: clientA.id });
    const cardA = (await api(pm, 'get', `/api/v1/rate-card?poolId=${clientA.id}`)).rates;
    const cardB = (await api(pm, 'get', `/api/v1/rate-card?poolId=${clientB.id}`)).rates;
    expect(cardA.some((r: any) => r.hourlyRate === 123)).toBe(true);
    expect(cardB.some((r: any) => r.hourlyRate === 123)).toBe(false);

    // ── holiday calendar: a holiday on the task's first day moves it (preview only) ──
    let cal = (await api(pm, 'get', '/api/v1/holiday-calendars')).calendars.find((c: any) => c.name === 'QA pool test calendar');
    if (!cal) cal = (await api(pm, 'post', '/api/v1/holiday-calendars', { name: 'QA pool test calendar' })).calendar;
    // added if it isn't there yet (a second run in the same week finds it)
    await pm.request.post('/api/v1/company-holidays/apply', { data: { calendarId: cal.id, add: { date: holiday, name: 'QA holiday' } } });
    const preview = await api(pm, 'post', `/api/v1/project-groups/${clientA.id}/holiday-calendar/preview`, { calendarId: cal.id });
    expect(preview.tasksMoved).toBeGreaterThanOrEqual(1);

    // ── a client with people can't be deleted ──
    const del = await pm.request.delete(`/api/v1/project-groups/${clientA.id}`);
    expect(del.status()).toBe(409);
    expect((await del.json()).message).toMatch(/still has 1 person/);
  } finally {
    await archiveProject(pm, project.projectId);
    await pm.request.delete(`/api/v1/resources/${personA.id}`);
    await pm.request.delete(`/api/v1/resources/${genericB.id}`);
    await pm.request.delete(`/api/v1/project-groups/${clientA.id}`);
    await pm.request.delete(`/api/v1/project-groups/${clientB.id}`);
    await pm.close();
  }
});
