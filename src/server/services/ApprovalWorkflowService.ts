import { approvalWorkflowRepository } from '../database/ApprovalWorkflowRepository';
import { auditLedgerService } from './AuditLedgerService';
import { deadLetterService } from './DeadLetterService';
import { notificationService } from './NotificationService';
import logger from '../utils/logger';

export interface ApprovalWorkflow {
  id: string;
  projectId: string;
  name: string;
  description: string | null;
  entityType: string;
  steps: WorkflowStep[];
  isActive: boolean;
  createdBy: string;
  createdAt: string;
  updatedAt: string;
}

export interface WorkflowStep {
  name: string;
  approverRole: string;
  order: number;
}

export interface ChangeRequest {
  id: string;
  projectId: string;
  workflowId: string | null;
  title: string;
  description: string | null;
  category: string;
  priority: string;
  impactSummary: string | null;
  status: string;
  currentStep: number | null;
  requestedBy: string;
  requestedByName: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface ApprovalAction {
  id: string;
  changeRequestId: string;
  stepOrder: number;
  action: string;
  comment: string | null;
  actedBy: string;
  actedByName: string | null;
  actedAt: string;
}

/** Normalize action verbs: accept both present and past tense */
function normalizeAction(action: string): string {
  const map: Record<string, string> = { approve: 'approved', reject: 'rejected', return: 'returned' };
  return map[action] || action;
}

export class ApprovalWorkflowService {
  async createWorkflow(projectId: string, data: {
    name: string;
    description?: string;
    entityType: string;
    steps: WorkflowStep[];
    isActive?: boolean;
    createdBy: string;
  }): Promise<ApprovalWorkflow> {
    return approvalWorkflowRepository.createWorkflow(projectId, data);
  }

  async getWorkflows(projectId: string): Promise<ApprovalWorkflow[]> {
    return approvalWorkflowRepository.findByProject(projectId);
  }

  async updateWorkflow(id: string, data: {
    name?: string;
    description?: string;
    entityType?: string;
    steps?: WorkflowStep[];
    isActive?: boolean;
  }): Promise<ApprovalWorkflow> {
    return approvalWorkflowRepository.updateWorkflow(id, data);
  }

  async deleteWorkflow(id: string): Promise<void> {
    const activeCRs = await approvalWorkflowRepository.countActiveChangeRequestsByWorkflow(id);
    if (activeCRs > 0) {
      throw new Error(`Cannot delete workflow: ${activeCRs} active change request(s) still reference it`);
    }
    return approvalWorkflowRepository.deleteWorkflow(id);
  }

  async createChangeRequest(projectId: string, data: {
    title: string;
    description?: string;
    category: string;
    priority: string;
    impactSummary?: string;
    requestedBy: string;
  }): Promise<ChangeRequest> {
    return approvalWorkflowRepository.createChangeRequest(projectId, data);
  }

  async updateChangeRequest(crId: string, data: {
    title?: string;
    description?: string;
    category?: string;
    priority?: string;
    impactSummary?: string;
  }, userId?: string): Promise<ChangeRequest> {
    const existing = await approvalWorkflowRepository.findChangeRequestById(crId);
    if (!existing) throw new Error('Change request not found');
    if (existing.status !== 'draft' && existing.status !== 'rejected') throw new Error('Only draft or rejected change requests can be edited');
    const updated = await approvalWorkflowRepository.updateChangeRequest(crId, data);

    auditLedgerService.append({
      actorId: userId || existing.requestedBy,
      actorType: 'user',
      action: 'change_request.update',
      entityType: 'change_request',
      entityId: crId,
      projectId: existing.projectId,
      payload: { before: existing, after: updated },
      source: 'web',
    }).catch(err => deadLetterService.capture('audit.append', {}, err));

    return updated;
  }

  async deleteChangeRequest(crId: string, userId?: string): Promise<void> {
    const existing = await approvalWorkflowRepository.findChangeRequestById(crId);
    if (!existing) throw new Error('Change request not found');
    if (existing.status !== 'draft') throw new Error('Only draft change requests can be deleted');
    await approvalWorkflowRepository.deleteChangeRequest(crId);

    auditLedgerService.append({
      actorId: userId || existing.requestedBy,
      actorType: 'user',
      action: 'change_request.delete',
      entityType: 'change_request',
      entityId: crId,
      projectId: existing.projectId,
      payload: { deleted: existing },
      source: 'web',
    }).catch(err => deadLetterService.capture('audit.append', {}, err));
  }

  async getChangeRequests(projectId: string, filters?: { status?: string; priority?: string; sortBy?: string; sortDir?: string }): Promise<ChangeRequest[]> {
    return approvalWorkflowRepository.findChangeRequests(projectId, filters);
  }

