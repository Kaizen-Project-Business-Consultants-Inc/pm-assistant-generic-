import { test, expect } from '@playwright/test';
import { STAGING_USER, STAGING_TEAM_MEMBER } from './staging-helpers';
import { signedIn, api, makeProject, makeTask, archiveProject, thisMonday, plusDays } from './qa-data';

/**
 * An item id in the URL must belong to the project in the URL (2026-10-05). Against real
 * staging: two projects of the QA PM; a comment on project B's task can't be deleted through
 * project A's address, a document id from elsewhere is refused, and "save as template" needs the
 * project's Manager/Owner. Both projects are archived at the end.
 */
test('items are matched to their own project', async ({ browser }) => {
  const pm = await signedIn(browser, STAGING_USER);
  const a = await makeProject(pm, 'QA – e2e child A', thisMonday(), plusDays(thisMonday(), 30));
  const b = await makeProject(pm, 'QA – e2e child B', thisMonday(), plusDays(thisMonday(), 30));
  try {
    const taskA = await makeTask(pm, a.scheduleId, { name: 'A task', startDate: plusDays(thisMonday(), 7), endDate: plusDays(thisMonday(), 9) });
    const taskB = await makeTask(pm, b.scheduleId, { name: 'B task', startDate: plusDays(thisMonday(), 7), endDate: plusDays(thisMonday(), 9) });
    const comment = (await api(pm, 'post', `/api/v1/schedules/${b.scheduleId}/tasks/${taskB.id}/comments`, { text: 'keep me' })).comment;

    // through project A's plan and task, B's comment matches nothing
    const wrong = await pm.request.delete(`/api/v1/schedules/${a.scheduleId}/tasks/${taskA.id}/comments/${comment.id}`);
    expect(wrong.status()).toBe(404);
    const still = await api(pm, 'get', `/api/v1/schedules/${b.scheduleId}/tasks/${taskB.id}/comments`);
    expect((still.comments ?? still.data ?? []).some((c: any) => c.id === comment.id)).toBe(true);
    // through its own task it goes
    expect((await pm.request.delete(`/api/v1/schedules/${b.scheduleId}/tasks/${taskB.id}/comments/${comment.id}`)).status()).toBe(200);

    // a document id that isn't this project's is refused on every document route
    const fake = '00000000-0000-4000-8000-000000000000';
    expect((await pm.request.patch(`/api/v1/projects/${a.projectId}/documents/${fake}`, { data: { description: 'x' } })).status()).toBe(404);
    expect((await pm.request.delete(`/api/v1/projects/${a.projectId}/documents/${fake}`)).status()).toBe(404);

    // save as template: someone who isn't the project's Manager/Owner is refused
    const team = await signedIn(browser, STAGING_TEAM_MEMBER);
    const refused = await team.request.post('/api/v1/templates/save-from-project', { data: { projectId: a.projectId, templateName: 'should not exist' } });
    expect([403, 404]).toContain(refused.status());
    await team.close();
  } finally {
    await archiveProject(pm, a.projectId);
    await archiveProject(pm, b.projectId);
    await pm.close();
  }
});
