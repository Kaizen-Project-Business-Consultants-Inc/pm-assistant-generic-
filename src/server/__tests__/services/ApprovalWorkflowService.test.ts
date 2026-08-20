import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('../../database/ApprovalWorkflowRepository', () => {
  const mockRepo = {
    createWorkflow: vi.fn(),
    findByProject: vi.fn().mockResolvedValue([]),
    updateWorkflow: vi.fn(),
    deleteWorkflow: vi.fn(),
    findById: vi.fn(),
    createChangeRequest: vi.fn(),
    findChangeRequests: vi.fn().mockResolvedValue([]),
    findChangeRequestById: vi.fn().mockResolvedValue(null),
    findChangeRequestRaw: vi.fn().mockResolvedValue(null),
    updateChangeRequest: vi.fn(),
    updateChangeRequestStatus: vi.fn(),
    actOnStepTransaction: vi.fn(),
    findApprovalHistory: vi.fn().mockResolvedValue([]),
    countActiveChangeRequestsByWorkflow: vi.fn().mockResolvedValue(0),
    deleteChangeRequest: vi.fn(),
  };
  return { approvalWorkflowRepository: mockRepo };
});

vi.mock('../../services/AuditLedgerService', () => ({
  auditLedgerService: {
    append: vi.fn().mockResolvedValue(undefined),
  },
}));

vi.mock('../../services/DeadLetterService', () => ({
  deadLetterService: {
    capture: vi.fn().mockResolvedValue(undefined),
  },
}));

vi.mock('../../services/NotificationService', () => ({
  notificationService: {
    create: vi.fn().mockResolvedValue(undefined),
  },
}));

vi.mock('../../utils/logger', () => ({
  default: {
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
  },
}));

import { ApprovalWorkflowService } from '../../services/ApprovalWorkflowService';
import { approvalWorkflowRepository } from '../../database/ApprovalWorkflowRepository';
import { auditLedgerService } from '../../services/AuditLedgerService';
import { deadLetterService } from '../../services/DeadLetterService';

const mockRepo = approvalWorkflowRepository as any;
const mockAudit = auditLedgerService as any;

const sampleWorkflow = {
  id: 'wf1',
  projectId: 'p1',
  name: 'Release Approval',
  description: 'Approval for releases',
  entityType: 'release',
  steps: [
    { name: 'Manager Review', approverRole: 'project_manager', order: 0 },
    { name: 'Director Sign-off', approverRole: 'admin', order: 1 },
  ],
  isActive: true,
  createdBy: 'u1',
  createdAt: '2026-01-01',
  updatedAt: '2026-01-01',
};

const sampleChangeRequest = {
  id: 'cr1',
  projectId: 'p1',
  workflowId: 'wf1',
  title: 'Add new feature',
  description: 'Feature description',
  category: 'enhancement',
  priority: 'high',
  impactSummary: 'Low impact',
  status: 'draft',
  currentStep: null,
  requestedBy: 'u1',
  requestedByName: 'User One',
  createdAt: '2026-01-01',
  updatedAt: '2026-01-01',
};

const sampleApprovalAction = {
  id: 'aa1',
  changeRequestId: 'cr1',
  stepOrder: 0,
  action: 'approved',
  comment: 'Looks good',
  actedBy: 'u2',
  actedByName: 'User Two',
  actedAt: '2026-01-02',
};

