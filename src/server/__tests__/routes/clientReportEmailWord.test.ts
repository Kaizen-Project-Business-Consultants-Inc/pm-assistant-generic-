import { describe, it, expect, vi, beforeAll, beforeEach } from 'vitest';
import Fastify from 'fastify';

/** U50 (user 2026-10-20): the emailed report says "department report" on the Team and Enterprise plans */
vi.mock('../../middleware/auth', () => ({ authMiddleware: vi.fn(async (req: any) => { req.user = { userId: 'u1', role: 'pmo' }; }) }));
vi.mock('../../middleware/requireScope', () => ({ requireScope: () => vi.fn(async () => {}) }));
vi.mock('../../middleware/rateLimiter', () => ({ heavyActionLimit: () => vi.fn(async () => {}) }));
vi.mock('../../utils/trialEmail', () => ({ trialEmailAllowance: () => vi.fn(async () => {}) }));
vi.mock('../../services/ProjectGroupService', () => ({ projectGroupService: {}, mergeIntoFullOrder: vi.fn() }));
vi.mock('../../services/ClientService', () => ({
  clientService: { report: vi.fn(async () => ({ client: { name: 'Finance' } })) },
  ClientNotFoundError: class extends Error {},
}));
vi.mock('../../utils/clientReportRenderer', () => ({ renderClientReportHtml: () => '<p>report</p>' }));
const email = vi.hoisted(() => ({ send: vi.fn(async () => {}) }));
vi.mock('../../services/EmailService', () => ({ emailService: { sendStatusReportEmail: email.send }, EmailRejectedError: class extends Error {} }));
const org = vi.hoisted(() => ({ tier: 'sme' as string }));
vi.mock('../../services/OrganizationService', () => ({ organizationService: { findByUserId: vi.fn(async () => ({ subscriptionTier: org.tier })) } }));

import { projectGroupRoutes } from '../../routes/core/projectGroups';

describe('emailed report subject', () => {
  let app: any;
  beforeAll(async () => { app = Fastify(); await app.register(projectGroupRoutes, { prefix: '/api/v1/project-groups' }); }, 60_000);
  beforeEach(() => email.send.mockClear());

  it.each([['sme', 'Finance (department report)'], ['enterprise', 'Finance (department report)'], ['consultant_pro', 'Finance (client report)'], ['trial', 'Finance (client report)']])(
    '%s → "%s"', async (tier, subject) => {
      org.tier = tier;
      const res = await app.inject({ method: 'POST', url: '/api/v1/project-groups/g1/report/email', payload: { recipients: ['a@acme.test'] } });
      expect(res.statusCode).toBe(200);
      expect(email.send).toHaveBeenCalledWith(['a@acme.test'], subject, expect.any(String));
    },
  );
});
