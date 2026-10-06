import { describe, it, expect, vi } from 'vitest';
import { readFileSync } from 'fs';
import { join } from 'path';
import { guestGuard, guestExpired } from '../../middleware/guestGuard';

/**
 * Guards for the 2026-10-05 audit's security lows: expired guests, live updates across
 * companies, links/parents into another plan, time on the sample, alert actions without AI.
 */
const src = (...p: string[]) => readFileSync(join(__dirname, '..', '..', ...p), 'utf-8');

function fakeReply() {
  const reply: any = { sent: false, code: 0, body: null };
  reply.status = (c: number) => { reply.code = c; return reply; };
  reply.send = (b: unknown) => { reply.body = b; reply.sent = true; return reply; };
  return reply;
}

describe('expired guests lose access', () => {
  const past = new Date(Date.now() - 86_400_000).toISOString();
  const future = new Date(Date.now() + 86_400_000).toISOString();

  it('knows when a guest has expired', () => {
    expect(guestExpired({ isGuest: true, guestExpiresAt: past })).toBe(true);
    expect(guestExpired({ isGuest: true, guestExpiresAt: future })).toBe(false);
    expect(guestExpired({ isGuest: true, guestExpiresAt: null })).toBe(false);
    expect(guestExpired({ isGuest: false, guestExpiresAt: past })).toBe(false);
  });

  it('an expired guest is refused (401, so the app signs them out), but can still sign out', async () => {
    const user = { userId: 'g', username: 'g', role: 'team_member', isGuest: true, guestExpiresAt: past };
    const r1 = fakeReply();
    await guestGuard({ user, url: '/api/v1/projects/p1', method: 'GET' } as any, r1);
    expect(r1.code).toBe(401);
    const r2 = fakeReply();
    await guestGuard({ user, url: '/api/v1/auth/logout', method: 'POST' } as any, r2);
    expect(r2.sent).toBe(false);
  });

  it('the guard runs inside authentication (cookie AND key paths), not as a global hook that sees nobody', () => {
    expect(src('routes.ts')).not.toMatch(/addHook\('onRequest', guestGuard\)/);
    const auth = src('middleware', 'auth.ts');
    expect(auth.match(/await guestGuard\(request, reply\)/g)?.length).toBe(2);
    expect(auth).toMatch(/SELECT u\.organization_id, u\.is_guest, u\.guest_expires_at/);
  });

  it('sign-in and session refresh refuse an expired guest', () => {
    expect(src('routes', 'core', 'auth.ts').match(/if \(guestExpired\(user\)\)/g)?.length).toBe(2);
  });
});

describe('live updates stay inside the company and project', () => {
  const ws = src('services', 'WebSocketService.ts');
  it('joining a project is checked inside the connection\'s own company, for every role', () => {
    expect(ws).toMatch(/static async canJoin\(/);
    expect(ws).toMatch(/runWithTenantContext\(info\.dbName, info\.orgId, check\)/);
    expect(ws).not.toMatch(/globalRoles/);
  });
  it('a broadcast with no project goes to nobody', () => {
    const block = ws.slice(ws.indexOf('No project = no audience'), ws.indexOf('No project = no audience') + 400);
    expect(block).not.toMatch(/client\.send/);
  });
});

describe('links, parents and epics stay in the same plan', () => {
  const svc = src('services', 'ScheduleService.ts');
  it('create and edit check the parent and the epic', () => {
    const create = svc.slice(svc.indexOf('async createTask(data'), svc.indexOf('const firstDep = deps[0]'));
    expect(create).toMatch(/validateSameScheduleRef\(null, data\.parentTaskId/);
    expect(create).toMatch(/validateSameScheduleRef\(null, data\.epicId/);
    const update = svc.slice(svc.indexOf('async updateTask(id'), svc.indexOf('const columnMap'));
    expect(update).toMatch(/validateSameScheduleRef\(id, data\.parentTaskId/);
    expect(update).toMatch(/validateSameScheduleRef\(id, data\.epicId/);
  });
  it('bulk edits check predecessor and parent', () => {
    expect(src('routes', 'core', 'bulk.ts')).toMatch(/SELECT id FROM tasks WHERE schedule_id = \? AND id IN/);
  });
  it('the check refuses a task in another plan, and the task itself', async () => {
    vi.resetModules();
    const { scheduleService } = await import('../../services/ScheduleService');
    const spy = vi.spyOn(scheduleService, 'findTaskById').mockImplementation(async (id: string) =>
      (id === 'other' ? { id, scheduleId: 's2' } : id === 'same' ? { id, scheduleId: 's1' } : null) as any);
    await expect(scheduleService.validateSameScheduleRef('t1', 'other', 's1', 'parent task')).rejects.toThrow(/same schedule/);
    await expect(scheduleService.validateSameScheduleRef('t1', 'missing', 's1', 'epic')).rejects.toThrow(/same schedule/);
    await expect(scheduleService.validateSameScheduleRef('t1', 't1', 's1', 'epic')).rejects.toThrow(/its own epic/);
    await expect(scheduleService.validateSameScheduleRef('t1', 'same', 's1', 'parent task')).resolves.toBeUndefined();
    spy.mockRestore();
  });
});

describe('smaller holes', () => {
  it('no time can be logged on the sample project', () => {
    expect(src('routes', 'resources', 'timeEntries.ts')).toMatch(/sample_read_only/);
  });
  it('acting on an alert needs a write key and the AI plan', () => {
    expect(src('routes', 'agent', 'alerts.ts')).toMatch(/\[requireScope\('write'\), requireFeature\('ai_assistant'\)\]/);
  });
});
