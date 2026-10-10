import { describe, it, expect, vi, beforeAll, beforeEach } from 'vitest';
import Fastify from 'fastify';

/**
 * Task ranking (2026-10-10 audit, C2): opening the panel (GET) never asks the AI; only the project's
 * PM, on a plan with AI, can press "Refine with AI" (POST …/prioritize/ai), and the service is asked
 * for AI only there.
 */
const who = vi.hoisted(() => ({ isPM: true, hasAI: true }));
vi.mock('../../middleware/auth', () => ({ authMiddleware: vi.fn(async (req: any) => { req.user = { userId: 'u1', role: 'project_manager' }; }) }));
vi.mock('../../middleware/requireScope', () => ({ requireScope: () => vi.fn(async () => {}) }));
vi.mock('../../middleware/requireProjectAccess', () => ({
  projectsOfSchedules: vi.fn(async () => ['p1']),
  // the real gate: manager (PM/owner) access on the project the schedule belongs to
  requireProjectAccess: (level: string) => async (_req: any, reply: any) => {
    if (level === 'manager' && !who.isPM) return reply.status(403).send({ error: 'Forbidden' });
  },
}));
vi.mock('../../middleware/requireTier', () => ({
  requireFeature: (feature: string) => async (_req: any, reply: any) => {
    if (feature === 'ai_assistant' && !who.hasAI) return reply.status(403).send({ error: 'Upgrade required' });
  },
}));
vi.mock('../../middleware/rateLimiter', () => ({ heavyActionLimit: () => vi.fn(async () => {}) }));
vi.mock('../../utils/logger', () => ({ default: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() } }));
const prioritizeTasks = vi.hoisted(() => vi.fn(async (..._a: any[]) => ({ tasks: [], aiPowered: false })));
vi.mock('../../services/TaskPrioritizationService', () => ({ taskPrioritizationService: { prioritizeTasks } }));

import { taskPrioritizationRoutes } from '../../routes/scheduling/taskPrioritization';

let app: any;
beforeAll(async () => { app = Fastify(); await app.register(taskPrioritizationRoutes, { prefix: '/api/v1/task-prioritization' }); }, 60_000);
beforeEach(() => { vi.clearAllMocks(); who.isPM = true; who.hasAI = true; });
const refine = () => app.inject({ method: 'POST', url: '/api/v1/task-prioritization/p1/s1/prioritize/ai', payload: {} });

describe('Refine with AI', () => {
  it("the project's PM on an AI plan gets the AI refinement", async () => {
    expect((await refine()).statusCode).toBe(200);
    expect(prioritizeTasks).toHaveBeenCalledWith('p1', 's1', { withAI: true });
  });

  it('someone who is not the project PM is refused, and the AI is not asked', async () => {
    who.isPM = false;
    expect((await refine()).statusCode).toBe(403);
    expect(prioritizeTasks).not.toHaveBeenCalled();
  });

  it('a plan without AI is refused, and the AI is not asked', async () => {
    who.hasAI = false;
    expect((await refine()).statusCode).toBe(403);
    expect(prioritizeTasks).not.toHaveBeenCalled();
  });

  it('opening the panel (GET) never asks for AI', async () => {
    await app.inject({ method: 'GET', url: '/api/v1/task-prioritization/p1/s1/prioritize' });
    expect(prioritizeTasks).toHaveBeenCalledTimes(1);
    expect(prioritizeTasks.mock.calls[0][2]).toBeUndefined();
  });
});
