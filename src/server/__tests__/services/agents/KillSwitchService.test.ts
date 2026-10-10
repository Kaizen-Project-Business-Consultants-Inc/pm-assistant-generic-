import { describe, it, expect, vi, beforeEach } from 'vitest';

/**
 * The AI agents' emergency stop is saved in the shared database (2026-10-10, migration 133): the
 * nightly agent run is a separate process, so a switch held in the web app's memory never reached
 * it, and it reset to "on" whenever the app restarted. The fake table below stands in for
 * agent_kill_switch.
 */
const table = vi.hoisted(() => ({ rows: new Map<string, { scope: string; target_id: string; disabled: number }>(), fail: false }));
vi.mock('../../../database/connection', () => ({
  databaseService: {
    queryControlPlane: vi.fn(async (sql: string, params: any[] = []) => {
      if (table.fail) throw new Error('database down');
      if (sql.startsWith('SELECT')) return [...table.rows.values()].filter(r => r.disabled === 1);
      const [scope, target, disabled] = params;
      table.rows.set(`${scope}|${target}`, { scope, target_id: target, disabled });
      return { affectedRows: 1 };
    }),
  },
}));
vi.mock('../../../services/AuditLedgerService', () => ({ auditLedgerService: { append: vi.fn().mockResolvedValue(undefined) } }));
vi.mock('../../../utils/logger', () => ({ default: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() } }));

import { KillSwitchService } from '../../../services/agents/KillSwitchService';
import { auditLedgerService } from '../../../services/AuditLedgerService';
import { runWithTenantContext } from '../../../middleware/requestContext';

describe('KillSwitchService', () => {
  let service: KillSwitchService;

  beforeEach(() => {
    table.rows.clear();
    table.fail = false;
    service = new KillSwitchService();
    vi.clearAllMocks();
  });

  describe('canRun', () => {
    it('allows by default (everything enabled)', async () => {
      expect((await service.canRun('agent-a', 'proj-1')).allowed).toBe(true);
    });

    it('blocks when global kill switch is disabled', async () => {
      await service.setGlobalKillSwitch('disable', 'admin-1');
      const result = await service.canRun('agent-a', 'proj-1');
      expect(result.allowed).toBe(false);
      expect(result.reason).toContain('Global');
    });

    it('blocks when specific agent is disabled', async () => {
      await service.setAgentDisabled('agent-a', true, 'admin-1');
      expect((await service.canRun('agent-a', 'proj-1')).allowed).toBe(false);
      expect((await service.canRun('agent-b', 'proj-1')).allowed).toBe(true);
    });

    it('blocks when specific project is disabled', async () => {
      await service.setProjectDisabled(null, 'proj-1', true, 'admin-1');
      expect((await service.canRun('agent-a', 'proj-1')).allowed).toBe(false);
      expect((await service.canRun('agent-a', 'proj-2')).allowed).toBe(true);
    });
  });

  describe('it reaches every process and survives a restart', () => {
    it('a stop set in the web app is seen by the nightly job (another instance)', async () => {
      await service.setGlobalKillSwitch('disable', 'admin-1');
      const nightlyJob = new KillSwitchService(); // a separate process starts with nothing in memory
      expect((await nightlyJob.canRun('auto-reschedule-v1', 'p1')).allowed).toBe(false);
    });

    it('if the saved state cannot be read, agents do not run (an emergency stop fails safe)', async () => {
      table.fail = true;
      const r = await service.canRun('agent-a', 'proj-1');
      expect(r.allowed).toBe(false);
      expect(r.reason).toMatch(/could not be read/);
    });

    it('decide() gives the same answer from a state read once (the scan reads once per run)', () => {
      const state = { readable: true, globalEnabled: true, disabledAgents: ['monte-carlo-v1'], disabledProjects: ['p9'] };
      expect(KillSwitchService.decide(state, 'monte-carlo-v1', 'p1').allowed).toBe(false);
      expect(KillSwitchService.decide(state, 'auto-reschedule-v1', 'p9').allowed).toBe(false);
      expect(KillSwitchService.decide(state, 'auto-reschedule-v1', 'p1').allowed).toBe(true);
      expect(KillSwitchService.decide(state, 'auto-reschedule-v1', null).allowed).toBe(true);
    });
  });

  describe('a project stop belongs to one company (project ids repeat across companies)', () => {
    it("stopping company A's sample project leaves company B's sample project running", async () => {
      await service.setProjectDisabled('org-a', 'demo-sample-webapp', true, 'admin-1');
      const inA = await runWithTenantContext('pmassist_t_a', 'org-a', () => service.canRun('agent-a', 'demo-sample-webapp'));
      const inB = await runWithTenantContext('pmassist_t_b', 'org-b', () => service.canRun('agent-a', 'demo-sample-webapp'));
      expect(inA.allowed).toBe(false);
      expect(inB.allowed).toBe(true);
      expect((await service.getStatus()).disabledProjects).toEqual(['org-a:demo-sample-webapp']);
    });
  });

  describe('setGlobalKillSwitch', () => {
    it('can disable and re-enable', async () => {
      await service.setGlobalKillSwitch('disable', 'admin-1');
      expect((await service.getStatus()).globalEnabled).toBe(false);
      await service.setGlobalKillSwitch('enable', 'admin-1');
      expect((await service.getStatus()).globalEnabled).toBe(true);
    });

    it('logs to audit ledger', async () => {
      await service.setGlobalKillSwitch('disable', 'admin-1');
      expect(auditLedgerService.append).toHaveBeenCalledWith(expect.objectContaining({
        actorId: 'admin-1',
        action: 'agent.kill_switch.global.disable',
        payload: { previous: true, current: false },
      }));
    });
  });

  describe('setAgentDisabled / setProjectDisabled', () => {
    it('can disable and re-enable agents and projects', async () => {
      await service.setAgentDisabled('agent-a', true, 'admin-1');
      await service.setProjectDisabled(null, 'proj-1', true, 'admin-1');
      expect(await service.getStatus()).toEqual({ globalEnabled: true, disabledAgents: ['agent-a'], disabledProjects: ['proj-1'] });
      await service.setAgentDisabled('agent-a', false, 'admin-1');
      await service.setProjectDisabled(null, 'proj-1', false, 'admin-1');
      expect(await service.getStatus()).toEqual({ globalEnabled: true, disabledAgents: [], disabledProjects: [] });
    });
  });
});
