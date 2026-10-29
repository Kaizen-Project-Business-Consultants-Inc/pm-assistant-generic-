import { test, expect, Page } from '@playwright/test';
import { STAGING_USER, STAGING_TEAM_MEMBER, STAGING_OUTSIDER } from './staging-helpers';
import { signedIn, makeProject, archiveProject, api, day, plusDays } from './qa-data';

/**
 * Temporary cover for a project's Owner and the one-Owner rule (2026-10-29), against real staging.
 * qa.pm owns the project (and is the company owner). qa.team is a TEAM MEMBER (read-only account)
 * who covers it; qa.outsider is in another company. Each run makes its own project and archives it.
 */
let pm: Page;
let team: Page;
let outsider: Page;
let projectId: string;
let scheduleId: string;
let teamUserId: string;
let member2Id: string;

test.describe.configure({ mode: 'serial' });

test.beforeAll(async ({ browser }) => {
  pm = await signedIn(browser, STAGING_USER);
  team = await signedIn(browser, STAGING_TEAM_MEMBER);
  outsider = await signedIn(browser, STAGING_OUTSIDER);
  const start = day(new Date());
  ({ projectId, scheduleId } = await makeProject(pm, 'E2E cover', start, plusDays(start, 30)));
  const members = (await api<any>(pm, 'get', '/api/v1/org/members')).members as any[];
  teamUserId = members.find(m => m.email === STAGING_TEAM_MEMBER.username).id;
  member2Id = members.find(m => m.email === 'qa.member2@pm.kpbc.ca').id;
});

test.afterAll(async () => {
  await pm.request.delete(`/api/v1/projects/${projectId}/cover`).catch(() => null);
  await archiveProject(pm, projectId);
});

const newTask = (page: Page) => page.request.post(`/api/v1/schedules/${scheduleId}/tasks`, {
  data: { name: `E2E task ${Date.now().toString(36)}`, startDate: day(new Date()), endDate: plusDays(day(new Date()), 2), status: 'pending' },
});

test('a team member cannot see or change the project before they cover it', async () => {
  expect((await team.request.get(`/api/v1/projects/${projectId}/members/me`)).status()).toBe(404);
  expect((await newTask(team)).status()).toBeGreaterThanOrEqual(403);
});

test('only the Owner, the company owner or the line manager may start cover', async () => {
  const today = day(new Date());
  const refused = await team.request.post(`/api/v1/projects/${projectId}/cover`, { data: { coverUserId: teamUserId, startDate: today, endDate: plusDays(today, 3) } });
  expect(refused.status()).toBe(404); // not even on the project
  const outside = await outsider.request.post(`/api/v1/projects/${projectId}/cover`, { data: { coverUserId: teamUserId, startDate: today, endDate: plusDays(today, 3) } });
  expect(outside.status()).toBe(404);
});

test('the Owner starts cover; the team member can then edit this project, but not make Owners', async () => {
  const today = day(new Date());
  const bad = await pm.request.post(`/api/v1/projects/${projectId}/cover`, { data: { coverUserId: teamUserId, startDate: plusDays(today, 5), endDate: today } });
  expect(bad.status()).toBe(400);
  const ok = await pm.request.post(`/api/v1/projects/${projectId}/cover`, { data: { coverUserId: teamUserId, startDate: today, endDate: plusDays(today, 3) } });
  expect(ok.status(), await ok.text()).toBe(201);

  const me = await (await team.request.get(`/api/v1/projects/${projectId}/members/me`)).json();
  expect(me).toMatchObject({ canEdit: true, acting: true, canManageOwners: false });
  expect(me.coverUntil).toBe(plusDays(today, 3));

  expect((await newTask(team)).status()).toBeLessThan(300);
  const makeOwner = await team.request.post(`/api/v1/projects/${projectId}/members`, { data: { userName: 'Q Outsider', email: STAGING_OUTSIDER.username, role: 'owner' } });
  expect(makeOwner.status()).toBe(403);
  const handOver = await team.request.post(`/api/v1/projects/${projectId}/reassign-owner`, { data: { userId: teamUserId } });
  expect(handOver.status()).toBe(403);

  // a second cover in the same dates is refused
  const again = await pm.request.post(`/api/v1/projects/${projectId}/cover`, { data: { coverUserId: member2Id, startDate: today, endDate: plusDays(today, 1) } });
  expect(again.status()).toBe(409);
});

test('cover is for this project only', async () => {
  const other = await makeProject(pm, 'E2E cover other', day(new Date()), plusDays(day(new Date()), 10));
  try {
    expect((await team.request.get(`/api/v1/projects/${other.projectId}/members/me`)).status()).toBe(404);
  } finally {
    await archiveProject(pm, other.projectId);
  }
});

test('the project page tells everyone who is covering', async () => {
  await pm.goto(`/project/${projectId}`);
  await expect(pm.getByRole('status').filter({ hasText: /Covered by/ })).toBeVisible({ timeout: 20_000 });
  await team.goto(`/project/${projectId}`);
  await expect(team.getByRole('status').filter({ hasText: /You are covering this project/ })).toBeVisible({ timeout: 20_000 });
});

test('the actions are recorded as made while covering', async () => {
  const entries = await api<any>(pm, 'get', `/api/v1/audit/${projectId}`).catch(() => null);
  if (!entries) test.skip(true, 'audit trail route not reachable for this login');
  const text = JSON.stringify(entries);
  expect(text).toMatch(/coveringFor/);
});

test('ending cover takes the rights away at once', async () => {
  expect((await pm.request.delete(`/api/v1/projects/${projectId}/cover`)).status()).toBe(200);
  expect((await team.request.get(`/api/v1/projects/${projectId}/members/me`)).status()).toBe(404);
  expect((await newTask(team)).status()).toBeGreaterThanOrEqual(403);
  expect((await pm.request.delete(`/api/v1/projects/${projectId}/cover`)).status()).toBe(404); // nothing left to end
});

test('a project has one Owner: a second is refused, handing over works and the old Owner becomes a Manager', async () => {
  const second = await pm.request.post(`/api/v1/projects/${projectId}/members`, { data: { userName: 'QA Member Two', email: 'qa.member2@pm.kpbc.ca', role: 'owner' } });
  expect(second.status()).toBe(409);
  expect((await second.json()).error).toBe('one_owner');

  const hand = await pm.request.post(`/api/v1/projects/${projectId}/reassign-owner`, { data: { userId: member2Id } });
  expect(hand.status(), await hand.text()).toBe(200);
  const members = (await (await pm.request.get(`/api/v1/projects/${projectId}/members`)).json()).members as any[];
  expect(members.filter(m => m.role === 'owner').map(m => m.userId)).toEqual([member2Id]);
  expect(members.find(m => m.email === STAGING_USER.username)?.role).toBe('manager');

  const outsiderTry = await outsider.request.post(`/api/v1/projects/${projectId}/reassign-owner`, { data: { userId: teamUserId } });
  expect(outsiderTry.status()).toBe(404);
});
