import { describe, it, expect, vi, beforeAll, beforeEach } from 'vitest';
import Fastify from 'fastify';

/**
 * Someone without access must get the SAME answer whether an id exists or not (2026-10-08):
 * the automation check answered 404 for "not in this project" before checking the project, and
 * resuming a workflow run answered 404 for a missing run but 403 for someone else's.
 */
vi.mock('../../middleware/auth', () => ({ authMiddleware: vi.fn(async (req: any) => { req.user = { userId: 'outsider', role: 'project_manager' }; }) }));
vi.mock('../../middleware/requireScope', () => ({ requireScope: () => vi.fn(async () => {}) }));
vi.mock('../../middleware/requireFeature', () => ({ requireFeature: () => vi.fn(async () => {}) }));
vi.mock('../../utils/logger', () => ({ default: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() } }));
const access = vi.hoisted(() => ({ ok: false }));
vi.mock('../../middleware/requireProjectAccess', () => ({
  requireProjectAccess: () => vi.fn(async (_r: any, reply: any) => (access.ok ? undefined : reply.status(404).send({ error: 'Not found' }))),
  checkProjectRole: vi.fn(async () => (access.ok ? { ok: true } : { ok: false, status: 404, body: { error: 'Not found' } })),
  checkProjectRoleFor: vi.fn(async () => (access.ok ? { ok: true } : { ok: false, status: 404, body: { error: 'Not found' } })),
}));
const rules = vi.hoisted(() => ({ byId: {} as Record<string, any> }));
vi.mock('../../services/automation/AutomationService', () => ({
  automationService: { findById: vi.fn(async (id: string) => rules.byId[id] ?? null), list: vi.fn(async () => []) },
}));

import { automationRoutes } from '../../routes/automation/automations';

describe('automations: no way to learn which automations a project has without access', () => {
  let app: any;
  beforeAll(async () => { app = Fastify(); await app.register(automationRoutes, { prefix: '/api/v1/projects' }); }, 60_000);
  beforeEach(() => { vi.clearAllMocks(); access.ok = false; rules.byId = { 'in-p1': { id: 'in-p1', projectId: 'p1' } }; });

  it('an existing automation and a made-up id give the same answer to someone without access', async () => {
    const real = await app.inject({ method: 'GET', url: '/api/v1/projects/p1/automations/in-p1' });
    const fake = await app.inject({ method: 'GET', url: '/api/v1/projects/p1/automations/nope' });
    expect(real.statusCode).toBe(fake.statusCode);
    expect(real.statusCode).toBe(404); // a non-member gets 404, as checkProjectRoleFor answers
    // and the automation is never even looked up for someone who can't open the project
    const { automationService } = await import('../../services/automation/AutomationService');
    expect(automationService.findById).not.toHaveBeenCalled();
  });

  it('with access, a wrong id is still a plain 404', async () => {
    access.ok = true;
    expect((await app.inject({ method: 'GET', url: '/api/v1/projects/p1/automations/nope' })).statusCode).toBe(404);
  });
});

describe('workflow run resume: a run you cannot see answers 404, like a missing one', () => {
  it('executionPM checks visibility before the PM rule', async () => {
    const { readFileSync } = await import('fs');
    const { join } = await import('path');
    const src = readFileSync(join(__dirname, '..', '..', 'routes', 'collaboration', 'workflows.ts'), 'utf-8');
    const pm = src.slice(src.indexOf('const executionPM'), src.indexOf('export async function workflowRoutes'));
    expect(pm.indexOf('await executionReader(request, reply)')).toBeGreaterThan(-1);
    expect(pm.indexOf('await executionReader(request, reply)')).toBeLessThan(pm.indexOf('requirePMOrOrgAdmin'));
  });
});
