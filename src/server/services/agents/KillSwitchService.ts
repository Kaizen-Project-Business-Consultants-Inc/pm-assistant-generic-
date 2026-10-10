import { auditLedgerService } from '../AuditLedgerService';
import { databaseService } from '../../database/connection';
import logger from '../../utils/logger';
import { getTenantContext } from '../../middleware/requestContext';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface KillSwitchStatus {
  globalEnabled: boolean;
  disabledAgents: string[];
  /** company id + ':' + project id (just the project id on a single-company install) */
  disabledProjects: string[];
}

/**
 * The agent names the per-agent stop knows (the nightly scan as a whole, its delay, budget and
 * Monte Carlo checks; the first two capability ids are also what AgentRegistryService invokes).
 * The API refuses any other name, so a typo can't look like a stop that never applies.
 */
export const STOPPABLE_AGENTS = ['scan_orchestrator', 'auto-reschedule-v1', 'budget-burn-rate', 'monte-carlo-v1'] as const;

/**
 * How a project's stop is saved: with its company, because project ids repeat across companies
 * (every company's sample project is `demo-sample-webapp`) — stopping one company's project must
 * not stop another's (2026-10-10 review).
 */
function projectStopKey(companyId: string | null | undefined, projectId: string): string {
  return companyId ? `${companyId}:${projectId}` : projectId;
}

// ---------------------------------------------------------------------------
// Service
// ---------------------------------------------------------------------------

/**
 * The AI agents' emergency stop (global, per agent, per project). Kept in the shared database
 * since 2026-10-10 (migration 133): it lived in the web app's memory, so the nightly agent run —
 * a separate process — never saw it, and it reset to "on" at every restart. Every check reads the
 * saved state; if the database can't be read the agents do NOT run (an emergency stop must fail
 * safe).
 */
export class KillSwitchService {
  /** The saved switches; agents treat an unreadable state as "stopped" */
  async load(): Promise<KillSwitchStatus & { readable: boolean }> {
    try {
      const rows = await databaseService.queryControlPlane<{ scope: string; target_id: string; disabled: number }>(
        'SELECT scope, target_id, disabled FROM agent_kill_switch WHERE disabled = 1',
      );
      return {
        readable: true,
        globalEnabled: !rows.some(r => r.scope === 'global'),
        disabledAgents: rows.filter(r => r.scope === 'agent').map(r => r.target_id),
        disabledProjects: rows.filter(r => r.scope === 'project').map(r => r.target_id),
      };
    } catch (err) {
      logger.error('[KillSwitch] could not read the saved state — agents will not run', { error: err instanceof Error ? err.message : String(err) });
      return { readable: false, globalEnabled: false, disabledAgents: [], disabledProjects: [] };
    }
  }

  /**
   * Single check combining global, agent-level, and project-level kill switches.
   */
  async canRun(agentId: string, projectId: string | null | undefined): Promise<{ allowed: boolean; reason?: string }> {
    return KillSwitchService.decide(await this.load(), agentId, projectId);
  }

  /** The decision for one agent on one project of the company being worked in, from a state already read */
  static decide(state: KillSwitchStatus & { readable?: boolean }, agentId: string, projectId: string | null | undefined): { allowed: boolean; reason?: string } {
    if (state.readable === false) return { allowed: false, reason: 'Kill switch state could not be read — agents stopped to be safe' };
    if (!state.globalEnabled) return { allowed: false, reason: 'Global kill switch is active — all agents disabled' };
    if (state.disabledAgents.includes(agentId)) return { allowed: false, reason: `Agent ${agentId} is disabled via kill switch` };
    if (projectId && state.disabledProjects.includes(projectStopKey(getTenantContext()?.orgId, projectId))) return { allowed: false, reason: `Project ${projectId} is disabled via kill switch` };
    return { allowed: true };
  }

  private async save(scope: 'global' | 'agent' | 'project', targetId: string, disabled: boolean, userId: string): Promise<boolean> {
    const before = await this.load();
    await databaseService.queryControlPlane(
      `INSERT INTO agent_kill_switch (scope, target_id, disabled, updated_by) VALUES (?, ?, ?, ?)
       ON DUPLICATE KEY UPDATE disabled = VALUES(disabled), updated_by = VALUES(updated_by)`,
      [scope, targetId, disabled ? 1 : 0, userId],
    );
    return scope === 'global' ? !before.globalEnabled
      : scope === 'agent' ? before.disabledAgents.includes(targetId) : before.disabledProjects.includes(targetId);
  }

  async setGlobalKillSwitch(action: 'enable' | 'disable', userId: string): Promise<void> {
    const wasDisabled = await this.save('global', 'global', action === 'disable', userId);

    await auditLedgerService.append({
      actorId: userId,
      actorType: 'user',
      action: `agent.kill_switch.global.${action}`,
      entityType: 'system',
      entityId: 'global',
      payload: { previous: !wasDisabled, current: action === 'enable' },
      source: 'api',
    });

    logger.info(`[KillSwitch] Global kill switch ${action}d by ${userId}`);
  }

  async setAgentDisabled(agentId: string, disabled: boolean, userId: string): Promise<void> {
    await this.save('agent', agentId, disabled, userId);

    await auditLedgerService.append({
      actorId: userId,
      actorType: 'user',
      action: `agent.kill_switch.agent.${disabled ? 'disable' : 'enable'}`,
      entityType: 'agent',
      entityId: agentId,
      payload: { disabled },
      source: 'api',
    });

    logger.info(`[KillSwitch] Agent ${agentId} ${disabled ? 'disabled' : 'enabled'} by ${userId}`);
  }

  async setProjectDisabled(companyId: string | null, projectId: string, disabled: boolean, userId: string): Promise<void> {
    await this.save('project', projectStopKey(companyId, projectId), disabled, userId);

    await auditLedgerService.append({
      actorId: userId,
      actorType: 'user',
      action: `agent.kill_switch.project.${disabled ? 'disable' : 'enable'}`,
      entityType: 'project',
      entityId: projectId,
      payload: { disabled, companyId },
      source: 'api',
    });

    logger.info(`[KillSwitch] Project ${projectId} ${disabled ? 'disabled' : 'enabled'} by ${userId}`);
  }

  async getStatus(): Promise<KillSwitchStatus> {
    const { globalEnabled, disabledAgents, disabledProjects } = await this.load();
    return { globalEnabled, disabledAgents, disabledProjects };
  }
}

export const killSwitchService = new KillSwitchService();
