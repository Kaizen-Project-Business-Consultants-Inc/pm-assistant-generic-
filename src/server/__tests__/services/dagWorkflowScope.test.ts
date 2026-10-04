import { describe, it, expect, vi, beforeEach } from 'vitest';

/**
 * A project's workflow can't reach another project through its steps (2026-10-03): auto-approve
 * only approves proposals on the workflow's own project, and "run an agent" runs it there.
 */
const getById = vi.fn();
const updateStatus = vi.fn(async () => undefined);
const execute = vi.fn(async () => ({ success: true }));
vi.mock('../../services/agents/ActionProposalService', () => ({
  actionProposalService: { getById: (...a: any[]) => getById(...a), updateStatus: (...a: any[]) => (updateStatus as any)(...a) },
}));
vi.mock('../../services/agents/ActionExecutor', () => ({ actionExecutor: { execute: (...a: any[]) => (execute as any)(...a) } }));
const invoke = vi.fn(async () => ({ success: true, output: {} }));
vi.mock('../../services/AgentRegistryService', () => ({ agentRegistry: { invoke: (...a: any[]) => (invoke as any)(...a) } }));
vi.mock('../../database/WorkflowRepository', () => ({ workflowRepository: {} }));
vi.mock('../../utils/logger', () => ({ default: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() } }));

import { executeAction } from '../../services/dagWorkflow/engine';

beforeEach(() => vi.clearAllMocks());

describe('workflow steps stay on the workflow\'s project', () => {
  it('auto-approve skips a proposal from another project', async () => {
    getById.mockResolvedValueOnce({ id: 'prop-b', projectId: 'project-B' });
    const r = await executeAction({ actionType: 'auto_approve_proposal', proposalId: 'prop-b' }, null, {} as any, 'project-A');
    expect(r).toMatchObject({ skipped: true });
    expect(updateStatus).not.toHaveBeenCalled();
    expect(execute).not.toHaveBeenCalled();
  });

  it('auto-approve goes ahead on its own project', async () => {
    getById.mockResolvedValueOnce({ id: 'prop-a', projectId: 'project-A' });
    await executeAction({ actionType: 'auto_approve_proposal', proposalId: 'prop-a' }, null, {} as any, 'project-A');
    expect(execute).toHaveBeenCalledWith('prop-a');
  });

  it('"run an agent" runs on the workflow\'s project, whatever the step says', async () => {
    await executeAction({ actionType: 'invoke_agent', capabilityId: 'x', projectId: 'project-B' }, null, {} as any, 'project-A');
    expect((invoke.mock.calls[0] as any[])[2]).toMatchObject({ projectId: 'project-A' });
  });
});
