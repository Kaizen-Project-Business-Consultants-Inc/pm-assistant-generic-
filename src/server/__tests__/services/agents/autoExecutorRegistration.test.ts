import { describe, it, expect, vi, beforeEach } from 'vitest';
import { readFileSync } from 'fs';
import { join } from 'path';

/**
 * Code health item 1 (2026-10-07): ActionProposalService and ActionExecutor imported each other.
 * Now the executor registers itself with the proposal service when it loads; the proposal
 * service never imports it. An auto-approved proposal is still carried out — and if no executor
 * was loaded, it is left for review instead of failing.
 */
const canAuto = vi.hoisted(() => vi.fn());
const autoApprove = vi.hoisted(() => vi.fn());
vi.mock('../../../services/agents/AutonomyService', () => ({ autonomyService: { canAutoExecute: canAuto } }));
vi.mock('../../../database/ActionProposalRepository', () => ({ actionProposalRepository: { autoApprove } }));
vi.mock('../../../services/domainEvents', () => ({ proposalEvent: vi.fn() }));
vi.mock('../../../utils/logger', () => ({ default: { info: vi.fn(), warn: vi.fn(), error: vi.fn() } }));

import { ActionProposalService } from '../../../services/agents/ActionProposalService';

const proposal = { id: 'pr1', agentId: 'auto-reschedule-v1', projectId: 'p1', confidenceScore: 95, riskLevel: 'low' } as any;

describe('auto-approved proposals reach the executor without a two-way import', () => {
  beforeEach(() => { vi.clearAllMocks(); canAuto.mockResolvedValue(true); });

  it('the registered executor carries out an auto-approved proposal', async () => {
    const svc = new ActionProposalService();
    const execute = vi.fn(async () => ({}));
    svc.registerAutoExecutor(execute);
    await (svc as any).tryAutoExecute(proposal);
    expect(autoApprove).toHaveBeenCalledWith('pr1');
    expect(execute).toHaveBeenCalledWith('pr1');
  });

  it('with no executor loaded, nothing is approved or run (left for review)', async () => {
    const svc = new ActionProposalService();
    await (svc as any).tryAutoExecute(proposal);
    expect(autoApprove).not.toHaveBeenCalled();
  });

  it('the proposal service does not import the executor; the executor and the scan job register it', () => {
    const src = (...p: string[]) => readFileSync(join(__dirname, '..', '..', '..', ...p), 'utf-8');
    expect(src('services', 'agents', 'ActionProposalService.ts')).not.toMatch(/ActionExecutor'/);
    expect(src('services', 'agents', 'ActionExecutor.ts')).toMatch(/actionProposalService\.registerAutoExecutor\(/);
    expect(src('scripts', 'runCronJob.ts')).toMatch(/await import\('\.\.\/services\/agents\/ActionExecutor'\)/);
  });
});