describe('ApprovalWorkflowService', () => {
  let service: ApprovalWorkflowService;

  beforeEach(() => {
    service = new ApprovalWorkflowService();
    vi.clearAllMocks();
  });

  // --- Workflow CRUD ---

  describe('createWorkflow', () => {
    it('delegates to repository with correct arguments', async () => {
      mockRepo.createWorkflow.mockResolvedValueOnce(sampleWorkflow);
      const data = {
        name: 'Release Approval',
        entityType: 'release',
        steps: sampleWorkflow.steps,
        createdBy: 'u1',
      };
      const result = await service.createWorkflow('p1', data);
      expect(mockRepo.createWorkflow).toHaveBeenCalledWith('p1', data);
      expect(result).toEqual(sampleWorkflow);
    });
  });

  describe('getWorkflows', () => {
    it('returns workflows for a project', async () => {
      mockRepo.findByProject.mockResolvedValueOnce([sampleWorkflow]);
      const result = await service.getWorkflows('p1');
      expect(mockRepo.findByProject).toHaveBeenCalledWith('p1');
      expect(result).toEqual([sampleWorkflow]);
    });

    it('returns empty array when no workflows exist', async () => {
      mockRepo.findByProject.mockResolvedValueOnce([]);
      const result = await service.getWorkflows('p1');
      expect(result).toEqual([]);
    });
  });

  describe('updateWorkflow', () => {
    it('delegates update to repository', async () => {
      const updated = { ...sampleWorkflow, name: 'Updated Name' };
      mockRepo.updateWorkflow.mockResolvedValueOnce(updated);
      const result = await service.updateWorkflow('wf1', { name: 'Updated Name' });
      expect(mockRepo.updateWorkflow).toHaveBeenCalledWith('wf1', { name: 'Updated Name' });
      expect(result.name).toBe('Updated Name');
    });
  });

  describe('deleteWorkflow', () => {
    it('delegates delete to repository when no active CRs', async () => {
      mockRepo.countActiveChangeRequestsByWorkflow.mockResolvedValueOnce(0);
      mockRepo.deleteWorkflow.mockResolvedValueOnce(undefined);
      await service.deleteWorkflow('wf1');
      expect(mockRepo.deleteWorkflow).toHaveBeenCalledWith('wf1');
    });

    it('throws when active CRs reference the workflow', async () => {
      mockRepo.countActiveChangeRequestsByWorkflow.mockResolvedValueOnce(3);
      await expect(service.deleteWorkflow('wf1'))
        .rejects.toThrow('Cannot delete workflow: 3 active change request(s) still reference it');
    });
  });

  // --- Change Request CRUD ---

  describe('createChangeRequest', () => {
    it('delegates to repository with correct arguments', async () => {
      mockRepo.createChangeRequest.mockResolvedValueOnce(sampleChangeRequest);
      const data = {
        title: 'Add new feature',
        category: 'enhancement',
        priority: 'high',
        requestedBy: 'u1',
      };
      const result = await service.createChangeRequest('p1', data);
      expect(mockRepo.createChangeRequest).toHaveBeenCalledWith('p1', data);
      expect(result).toEqual(sampleChangeRequest);
    });
  });

  describe('getChangeRequests', () => {
    it('returns change requests for a project', async () => {
      mockRepo.findChangeRequests.mockResolvedValueOnce([sampleChangeRequest]);
      const result = await service.getChangeRequests('p1');
      expect(mockRepo.findChangeRequests).toHaveBeenCalledWith('p1', undefined);
      expect(result).toEqual([sampleChangeRequest]);
    });

    it('passes filters to repository', async () => {
      mockRepo.findChangeRequests.mockResolvedValueOnce([]);
      await service.getChangeRequests('p1', { status: 'pending' });
      expect(mockRepo.findChangeRequests).toHaveBeenCalledWith('p1', { status: 'pending' });
    });
  });

  // --- Change Request Detail ---

  describe('getChangeRequestDetail', () => {
    it('returns change request with approval history and current step', async () => {
      const pendingCR = { ...sampleChangeRequest, status: 'pending', currentStep: 0, workflowId: 'wf1' };
      mockRepo.findChangeRequestById.mockResolvedValueOnce(pendingCR);
      mockRepo.findApprovalHistory.mockResolvedValueOnce([sampleApprovalAction]);
      mockRepo.findById.mockResolvedValueOnce(sampleWorkflow);

      const result = await service.getChangeRequestDetail('cr1');
      expect(result.changeRequest).toEqual(pendingCR);
      expect(result.approvalHistory).toHaveLength(1);
      expect(result.approvalHistory[0].stepName).toBe('Manager Review');
      expect(result.currentStep).toEqual({ stepOrder: 0, name: 'Manager Review', role: 'project_manager' });
    });

    it('returns null currentStep for draft CRs', async () => {
      mockRepo.findChangeRequestById.mockResolvedValueOnce(sampleChangeRequest);
      mockRepo.findApprovalHistory.mockResolvedValueOnce([]);

      const result = await service.getChangeRequestDetail('cr1');
      expect(result.currentStep).toBeNull();
    });

    it('throws when change request not found', async () => {
      mockRepo.findChangeRequestById.mockResolvedValueOnce(null);
      await expect(service.getChangeRequestDetail('nonexistent'))
        .rejects.toThrow('Change request not found');
    });
  });

  // --- Submit for Approval ---

  describe('submitForApproval', () => {
    it('updates status to pending with step 0 and workflowId', async () => {
      // getChangeRequestDetail is called first (for before snapshot) — mock its dependencies
      mockRepo.findChangeRequestById.mockResolvedValueOnce(sampleChangeRequest);
      mockRepo.findApprovalHistory.mockResolvedValueOnce([]);
      // updateChangeRequestStatus returns the updated CR
      const pendingCR = { ...sampleChangeRequest, status: 'pending', currentStep: 0, workflowId: 'wf1' };
      mockRepo.updateChangeRequestStatus.mockResolvedValueOnce(pendingCR);

      const result = await service.submitForApproval('cr1', 'wf1', 'u1');
      expect(mockRepo.updateChangeRequestStatus).toHaveBeenCalledWith('cr1', 'pending', { currentStep: 0, workflowId: 'wf1' });
      expect(result.status).toBe('pending');
    });

    it('logs audit entry after submission', async () => {
      mockRepo.findChangeRequestById.mockResolvedValueOnce(sampleChangeRequest);
      mockRepo.findApprovalHistory.mockResolvedValueOnce([]);
      const pendingCR = { ...sampleChangeRequest, status: 'pending', currentStep: 0 };
      mockRepo.updateChangeRequestStatus.mockResolvedValueOnce(pendingCR);

      await service.submitForApproval('cr1', 'wf1', 'u1');
      expect(mockAudit.append).toHaveBeenCalledWith(
        expect.objectContaining({
          actorId: 'u1',
          action: 'approval.submit',
          entityType: 'change_request',
          entityId: 'cr1',
        }),
      );
    });

    it('uses requestedBy as actorId when userId not provided', async () => {
      // getChangeRequestDetail fails (no before snapshot) — service catches it
      mockRepo.findChangeRequestById.mockResolvedValueOnce(null);
      const pendingCR = { ...sampleChangeRequest, status: 'pending', currentStep: 0, requestedBy: 'u1' };
      mockRepo.updateChangeRequestStatus.mockResolvedValueOnce(pendingCR);

      await service.submitForApproval('cr1', 'wf1');
      expect(mockAudit.append).toHaveBeenCalledWith(
        expect.objectContaining({ actorId: 'u1' }),
      );
    });

    it('captures audit failure to dead letter queue', async () => {
      mockRepo.findChangeRequestById.mockResolvedValueOnce(null);
      const pendingCR = { ...sampleChangeRequest, status: 'pending', currentStep: 0 };
      mockRepo.updateChangeRequestStatus.mockResolvedValueOnce(pendingCR);

      const auditError = new Error('Audit DB down');
      mockAudit.append.mockRejectedValueOnce(auditError);

      await service.submitForApproval('cr1', 'wf1');
      // The .catch handler calls deadLetterService.capture — give it a tick
      await new Promise(r => setTimeout(r, 10));
      expect(deadLetterService.capture).toHaveBeenCalledWith('audit.append', {}, auditError);
    });
  });

  // --- Act on Step ---

  describe('actOnStep', () => {
    const rawCR = {
      id: 'cr1',
      project_id: 'p1',
      workflow_id: 'wf1',
      title: 'Add new feature',
      description: null,
      category: 'enhancement',
      priority: 'high',
      impact_summary: null,
      status: 'pending',
      current_step: 0,
      requested_by: 'u1',
      created_at: '2026-01-01',
      updated_at: '2026-01-01',
    };

    const workflowWithSteps = {
      ...sampleWorkflow,
      steps: [
        { name: 'Manager Review', approverRole: 'project_manager', order: 0 },
        { name: 'Director Sign-off', approverRole: 'admin', order: 1 },
      ],
    };

    it('approves a step and returns updated change request', async () => {
      mockRepo.findChangeRequestRaw.mockResolvedValueOnce(rawCR);
      mockRepo.findById.mockResolvedValueOnce(workflowWithSteps);
      mockRepo.actOnStepTransaction.mockResolvedValueOnce(undefined);
      const approvedCR = { ...sampleChangeRequest, status: 'pending', currentStep: 1 };
      mockRepo.findChangeRequestById.mockResolvedValueOnce(approvedCR);

      const result = await service.actOnStep('cr1', 'u2', 'approved', 'Looks good', 'project_manager');
      expect(mockRepo.actOnStepTransaction).toHaveBeenCalledWith('cr1', 0, 'approved', 'Looks good', 'u2', 2);
      expect(result.currentStep).toBe(1);
    });

    it('normalizes present-tense actions to past tense', async () => {
      mockRepo.findChangeRequestRaw.mockResolvedValueOnce(rawCR);
      mockRepo.findById.mockResolvedValueOnce(workflowWithSteps);
      mockRepo.actOnStepTransaction.mockResolvedValueOnce(undefined);
      mockRepo.findChangeRequestById.mockResolvedValueOnce({ ...sampleChangeRequest, status: 'in_review', currentStep: 1 });

      await service.actOnStep('cr1', 'u2', 'approve', 'LGTM');
      expect(mockRepo.actOnStepTransaction).toHaveBeenCalledWith('cr1', 0, 'approved', 'LGTM', 'u2', 2);
    });

    it('rejects when CR is not awaiting review', async () => {
      mockRepo.findChangeRequestRaw.mockResolvedValueOnce({ ...rawCR, status: 'draft' });
      await expect(service.actOnStep('cr1', 'u2', 'approve'))
        .rejects.toThrow('Change request is not awaiting review');
    });

    it('rejects a change request', async () => {
      mockRepo.findChangeRequestRaw.mockResolvedValueOnce(rawCR);
      mockRepo.findById.mockResolvedValueOnce(workflowWithSteps);
      mockRepo.actOnStepTransaction.mockResolvedValueOnce(undefined);
      const rejectedCR = { ...sampleChangeRequest, status: 'rejected' };
      mockRepo.findChangeRequestById.mockResolvedValueOnce(rejectedCR);

      const result = await service.actOnStep('cr1', 'u2', 'rejected', 'Not ready');
      expect(result.status).toBe('rejected');
    });

    it('logs correct audit action for approval', async () => {
      mockRepo.findChangeRequestRaw.mockResolvedValueOnce(rawCR);
      mockRepo.findById.mockResolvedValueOnce(workflowWithSteps);
      mockRepo.actOnStepTransaction.mockResolvedValueOnce(undefined);
      mockRepo.findChangeRequestById.mockResolvedValueOnce(sampleChangeRequest);

      await service.actOnStep('cr1', 'u2', 'approved');
      expect(mockAudit.append).toHaveBeenCalledWith(
        expect.objectContaining({ action: 'approval.approve' }),
      );
    });

    it('logs correct audit action for rejection', async () => {
      mockRepo.findChangeRequestRaw.mockResolvedValueOnce(rawCR);
      mockRepo.findById.mockResolvedValueOnce(workflowWithSteps);
      mockRepo.actOnStepTransaction.mockResolvedValueOnce(undefined);
      mockRepo.findChangeRequestById.mockResolvedValueOnce(sampleChangeRequest);

      await service.actOnStep('cr1', 'u2', 'rejected');
      expect(mockAudit.append).toHaveBeenCalledWith(
        expect.objectContaining({ action: 'approval.reject' }),
      );
    });

    it('logs correct audit action for return', async () => {
      mockRepo.findChangeRequestRaw.mockResolvedValueOnce(rawCR);
      mockRepo.findById.mockResolvedValueOnce(workflowWithSteps);
      mockRepo.actOnStepTransaction.mockResolvedValueOnce(undefined);
      mockRepo.findChangeRequestById.mockResolvedValueOnce(sampleChangeRequest);

      await service.actOnStep('cr1', 'u2', 'returned');
      expect(mockAudit.append).toHaveBeenCalledWith(
        expect.objectContaining({ action: 'approval.return' }),
      );
    });

    it('throws when change request not found', async () => {
      mockRepo.findChangeRequestRaw.mockResolvedValueOnce(null);
      await expect(service.actOnStep('nonexistent', 'u2', 'approved'))
        .rejects.toThrow('Change request not found');
    });

    it('throws when change request has no workflow', async () => {
      mockRepo.findChangeRequestRaw.mockResolvedValueOnce({ ...rawCR, workflow_id: null });
      await expect(service.actOnStep('cr1', 'u2', 'approved'))
        .rejects.toThrow('Change request has no associated workflow');
    });

    it('throws when workflow not found', async () => {
      mockRepo.findChangeRequestRaw.mockResolvedValueOnce(rawCR);
      mockRepo.findById.mockResolvedValueOnce(null);
      await expect(service.actOnStep('cr1', 'u2', 'approved'))
        .rejects.toThrow('Workflow not found');
    });

    it('throws when user role does not match step approver role', async () => {
      mockRepo.findChangeRequestRaw.mockResolvedValueOnce(rawCR);
      mockRepo.findById.mockResolvedValueOnce(workflowWithSteps);

      await expect(service.actOnStep('cr1', 'u2', 'approved', undefined, 'team_member'))
        .rejects.toThrow('Step "Manager Review" requires role "project_manager", but user has role "team_member"');
    });

    it('allows admin to act on any step regardless of approverRole', async () => {
      mockRepo.findChangeRequestRaw.mockResolvedValueOnce(rawCR);
      mockRepo.findById.mockResolvedValueOnce(workflowWithSteps);
      mockRepo.actOnStepTransaction.mockResolvedValueOnce(undefined);
      mockRepo.findChangeRequestById.mockResolvedValueOnce(sampleChangeRequest);

      // Admin should not throw even though step requires project_manager
      await expect(service.actOnStep('cr1', 'u2', 'approved', undefined, 'admin'))
        .resolves.toBeDefined();
    });

    it('skips role check when userRole is not provided', async () => {
      mockRepo.findChangeRequestRaw.mockResolvedValueOnce(rawCR);
      mockRepo.findById.mockResolvedValueOnce(workflowWithSteps);
      mockRepo.actOnStepTransaction.mockResolvedValueOnce(undefined);
      mockRepo.findChangeRequestById.mockResolvedValueOnce(sampleChangeRequest);

      // No userRole means no role check
      await expect(service.actOnStep('cr1', 'u2', 'approved'))
        .resolves.toBeDefined();
    });

    it('throws when change request not found after transaction update', async () => {
      mockRepo.findChangeRequestRaw.mockResolvedValueOnce(rawCR);
      mockRepo.findById.mockResolvedValueOnce(workflowWithSteps);
      mockRepo.actOnStepTransaction.mockResolvedValueOnce(undefined);
      mockRepo.findChangeRequestById.mockResolvedValueOnce(null);

      await expect(service.actOnStep('cr1', 'u2', 'approved'))
        .rejects.toThrow('Change request not found after update');
    });

    it('uses 0 as default currentStep when current_step is null', async () => {
      mockRepo.findChangeRequestRaw.mockResolvedValueOnce({ ...rawCR, current_step: null });
      mockRepo.findById.mockResolvedValueOnce(workflowWithSteps);
      mockRepo.actOnStepTransaction.mockResolvedValueOnce(undefined);
      mockRepo.findChangeRequestById.mockResolvedValueOnce(sampleChangeRequest);

      await service.actOnStep('cr1', 'u2', 'approved');
      expect(mockRepo.actOnStepTransaction).toHaveBeenCalledWith('cr1', 0, 'approved', null, 'u2', 2);
    });

    it('passes null comment when comment is undefined', async () => {
      mockRepo.findChangeRequestRaw.mockResolvedValueOnce(rawCR);
      mockRepo.findById.mockResolvedValueOnce(workflowWithSteps);
      mockRepo.actOnStepTransaction.mockResolvedValueOnce(undefined);
      mockRepo.findChangeRequestById.mockResolvedValueOnce(sampleChangeRequest);

      await service.actOnStep('cr1', 'u2', 'approved');
      // comment should be null (not undefined)
      expect(mockRepo.actOnStepTransaction).toHaveBeenCalledWith('cr1', 0, 'approved', null, 'u2', 2);
    });
  });

  // --- Withdraw ---

  describe('withdrawChangeRequest', () => {
    it('updates status to withdrawn for pending CR', async () => {
      const pendingCR = { ...sampleChangeRequest, status: 'pending' };
      mockRepo.findChangeRequestById.mockResolvedValueOnce(pendingCR);
      const withdrawnCR = { ...sampleChangeRequest, status: 'withdrawn' };
      mockRepo.updateChangeRequestStatus.mockResolvedValueOnce(withdrawnCR);

      const result = await service.withdrawChangeRequest('cr1', 'u1');
      expect(mockRepo.updateChangeRequestStatus).toHaveBeenCalledWith('cr1', 'withdrawn');
      expect(result.status).toBe('withdrawn');
    });

    it('throws when trying to withdraw a draft CR', async () => {
      mockRepo.findChangeRequestById.mockResolvedValueOnce(sampleChangeRequest); // status = draft
      await expect(service.withdrawChangeRequest('cr1'))
        .rejects.toThrow('Only pending or in-review');
    });

    it('throws when CR not found', async () => {
      mockRepo.findChangeRequestById.mockResolvedValueOnce(null);
      await expect(service.withdrawChangeRequest('nonexistent'))
        .rejects.toThrow('Change request not found');
    });
  });

  // --- Approval History ---

  describe('getApprovalHistory', () => {
    it('returns approval actions for a change request', async () => {
      mockRepo.findApprovalHistory.mockResolvedValueOnce([sampleApprovalAction]);
      const result = await service.getApprovalHistory('cr1');
      expect(mockRepo.findApprovalHistory).toHaveBeenCalledWith('cr1');
      expect(result).toEqual([sampleApprovalAction]);
    });

    it('returns empty array when no history exists', async () => {
      mockRepo.findApprovalHistory.mockResolvedValueOnce([]);
      const result = await service.getApprovalHistory('cr1');
      expect(result).toEqual([]);
    });
  });
});
