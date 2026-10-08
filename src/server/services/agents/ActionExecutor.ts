import { actionProposalService, Proposal, ProposalAction } from './ActionProposalService';
import { proposalEvent } from '../domainEvents';
import { scheduleService } from '../ScheduleService';
import { auditLedgerService } from '../AuditLedgerService';
import { notificationService } from '../NotificationService';
import { deadLetterService } from '../DeadLetterService';
import logger from '../../utils/logger';

export interface ExecutionResult {
  success: boolean;
  actionsExecuted: number;
  actionsFailed: number;
  actionsRolledBack: number;
  error?: string;
}

export class ActionExecutor {
  /**
   * Execute all actions in an approved proposal, in order.
   * On failure, rolls back previously executed actions.
   */
  async execute(proposalId: string): Promise<ExecutionResult> {
    const proposal = await actionProposalService.getById(proposalId);
    if (!proposal) {
      return { success: false, actionsExecuted: 0, actionsFailed: 0, actionsRolledBack: 0, error: 'Proposal not found' };
    }

    if (proposal.status !== 'approved') {
      return { success: false, actionsExecuted: 0, actionsFailed: 0, actionsRolledBack: 0, error: `Proposal status is '${proposal.status}', expected 'approved'` };
    }

    const actions = proposal.actions ?? await actionProposalService.getActions(proposalId);
    if (actions.length === 0) {
      await actionProposalService.updateStatus(proposalId, 'executed');
      return { success: true, actionsExecuted: 0, actionsFailed: 0, actionsRolledBack: 0 };
    }

    // Mark proposal as executing
    await actionProposalService.updateStatus(proposalId, 'executing');

    const executedActions: ProposalAction[] = [];
    let failedAction: ProposalAction | null = null;
    let failError = '';

    for (const action of actions) {
      try {
        // eslint-disable-next-line no-await-in-loop -- a proposal's actions run in order and stop at the first failure so the rest can be rolled back
        await this.executeAction(action, proposal);
        // eslint-disable-next-line no-await-in-loop -- marks this action done before the next one runs
        await actionProposalService.updateActionStatus(action.id, 'executed');
        executedActions.push(action);

        // Audit each successful action (fire-and-forget with DLQ fallback)
        auditLedgerService.append({
          actorId: 'system',
          actorType: 'system',
          action: `agent.execute.${action.actionType}`,
          entityType: action.targetEntityType,
          entityId: action.targetEntityId,
          projectId: proposal.projectId,
          payload: {
            proposalId,
            agentId: proposal.agentId,
            actionId: action.id,
            newValue: action.newValue,
          },
          source: 'system',
        }).catch(err => deadLetterService.capture('audit.action-execute', { proposalId, actionId: action.id }, err));
      } catch (err) {
        failedAction = action;
        failError = err instanceof Error ? err.message : String(err);
        // eslint-disable-next-line no-await-in-loop -- marks the failed action before stopping the run
        await actionProposalService.updateActionStatus(action.id, 'failed', failError);

        logger.error(`[ActionExecutor] Action ${action.id} failed:`, failError);
        break;
      }
    }

    // If a failure occurred, rollback all previously executed actions
    if (failedAction) {
      const rolledBack = await this.rollback(executedActions, proposal);

      await actionProposalService.updateStatus(proposalId, 'failed');

      // Audit the failure (fire-and-forget with DLQ fallback)
      auditLedgerService.append({
        actorId: 'system',
        actorType: 'system',
        action: 'agent.execute.failed',
        entityType: 'agent',
        entityId: proposal.agentId,
        projectId: proposal.projectId,
        payload: {
          proposalId,
          failedActionId: failedAction.id,
          error: failError,
          actionsExecuted: executedActions.length,
          actionsRolledBack: rolledBack,
        },
        source: 'system',
      }).catch(err => deadLetterService.capture('audit.action-failed', { proposalId }, err));

      // Notify project owner
      await notificationService.create({
        userId: proposal.createdBy,
        type: 'agent_execution_failed',
        severity: 'high',
        title: `Agent proposal execution failed`,
        message: `Proposal "${proposal.title}" failed at action ${failedAction.executionOrder}: ${failError}. ${rolledBack} actions were rolled back.`,
        projectId: proposal.projectId,
        linkType: 'proposal',
        linkId: proposalId,
      });

      return {
        success: false,
        actionsExecuted: executedActions.length,
        actionsFailed: 1,
        actionsRolledBack: rolledBack,
        error: failError,
      };
    }

    // All actions succeeded
    await actionProposalService.updateStatus(proposalId, 'executed');

    // Audit success (fire-and-forget with DLQ fallback)
    auditLedgerService.append({
      actorId: 'system',
      actorType: 'system',
      action: 'agent.execute.success',
      entityType: 'agent',
      entityId: proposal.agentId,
      projectId: proposal.projectId,
      payload: {
        proposalId,
        actionsExecuted: executedActions.length,
      },
      source: 'system',
    }).catch(err => deadLetterService.capture('audit.action-success', { proposalId }, err));

    // Notify project owner
    await notificationService.create({
      userId: proposal.createdBy,
      type: 'agent_execution_complete',
      severity: 'medium',
      title: `Agent proposal executed successfully`,
      message: `Proposal "${proposal.title}" was executed. ${executedActions.length} action(s) applied.`,
      projectId: proposal.projectId,
      linkType: 'proposal',
      linkId: proposalId,
    });

    // Fire proposal_executed workflow trigger (fire-and-forget)
    // Workflows with proposal triggers react (via the startup wiring — step 1E)
    proposalEvent('proposal_executed', {
        proposalId,
        projectId: proposal.projectId,
        agentId: proposal.agentId,
        confidenceScore: proposal.confidenceScore,
        riskLevel: proposal.riskLevel,
        title: proposal.title,
    });

    return {
      success: true,
      actionsExecuted: executedActions.length,
      actionsFailed: 0,
      actionsRolledBack: 0,
    };
  }

