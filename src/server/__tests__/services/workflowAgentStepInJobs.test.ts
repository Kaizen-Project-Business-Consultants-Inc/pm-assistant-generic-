import { describe, it, expect, vi } from 'vitest';

/** Agent capabilities exist only in the app server: in a scheduled job the step failed every run */

const registry = vi.hoisted(() => ({ invoke: vi.fn(async () => ({ success: true, output: {} })) }));
vi.mock('../../services/AgentRegistryService', () => ({ agentRegistry: registry }));
vi.mock('../../utils/logger', () => ({ default: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() } }));
// every repository call is a recorded no-op (getExecutionContext answers {}, other reads [])
const repo = vi.hoisted(() => {
  const fns: Record<string, any> = {};
  return new Proxy(fns, { get: (t, k: string) => (t[k] ??= vi.fn(async () => (k === 'getExecutionContext' ? {} : k.startsWith('get') ? [] : undefined))) });
});
vi.mock('../../database/WorkflowRepository', () => ({ workflowRepository: repo }));

import { executeAction, executeWorkflowEngine } from '../../services/dagWorkflow/engine';
import { markAsJobRunner } from '../../utils/processRole';

describe('workflow agent steps', () => {
  it('run in the app server', async () => {
    const r = await executeAction({ actionType: 'invoke_agent', capabilityId: 'auto-reschedule-v1' }, null, {} as any);
    expect(registry.invoke).toHaveBeenCalledTimes(1);
    expect(r.skipped).toBeUndefined();
  });

  it('are skipped, with the reason, in a scheduled job', async () => {
    registry.invoke.mockClear();
    markAsJobRunner();
    const r = await executeAction({ actionType: 'invoke_agent', capabilityId: 'auto-reschedule-v1' }, null, {} as any);
    expect(registry.invoke).not.toHaveBeenCalled();
    expect(r).toMatchObject({ skipped: true, reason: expect.stringMatching(/only in the app/) });
  });

  it("the seeded overdue workflow's agent node (retries 1, 2 s back-off) is skipped at once, and the run doesn't fail", async () => {
    registry.invoke.mockClear();
    const node = (id: string, nodeType: string, config: Record<string, unknown> = {}) =>
      ({ id, workflowId: 'wf-seed-4', nodeType, name: id, config, positionX: 0, positionY: 0, createdAt: '' }) as any;
    const trigger = node('n-trigger', 'trigger', { triggerType: 'date_passed' });
    const agent = node('n-agent', 'agent', { capabilityId: 'auto-reschedule-v1', retries: 1, backoffMs: 2000 });
    const def = { id: 'wf-seed-4', projectId: null, nodes: [trigger, agent], edges: [{ id: 'e1', workflowId: 'wf-seed-4', sourceNodeId: 'n-trigger', targetNodeId: 'n-agent', conditionExpr: null, label: null, sortOrder: 0 }] } as any;
    const started = Date.now();
    await executeWorkflowEngine(def, trigger, { id: 't1', name: 'Late task', status: 'in_progress' } as any, {} as any);
    expect(Date.now() - started).toBeLessThan(1_000); // no 2 s retry wait
    expect(registry.invoke).not.toHaveBeenCalled();
    expect(repo.updateNodeExecutionCompleted).toHaveBeenCalledWith(expect.any(String), expect.stringMatching(/"skipped":true/));
    expect(repo.updateExecutionStatus).not.toHaveBeenCalledWith(expect.any(String), 'failed', expect.anything());
  });
});
