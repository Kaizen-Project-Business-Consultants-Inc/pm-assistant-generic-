import { describe, it, expect, vi, beforeEach } from 'vitest';

/**
 * U59 (2026-10-20): the "On task overdue — reschedule agent" workflow fired once per late task and
 * each run asked the AI (1,967 calls ≈ US$28 in 30 days on staging). The agent now uses the rules
 * only, and runs on the same schedule share one run.
 */
const h = vi.hoisted(() => ({
  detectDelays: vi.fn(),
  generateProposal: vi.fn(),
  registered: [] as Array<{ id: string; handler: (input: any) => Promise<any> }>,
  tenant: 'pmassist_t_a',
}));
vi.mock('../../utils/companyCacheKey', () => ({ companyCacheKey: (k: string) => `${h.tenant}:${k}` }));
vi.mock('../../services/AgentRegistryService', () => ({ agentRegistry: { register: (d: any) => h.registered.push(d) } }));
vi.mock('../../services/AutoRescheduleService', () => ({ autoRescheduleService: { detectDelays: h.detectDelays, generateProposal: h.generateProposal } }));
vi.mock('../../services/MonteCarloService', () => ({ monteCarloService: {} }));
vi.mock('../../services/ragAgentCapability', () => ({}));

import '../../services/agentCapabilities';

const agent = () => h.registered.find(d => d.id === 'auto-reschedule-v1')!;

beforeEach(() => {
  vi.clearAllMocks();
  h.detectDelays.mockResolvedValue([{ taskId: 't1', delayDays: 5, isOnCriticalPath: false }]);
  h.generateProposal.mockResolvedValue({ id: 'p1' });
});

describe('auto-reschedule agent (U59)', () => {
  it('asks for the rules-based proposal, never the AI one', async () => {
    await agent().handler({ scheduleId: 's1' });
    expect(h.generateProposal).toHaveBeenCalledWith('s1', undefined, 'agent', { useAi: false });
  });

  it('runs started together on one schedule share one run (a late plan import fires one per task)', async () => {
    let finish!: (v: unknown) => void;
    h.generateProposal.mockImplementationOnce(() => new Promise(r => { finish = r; }));
    const runs = [agent().handler({ scheduleId: 's1' }), agent().handler({ scheduleId: 's1' }), agent().handler({ scheduleId: 's1' })];
    await vi.waitFor(() => expect(h.generateProposal).toHaveBeenCalledTimes(1));
    finish({ id: 'p1' });
    const results = await Promise.all(runs);
    expect(results.every(r => r.proposal.id === 'p1')).toBe(true);
    expect(h.detectDelays).toHaveBeenCalledTimes(1);
  });

  it('two companies with the same schedule id (the sample project) never share a run', async () => {
    let finishA!: (v: unknown) => void;
    h.generateProposal.mockImplementationOnce(() => new Promise(r => { finishA = r; }));
    h.tenant = 'pmassist_t_a';
    const a = agent().handler({ scheduleId: 'demo-sch-1' });
    await vi.waitFor(() => expect(h.generateProposal).toHaveBeenCalledTimes(1));
    h.tenant = 'pmassist_t_b';
    h.generateProposal.mockResolvedValueOnce({ id: 'pB' });
    const b = await agent().handler({ scheduleId: 'demo-sch-1' });
    expect(b.proposal.id).toBe('pB');
    expect(h.generateProposal).toHaveBeenCalledTimes(2);
    finishA({ id: 'pA' });
    expect((await a).proposal.id).toBe('pA');
    h.tenant = 'pmassist_t_a';
  });

  it('a later run on the same schedule runs again (only overlapping runs are shared)', async () => {
    await agent().handler({ scheduleId: 's1' });
    await agent().handler({ scheduleId: 's1' });
    expect(h.detectDelays).toHaveBeenCalledTimes(2);
  });

  it('no significant delay: no proposal', async () => {
    h.detectDelays.mockResolvedValue([{ taskId: 't1', delayDays: 1, isOnCriticalPath: false }]);
    const r = await agent().handler({ scheduleId: 's1' });
    expect(h.generateProposal).not.toHaveBeenCalled();
    expect(r.proposal).toBeUndefined();
  });
});