  /**
   * Execute a single action by type.
   */
  private async executeAction(action: ProposalAction, proposal: Proposal): Promise<void> {
    switch (action.actionType) {
      case 'update_task_dates':
        await this.executeUpdateTaskDates(action);
        break;
      case 'reassign_resource':
        await this.executeReassignResource(action);
        break;
      case 'update_progress':
        await this.executeUpdateProgress(action);
        break;
      case 'update_dependency':
        await this.executeUpdateDependency(action);
        break;
      case 'send_notification':
        await this.executeSendNotification(action, proposal);
        break;
      default:
        throw new Error(`Unsupported action type: ${action.actionType}`);
    }
  }

  private async executeUpdateTaskDates(action: ProposalAction): Promise<void> {
    const { startDate, endDate } = action.newValue as { startDate?: string; endDate?: string };
    const updates: Record<string, unknown> = {};
    if (startDate) updates.startDate = startDate;
    if (endDate) updates.endDate = endDate;

    const result = await scheduleService.updateTask(action.targetEntityId, updates);
    if (!result) {
      throw new Error(`Task ${action.targetEntityId} not found`);
    }
  }

  private async executeReassignResource(action: ProposalAction): Promise<void> {
    const { assignedTo } = action.newValue as { assignedTo: string };
    const result = await scheduleService.updateTask(action.targetEntityId, { assignedTo });
    if (!result) {
      throw new Error(`Task ${action.targetEntityId} not found`);
    }
  }

  private async executeUpdateProgress(action: ProposalAction): Promise<void> {
    const { progressPercentage } = action.newValue as { progressPercentage: number };
    const result = await scheduleService.updateTask(action.targetEntityId, { progressPercentage });
    if (!result) {
      throw new Error(`Task ${action.targetEntityId} not found`);
    }
  }

  private async executeUpdateDependency(action: ProposalAction): Promise<void> {
    const { dependency } = action.newValue as { dependency: string | null };
    const result = await scheduleService.updateTask(action.targetEntityId, { dependency: dependency ?? undefined });
    if (!result) {
      throw new Error(`Task ${action.targetEntityId} not found`);
    }
  }

