import { describe, it, expect, vi, beforeAll } from 'vitest';
import Fastify from 'fastify';

/** Goals store only the owner's id; the list now carries their name (2026-09-30). */
vi.mock('../../middleware/auth', () => ({ authMiddleware: vi.fn(async (req: any) => { req.user = { userId: 'u1', role: 'project_manager' }; }) }));
vi.mock('../../middleware/requireScope', () => ({ requireScope: () => vi.fn(async () => {}) }));
vi.mock('../../utils/logger', () => ({ default: { info: vi.fn(), warn: vi.fn(), error: vi.fn() } }));
const goals = vi.hoisted(() => ({ list: vi.fn() }));
vi.mock('../../services/GoalService', () => ({ goalService: goals }));
const db = vi.hoisted(() => ({ queryControlPlane: vi.fn() }));
vi.mock('../../database/connection', () => ({ databaseService: db }));

import { goalRoutes } from '../../routes/goals';

describe("goals list shows each owner's name", () => {
  let app: any;
  beforeAll(async () => { app = Fastify(); await app.register(goalRoutes, { prefix: '/api/v1/goals' }); });

  it('adds ownerName from one lookup of all owners', async () => {
    goals.list.mockResolvedValue([
      { id: 'g1', name: 'Win the bid', ownerId: 'u1' },
      { id: 'g2', name: 'Sign 3 clients', ownerId: 'u2' },
      { id: 'g3', name: 'Orphan', ownerId: 'gone' },
    ]);
    db.queryControlPlane.mockResolvedValue([
      { id: 'u1', full_name: 'QA Project Manager', username: 'qa_pm' },
      { id: 'u2', full_name: '', username: 'qa_team' },
    ]);
    const res = await app.inject({ method: 'GET', url: '/api/v1/goals' });
    expect(res.statusCode).toBe(200);
    expect(res.json().goals.map((g: any) => g.ownerName)).toEqual(['QA Project Manager', 'qa_team', null]);
    expect(db.queryControlPlane).toHaveBeenCalledTimes(1);
  });

  it('a failed name lookup never breaks the goals list', async () => {
    goals.list.mockResolvedValue([{ id: 'g1', name: 'Win the bid', ownerId: 'u1' }]);
    db.queryControlPlane.mockRejectedValue(new Error('db down'));
    const res = await app.inject({ method: 'GET', url: '/api/v1/goals' });
    expect(res.statusCode).toBe(200);
    expect(res.json().goals[0].ownerName).toBeNull();
  });
});
