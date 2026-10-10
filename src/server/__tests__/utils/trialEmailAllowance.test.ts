import { describe, it, expect, vi, beforeAll, beforeEach } from 'vitest';
import Fastify from 'fastify';

/**
 * The free trial needs no card, so its email must not work as a mail relay (2026-10-10): up to 5
 * people per email and 5 emails a day across every route that mails report content. Paid plans
 * keep each route's own limit. Uses the real rate limiter (no Redis in tests: in memory).
 */
const state = vi.hoisted(() => ({ tier: 'trial', userId: 'u1', role: 'project_manager', orgTier: 'trial' }));
vi.mock('../../services/UserService', () => ({ userService: { findById: vi.fn(async () => ({ id: state.userId, role: state.role, subscriptionTier: state.tier })) } }));
vi.mock('../../services/OrganizationService', () => ({ organizationService: { findByUserId: vi.fn(async () => ({ id: `org-${state.userId}`, subscriptionTier: state.orgTier })) } }));
vi.mock('../../database/connection', () => ({ databaseService: { query: vi.fn(async () => []) } }));
vi.mock('../../services/RedisService', () => ({ redisService: { isConnected: () => false } }));

import { trialEmailAllowance, TRIAL_EMAIL } from '../../utils/trialEmail';
import { whenSendingEmail } from '../../middleware/rateLimiter';

let app: ReturnType<typeof Fastify>;
beforeAll(async () => {
  app = Fastify();
  app.addHook('preHandler', async (req) => { req.user = { userId: state.userId, username: 'x', role: state.role }; });
  app.post('/send', { preHandler: [trialEmailAllowance()] }, async () => ({ sent: true }));
  app.post('/minutes', { preHandler: [trialEmailAllowance('recipientEmails')] }, async () => ({ sent: true }));
  app.put('/schedule', { preHandler: [trialEmailAllowance('recipients', false)] }, async () => ({ saved: true }));
  app.post('/generate', { preHandler: [whenSendingEmail(trialEmailAllowance())] }, async () => ({ ok: true }));
  await app.ready();
});

let n = 0;
beforeEach(() => {
  state.tier = 'trial';
  state.role = 'project_manager';
  state.orgTier = 'trial';
  state.userId = `u${++n}`; // a fresh daily allowance per test
});

const five = ['a@x.com', 'b@x.com', 'c@x.com', 'd@x.com', 'e@x.com'];

describe('trial email allowance', () => {
  it('a trial user can email up to 5 people', async () => {
    const res = await app.inject({ method: 'POST', url: '/send', payload: { recipients: five } });
    expect(res.statusCode).toBe(200);
  });

  it('a 6th person is refused with a message that says why', async () => {
    const res = await app.inject({ method: 'POST', url: '/send', payload: { recipients: [...five, 'f@x.com'] } });
    expect(res.statusCode).toBe(400);
    expect(res.json().message).toMatch(/free trial.*up to 5 people/);
  });

  it('the 6th email of the day is refused, shared across routes', async () => {
    for (let i = 0; i < TRIAL_EMAIL.perDay - 1; i++) {
      expect((await app.inject({ method: 'POST', url: '/send', payload: { recipients: ['a@x.com'] } })).statusCode).toBe(200);
    }
    expect((await app.inject({ method: 'POST', url: '/minutes', payload: { recipientEmails: ['a@x.com'] } })).statusCode).toBe(200);
    const res = await app.inject({ method: 'POST', url: '/send', payload: { recipients: ['a@x.com'] } });
    expect(res.statusCode).toBe(429);
    expect(res.json().message).toMatch(/up to 5 emails a day/);
    expect(res.headers['retry-after']).toBeDefined();
  });

  it('reads the recipient list from the field the route names', async () => {
    const res = await app.inject({ method: 'POST', url: '/minutes', payload: { recipientEmails: [...five, 'f@x.com'] } });
    expect(res.statusCode).toBe(400);
  });

  it('editing a schedule checks the list but does not use up an email', async () => {
    for (let i = 0; i < TRIAL_EMAIL.perDay + 2; i++) {
      expect((await app.inject({ method: 'PUT', url: '/schedule', payload: { recipients: ['a@x.com'] } })).statusCode).toBe(200);
    }
    expect((await app.inject({ method: 'PUT', url: '/schedule', payload: { recipients: [...five, 'f@x.com'] } })).statusCode).toBe(400);
    expect((await app.inject({ method: 'POST', url: '/send', payload: { recipients: ['a@x.com'] } })).statusCode).toBe(200);
  });

  it('generating a report without emailing it is never counted', async () => {
    for (let i = 0; i < TRIAL_EMAIL.perDay + 2; i++) {
      expect((await app.inject({ method: 'POST', url: '/generate', payload: { recipients: [...five, 'f@x.com'] } })).statusCode).toBe(200);
    }
    expect((await app.inject({ method: 'POST', url: '/generate', payload: { sendEmail: true, recipients: [...five, 'f@x.com'] } })).statusCode).toBe(400);
  });

  it('a viewer is judged by the company plan, not the trial default on their own record', async () => {
    state.role = 'viewer';
    state.tier = 'trial'; // every viewer's own record
    state.orgTier = 'sme';
    expect((await app.inject({ method: 'POST', url: '/send', payload: { recipients: [...five, 'f@x.com'] } })).statusCode).toBe(200);
    state.orgTier = 'trial';
    expect((await app.inject({ method: 'POST', url: '/send', payload: { recipients: [...five, 'f@x.com'] } })).statusCode).toBe(400);
  });

  it('paid plans are not limited by it', async () => {
    state.tier = 'consultant_pro';
    for (let i = 0; i < TRIAL_EMAIL.perDay + 2; i++) {
      expect((await app.inject({ method: 'POST', url: '/send', payload: { recipients: [...five, 'f@x.com', 'g@x.com'] } })).statusCode).toBe(200);
    }
  });
});