  private async executeSendNotification(action: ProposalAction, proposal: Proposal): Promise<void> {
    const { title, message, severity } = action.newValue as { title: string; message: string; severity?: string };
    await notificationService.create({
      userId: proposal.createdBy,
      type: 'agent_notification',
      severity: (severity as 'critical' | 'high' | 'medium' | 'low') ?? 'medium',
      title,
      message,
      projectId: proposal.projectId,
    });
  }

  /**
   * Rollback previously executed actions in reverse order.
   */
  private async rollback(executedActions: ProposalAction[], proposal: Proposal): Promise<number> {
    let rolledBack = 0;
    const reversed = [...executedActions].reverse();

    for (const action of reversed) {
      try {
        // eslint-disable-next-line no-await-in-loop -- rollback undoes executed actions one by one in reverse order
        await this.rollbackAction(action);
        // eslint-disable-next-line no-await-in-loop -- marks this action rolled back before undoing the previous one
        await actionProposalService.updateActionStatus(action.id, 'rolled_back');
        rolledBack++;

        auditLedgerService.append({
          actorId: 'system',
          actorType: 'system',
          action: 'agent.rollback',
          entityType: action.targetEntityType,
          entityId: action.targetEntityId,
          projectId: proposal.projectId,
          payload: {
            proposalId: proposal.id,
            actionId: action.id,
            restoredValue: action.oldValue,
          },
          source: 'system',
        }).catch(err => deadLetterService.capture('audit.action-rollback', { proposalId: proposal.id, actionId: action.id }, err));
      } catch (err) {
        logger.error(`[ActionExecutor] Rollback failed for action ${action.id}:`, err);
        // Continue rolling back remaining actions
      }
    }

    return rolledBack;
  }

  /**
   * Rollback a single action by restoring old values.
   */
  private async rollbackAction(action: ProposalAction): Promise<void> {
    if (!action.oldValue) return; // Nothing to rollback

    switch (action.actionType) {
      case 'update_task_dates':
      case 'update_progress':
      case 'update_dependency':
      case 'reassign_resource':
        await scheduleService.updateTask(action.targetEntityId, action.oldValue as Record<string, unknown>);
        break;
      case 'send_notification':
        // Notifications can't be unsent — skip rollback
        break;
      default:
        logger.warn(`[ActionExecutor] No rollback handler for action type: ${action.actionType}`);
    }
  }

  /**
   * Manually rollback an already-executed proposal.
   */
  async rollbackProposal(proposalId: string): Promise<ExecutionResult> {
    const proposal = await actionProposalService.getById(proposalId);
    if (!proposal) {
      return { success: false, actionsExecuted: 0, actionsFailed: 0, actionsRolledBack: 0, error: 'Proposal not found' };
    }

    if (proposal.status !== 'executed') {
      return { success: false, actionsExecuted: 0, actionsFailed: 0, actionsRolledBack: 0, error: `Cannot rollback proposal with status '${proposal.status}'` };
    }

    const actions = (proposal.actions ?? await actionProposalService.getActions(proposalId))
      .filter(a => a.status === 'executed');

    const rolledBack = await this.rollback(actions, proposal);
    await actionProposalService.updateStatus(proposalId, 'rolled_back');

    await notificationService.create({
      userId: proposal.createdBy,
      type: 'agent_rollback',
      severity: 'high',
      title: `Agent proposal rolled back`,
      message: `Proposal "${proposal.title}" was rolled back. ${rolledBack} action(s) reverted.`,
      projectId: proposal.projectId,
      linkType: 'proposal',
      linkId: proposalId,
    });

    return {
      success: true,
      actionsExecuted: 0,
      actionsFailed: 0,
      actionsRolledBack: rolledBack,
    };
  }
}

export const actionExecutor = new ActionExecutor();
// Auto-approved proposals are carried out here (the proposal service no longer imports this file)
actionProposalService.registerAutoExecutor((proposalId) => actionExecutor.execute(proposalId));
