import { describe, it, expect, vi, beforeAll } from 'vitest';
import Fastify from 'fastify';

/** 2026-10-09 audit (low): the whole client list went to everyone, guests (outsiders) included */
const who = vi.hoisted(() => ({ user: {} as Record<string, unknown> }));
vi.mock('../../middleware/auth', () => ({ authMiddleware: vi.fn(async (req: any) => { req.user = who.user; }) }));
vi.mock('../../middleware/requireScope', () => ({ requireScope: () => vi.fn(async () => {}) }));
vi.mock('../../services/ProjectGroupService', () => ({
  projectGroupService: { getGroups: vi.fn(async () => [{ id: 'g-acme', name: 'Acme' }, { id: 'g-globex', name: 'Globex' }]) },
}));
vi.mock('../../services/ClientService', () => ({ clientService: {}, ClientNotFoundError: class extends Error {} }));
vi.mock('../../utils/readableProjects', () => ({ readableProjectIds: vi.fn(async () => new Set(['p1'])) }));
const query = vi.hoisted(() => vi.fn(async () => [{ group_id: 'g-acme' }]));
vi.mock('../../database/connection', () => ({ databaseService: { query } }));

import { projectGroupRoutes } from '../../routes/core/projectGroups';

describe('client list', () => {
  let app: any;
  beforeAll(async () => { app = Fastify(); await app.register(projectGroupRoutes, { prefix: '/api/v1/project-groups' }); }, 60_000);

  it('a company member sees every client', async () => {
    who.user = { userId: 'u1', role: 'team_member' };
    const res = await app.inject({ method: 'GET', url: '/api/v1/project-groups' });
    expect(res.json().groups.map((g: any) => g.name)).toEqual(['Acme', 'Globex']);
  });

  it('a guest sees only the clients of projects they are on', async () => {
    who.user = { userId: 'g1', role: 'viewer', isGuest: true };
    const res = await app.inject({ method: 'GET', url: '/api/v1/project-groups' });
    expect(res.json().groups.map((g: any) => g.name)).toEqual(['Acme']);
    expect(query).toHaveBeenCalledWith(expect.stringContaining('FROM projects WHERE id IN (?)'), ['p1']);
  });
});
