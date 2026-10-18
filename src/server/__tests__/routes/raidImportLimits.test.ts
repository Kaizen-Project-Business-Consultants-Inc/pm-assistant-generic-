import { describe, it, expect, vi, beforeEach } from 'vitest';
import Fastify from 'fastify';

/** RAID import is judged by what is sent, with plain messages when it is too big (UAT U39, 2026-10-18). */
vi.mock('../../middleware/auth', () => ({ authMiddleware: vi.fn(async (req: any) => { req.user = { userId: 'u-pm', role: 'project_manager' }; }) }));
vi.mock('../../middleware/requireScope', () => ({ requireScope: () => vi.fn(async () => {}) }));
vi.mock('../../middleware/requireProjectAccess', () => ({ requireProjectAccess: () => vi.fn(async () => {}), checkProjectRole: vi.fn(async () => ({ ok: true })) }));
vi.mock('../../middleware/viewerWriteBypass', () => ({ viewerWriteBypass: () => vi.fn(async () => {}) }));
vi.mock('../../middleware/rateLimiter', () => ({ heavyActionLimit: () => vi.fn(async () => {}) }));
vi.mock('../../services/WebhookService', () => ({ webhookService: { dispatch: vi.fn() } }));
vi.mock('../../services/automation/AutomationEventBus', () => ({ automationEventBus: { emit: vi.fn(async () => {}) } }));
vi.mock('../../services/integrations/SlackEventDispatcher', () => ({ slackEventDispatcher: { dispatchToSlack: vi.fn() } }));
vi.mock('../../services/integrations/TeamsEventDispatcher', () => ({ teamsEventDispatcher: { dispatchToTeams: vi.fn() } }));
vi.mock('../../services/ProjectMemberService', () => ({ projectMemberService: { findByProjectId: vi.fn(async () => []), findByProjectIdWithNames: vi.fn(async () => []) } }));
vi.mock('../../services/domainEvents', () => ({ raidChanged: vi.fn() }));
const create = vi.hoisted(() => vi.fn(async (d: any) => ({ id: 'k1', ...d })));
const notifyImported = vi.hoisted(() => vi.fn(async () => {}));
vi.mock('../../services/RiskService', async (orig) => {
  const real = await orig<typeof import('../../services/RiskService')>();
  return { ...real, riskService: { create, notifyImported } };
});
vi.mock('../../utils/logger', () => ({ default: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() } }));

import { riskRoutes } from '../../routes/collaboration/risks';

const TOO_BIG = 'This register is too big to import at once — split it or import one sheet at a time.';
const csvOf = (rows: number) => ['Title', ...Array.from({ length: rows }, (_, i) => `Risk ${i + 1}`)].join('\n');
const post = async (payload: string | object) => {
  const app = Fastify(); await app.register(riskRoutes, { prefix: '/p' });
  return app.inject({ method: 'POST', url: '/p/p1/risks/import', headers: { 'content-type': 'application/json' }, payload });
};

describe('RAID import limits', () => {
  beforeEach(() => { create.mockClear(); notifyImported.mockClear(); });

  it('takes a register far bigger than the old 1 MB body (1.5 million characters)', async () => {
    const csv = `Title,Notes\nVendor late,${'x'.repeat(1_500_000)}`;
    const res = await post({ csv, columnMap: { Title: 'title', Notes: 'notes' } });
    expect(res.statusCode).toBe(201);
    expect(create).toHaveBeenCalledTimes(1);
  });

  it('text over the limit is refused with the plain message, nothing created', async () => {
    const res = await post({ csv: `Title\n${'x'.repeat(2_000_001)}`, columnMap: { Title: 'title' } });
    expect(res.statusCode).toBe(400);
    expect(res.json()).toMatchObject({ message: TOO_BIG });
    expect(create).not.toHaveBeenCalled();
  });

  it('a body over the route limit (8 MB) is a 413, not a crash', async () => {
    const res = await post(JSON.stringify({ csv: 'x'.repeat(9 * 1024 * 1024), columnMap: {} }));
    expect(res.statusCode).toBe(413);
    expect(create).not.toHaveBeenCalled();
  });

  it('1,000 rows import; 1,001 are refused with a message saying what to do', async () => {
    expect((await post({ csv: csvOf(1000), columnMap: { Title: 'title' } })).statusCode).toBe(201);
    expect(create).toHaveBeenCalledTimes(1000);
    // quiet rows, then one summary (not 1,000 notices for each PM)
    expect(create.mock.calls.every((c: any[]) => c[2]?.quiet === true)).toBe(true);
    expect(notifyImported).toHaveBeenCalledTimes(1);
    expect(notifyImported).toHaveBeenCalledWith('p1', 'u-pm', 1000, expect.any(Map));
    create.mockClear();
    const res = await post({ csv: csvOf(1001), columnMap: { Title: 'title' } });
    expect(res.statusCode).toBe(400);
    expect(res.json().message).toBe('This register has 1,001 rows; up to 1,000 can be imported at once — split it or import one sheet at a time.');
    expect(create).not.toHaveBeenCalled();
  });
});
