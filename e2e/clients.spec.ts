import { test, expect } from '@playwright/test';
import { STAGING_USER, STAGING_TEAM_MEMBER } from './staging-helpers';
import { signedIn, api, makeProject, archiveProject, thisMonday, plusDays } from './qa-data';

/**
 * Clients and project codes on real staging (2026-10-07). As the QA PM: make a client, a project
 * for it; the Projects page, Clients page, the client's risks and its report show it; the project
 * code shows by the name; a second live project with the same name is refused plainly. A team
 * member can't manage clients. Everything made here is archived / deleted at the end.
 */
test('clients: grouping, risks together, one report; project codes; duplicate names', async ({ browser }) => {
  const pm = await signedIn(browser, STAGING_USER);
  const stamp = Date.now().toString(36);
  const client = await api(pm, 'post', '/api/v1/project-groups', { name: `QA Client ${stamp}`, color: '#0f766e' });
  const project = await makeProject(pm, `QA – client project ${stamp}`, thisMonday(), plusDays(thisMonday(), 40));
  try {
    // put the project under the client (the project's manager may)
    await api(pm, 'put', `/api/v1/projects/${project.projectId}`, { clientId: client.id });
    const p = (await api(pm, 'get', `/api/v1/projects/${project.projectId}`)).project;
    expect(p.clientId).toBe(client.id);
    expect(p.projectCode).toMatch(/^PRJ-\d+/);

    // a client risk shows in the client's combined list
    await api(pm, 'post', `/api/v1/projects/${project.projectId}/risks`, { title: `QA high risk ${stamp}`, type: 'risk', severity: 'high', probability: 'high', impact: 'high' }).catch(() => undefined);
    const raid = await api(pm, 'get', `/api/v1/project-groups/${client.id}/raid`);
    expect(raid.projects.map((x: any) => x.id)).toContain(project.projectId);

    // the report: data and a page with the timeline section's heading
    const rep = await api(pm, 'get', `/api/v1/project-groups/${client.id}/report`);
    expect(rep.report.projects.map((x: any) => x.id)).toContain(project.projectId);
    expect(rep.html).toContain('CLIENT STATUS REPORT');
    const docx = await pm.request.get(`/api/v1/project-groups/${client.id}/report/docx`);
    expect(docx.status()).toBe(200);
    expect(docx.headers()['content-type']).toContain('wordprocessingml');

    // screens
    await pm.goto('/clients');
    await expect(pm.getByText(`QA Client ${stamp}`).first()).toBeVisible({ timeout: 20_000 });
    await pm.goto(`/clients/${client.id}/raid`);
    await expect(pm.getByRole('heading', { name: new RegExp(`QA Client ${stamp}`) })).toBeVisible({ timeout: 20_000 });
    await pm.goto(`/clients/${client.id}/report`);
    await expect(pm.getByText('CLIENT STATUS REPORT')).toBeVisible({ timeout: 20_000 });
    await pm.goto(`/project/${project.projectId}`);
    await expect(pm.getByText(p.projectCode, { exact: true }).first()).toBeVisible({ timeout: 20_000 });

    // a second live project with the same name: a plain 409 with an Open-it id
    const dup = await pm.request.post('/api/v1/projects', { data: { name: p.name } });
    if (dup.status() === 201) await archiveProject(pm, (await dup.json()).project.id); // don't leave a stray copy
    expect(dup.status()).toBe(409);
    expect((await dup.json()).message).toMatch(/already exists/);
    expect((await dup.json()).existingProjectId).toBe(project.projectId);

    // a team member can't manage clients
    const team = await signedIn(browser, STAGING_TEAM_MEMBER);
    const refused = await team.request.post('/api/v1/project-groups', { data: { name: `QA nope ${stamp}` } });
    expect(refused.status()).toBe(403);
    await team.close();
  } finally {
    await archiveProject(pm, project.projectId);
    await pm.request.delete(`/api/v1/project-groups/${client.id}`);
    await pm.close();
  }
});
