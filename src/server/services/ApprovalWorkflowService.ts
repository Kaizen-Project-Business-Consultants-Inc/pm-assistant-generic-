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
  actedAt: string;
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
    if (existing.status !== 'draft') throw new Error('Only draft change requests can be edited');
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

  async getChangeRequests(projectId: string, status?: string): Promise<ChangeRequest[]> {
    return approvalWorkflowRepository.findChangeRequests(projectId, status);
  }

  async getChangeRequestDetail(id: string): Promise<{ changeRequest: ChangeRequest; approvalHistory: ApprovalAction[] }> {
    const changeRequest = await approvalWorkflowRepository.findChangeRequestById(id);
    if (!changeRequest) throw new Error('Change request not found');
    const approvalHistory = await this.getApprovalHistory(id);
    return { changeRequest, approvalHistory };
  }

  async submitForApproval(crId: string, workflowId: string, userId?: string): Promise<ChangeRequest> {
    const before = await this.getChangeRequestDetail(crId).catch(() => null);
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

  async actOnStep(crId: string, userId: string, action: string, comment?: string, userRole?: string): Promise<ChangeRequest> {
    const crRow = await approvalWorkflowRepository.findChangeRequestRaw(crId);
    if (!crRow) throw new Error('Change request not found');

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
    return approvalWorkflowRepository.updateChangeRequestStatus(crId, 'withdrawn');
  }

  async getApprovalHistory(crId: string): Promise<ApprovalAction[]> {
    return approvalWorkflowRepository.findApprovalHistory(crId);
  }
}

export const approvalWorkflowService = new ApprovalWorkflowService();
