import { describe, it, expect, vi, beforeAll } from 'vitest';
import Fastify from 'fastify';

/**
 * The AI-settings routes read `user.id` and `user.organizationId`, which the signed-in user
 * record never has — so a person's own and their company's AI settings were never applied
 * (found 2026-09-30). They must use request.user.userId and the request's company.
 */
vi.mock('../../middleware/auth', () => ({
  authMiddleware: vi.fn(async (req: any) => { req.user = { userId: 'u-7', role: 'project_manager' }; req.tenantOrg = { id: 'org-3', slug: 'acme', dbName: 'pmassist_t_acme' }; }),
}));
vi.mock('../../middleware/requireScope', () => ({ requireScope: () => vi.fn(async () => {}) }));
vi.mock('../../middleware/requireProjectAccess', () => ({ checkProjectRole: vi.fn(async () => ({ ok: true })) }));
const svc = vi.hoisted(() => ({ resolveContext: vi.fn(async () => ({})), formatForPrompt: vi.fn(() => '') }));
vi.mock('../../services/context/ContextConfigService', () => ({ contextConfigService: svc, CONFIG_KEY_SCHEMAS: {} }));

import { contextConfigRoutes } from '../../routes/ai/contextConfig';

describe('AI settings use the real user and company', () => {
  let app: any;
  beforeAll(async () => { app = Fastify(); await app.register(contextConfigRoutes, { prefix: '/api/v1/context' }); }, 60_000);

  it.each(['/api/v1/context/config', '/api/v1/context/preview'])('%s resolves for this user in this company', async (url) => {
    svc.resolveContext.mockClear();
    const res = await app.inject({ method: 'GET', url });
    expect(res.statusCode).toBe(200);
    expect(svc.resolveContext).toHaveBeenCalledWith('org-3', null, 'u-7');
  });
});