  async getChangeRequestDetail(id: string): Promise<{
    changeRequest: ChangeRequest;
    approvalHistory: (ApprovalAction & { stepName?: string; stepRole?: string })[];
    currentStep: { stepOrder: number; name: string; role: string } | null;
  }> {
    const changeRequest = await approvalWorkflowRepository.findChangeRequestById(id);
    if (!changeRequest) throw new Error('Change request not found');
    const approvalHistory = await this.getApprovalHistory(id);

    // Enrich with workflow step metadata
    let currentStep: { stepOrder: number; name: string; role: string } | null = null;
    let workflow: ApprovalWorkflow | null = null;
    if (changeRequest.workflowId) {
      workflow = await approvalWorkflowRepository.findById(changeRequest.workflowId);
    }
    if (workflow && changeRequest.currentStep != null && (changeRequest.status === 'pending' || changeRequest.status === 'in_review')) {
      const step = workflow.steps[changeRequest.currentStep];
      if (step) {
        currentStep = { stepOrder: changeRequest.currentStep, name: step.name, role: step.approverRole };
      }
    }

    // Enrich approval history with step names
    const enrichedHistory = approvalHistory.map(entry => {
      const step = workflow?.steps?.[entry.stepOrder];
      return { ...entry, stepName: step?.name, stepRole: step?.approverRole };
    });

    return { changeRequest, approvalHistory: enrichedHistory, currentStep };
  }

  async submitForApproval(crId: string, workflowId: string, userId?: string): Promise<ChangeRequest> {
    const before = await this.getChangeRequestDetail(crId).catch(() => null);
    if (before?.changeRequest && !['draft', 'rejected'].includes(before.changeRequest.status)) {
      throw new Error('Only draft or rejected change requests can be submitted for approval');
    }
    const cr = await approvalWorkflowRepository.updateChangeRequestStatus(crId, 'pending', { currentStep: 0, workflowId });

    auditLedgerService.append({
      actorId: userId || cr.requestedBy,
      actorType: 'user',
      action: 'approval.submit',
      entityType: 'change_request',
      entityId: crId,
      projectId: cr.projectId,
      payload: { before: before?.changeRequest, after: cr, workflowId },
      source: 'web',
    }).catch(err => deadLetterService.capture('audit.append', {}, err));

    return cr;
  }

  async actOnStep(crId: string, userId: string, rawAction: string, comment?: string, userRole?: string): Promise<ChangeRequest> {
    const action = normalizeAction(rawAction);

    const crRow = await approvalWorkflowRepository.findChangeRequestRaw(crId);
    if (!crRow) throw new Error('Change request not found');
    if (crRow.status !== 'pending' && crRow.status !== 'in_review') {
      throw new Error('Change request is not awaiting review');
    }

    if (!crRow.workflow_id) throw new Error('Change request has no associated workflow');

    const workflow = await approvalWorkflowRepository.findById(crRow.workflow_id);
    if (!workflow) throw new Error('Workflow not found');

    const steps = workflow.steps;
    const currentStep = crRow.current_step ?? 0;

    if (steps[currentStep] && userRole) {
      const requiredRole = steps[currentStep].approverRole;
      if (requiredRole && requiredRole !== userRole && userRole !== 'admin') {
        throw new Error(`Step "${steps[currentStep].name}" requires role "${requiredRole}", but user has role "${userRole}"`);
      }
    }

    await approvalWorkflowRepository.actOnStepTransaction(crId, currentStep, action, comment || null, userId, steps.length);

    const result = await approvalWorkflowRepository.findChangeRequestById(crId);
    if (!result) throw new Error('Change request not found after update');

    const auditAction = action === 'approved' ? 'approval.approve' : action === 'rejected' ? 'approval.reject' : 'approval.return';
    auditLedgerService.append({
      actorId: userId,
      actorType: 'user',
      action: auditAction,
      entityType: 'change_request',
      entityId: crId,
      projectId: result.projectId,
      payload: {
        step: currentStep,
        stepName: steps[currentStep]?.name,
        action,
        comment,
        resultStatus: result.status,
      },
      source: 'web',
    }).catch(err => deadLetterService.capture('audit.append', {}, err));

    // Notify the requester of the action (fire-and-forget)
    if (result.requestedBy && result.requestedBy !== userId) {
      const actionLabel = action === 'approved' ? 'approved' : action === 'rejected' ? 'rejected' : 'returned';
      const stepName = steps[currentStep]?.name || `Step ${currentStep + 1}`;
      notificationService.create({
        userId: result.requestedBy,
        type: 'workflow_action',
        severity: action === 'rejected' ? 'high' : 'medium',
        title: `Change Request ${actionLabel}`,
        message: `"${result.title}" was ${actionLabel} at ${stepName}${comment ? ': ' + comment : ''}`,
        projectId: result.projectId,
        linkType: 'change_request',
        linkId: crId,
      }).catch((err: any) => logger.warn('Failed to notify CR requester', { error: err.message }));
    }

    return result;
  }

  async withdrawChangeRequest(crId: string, userId?: string): Promise<ChangeRequest> {
    const existing = await approvalWorkflowRepository.findChangeRequestById(crId);
    if (!existing) throw new Error('Change request not found');
    if (!['pending', 'in_review'].includes(existing.status)) {
      throw new Error('Only pending or in-review change requests can be withdrawn');
    }

    const result = await approvalWorkflowRepository.updateChangeRequestStatus(crId, 'withdrawn');

    auditLedgerService.append({
      actorId: userId || existing.requestedBy,
      actorType: 'user',
      action: 'approval.withdraw',
      entityType: 'change_request',
      entityId: crId,
      projectId: existing.projectId,
      payload: { before: existing, after: result },
      source: 'web',
    }).catch(err => deadLetterService.capture('audit.append', {}, err));

    return result;
  }

  async getApprovalHistory(crId: string): Promise<ApprovalAction[]> {
    return approvalWorkflowRepository.findApprovalHistory(crId);
  }
}

export const approvalWorkflowService = new ApprovalWorkflowService();
