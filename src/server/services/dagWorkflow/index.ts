import { v4 as uuidv4 } from 'uuid';
import { workflowRepository, type ExecutionVisibility } from '../../database/WorkflowRepository';
import { Task, ScheduleService, scheduleService } from '../ScheduleService';
import { auditLedgerService } from '../AuditLedgerService';
import { deadLetterService } from '../DeadLetterService';
import logger from '../../utils/logger';
import {
  WorkflowDefinition, WorkflowNode, WorkflowExecution,
  DefinitionWithGraph, ExecutionWithNodes, NodeType,
} from './types';
import { matchesTrigger, buildAdjacencyList, advanceExecution, executeWorkflowEngine } from './engine';
import { databaseService } from '../../database/connection';
import { getRequestContext, runAsWorkflow } from '../../middleware/requestContext';

/** How many workflows may start one another in a row (a workflow's change → another workflow …) */
const MAX_WORKFLOW_DEPTH = 3;

/**
 * A change made by a workflow may start other workflows, but only so deep: a workflow whose
 * action re-triggered itself ran 66,000 times in 82 minutes on staging (found 2026-10-08).
 */
function stoppedByDepth(kind: 'task' | 'project' | 'proposal', id: string): boolean {
  const depth = getRequestContext()?.workflowDepth ?? 0;
  if (depth < MAX_WORKFLOW_DEPTH) return false;
  logger.warn('[DagWorkflow] stopped a chain of workflows started by workflows', { kind, id, depth });
  return true;
}

/**
 * A workflow made for one project only runs on that project's events (2026-10-03: every enabled
 * workflow ran on every project's task changes, project changes and AI proposals, so a workflow
 * set up in project A could change tasks — or approve and apply proposals — in project B).
 * Company-wide workflows (no project) still run everywhere; only a company admin can make one.
 */
function appliesTo(def: { projectId: string | null }, projectId: string | null): boolean {
  return !def.projectId || def.projectId === projectId;
}

async function projectOfSchedule(scheduleId: string | null | undefined): Promise<string | null> {
  if (!scheduleId) return null;
  const [r] = await databaseService.query<{ project_id: string }>('SELECT project_id FROM schedules WHERE id = ?', [scheduleId]);
  return r?.project_id ?? null;
}

// Re-export types and templateResolver for external consumers
export * from './types';
export { resolveTemplates } from './templateResolver';

// ── Service ────────────────────────────────────────────────────────────────

class DagWorkflowService {
  private tablesVerified = false;

  private async ensureTablesExist(): Promise<boolean> {
    if (this.tablesVerified) return true;
    const exists = await workflowRepository.checkTablesExist();
    if (exists) this.tablesVerified = true;
    return exists;
  }

  // ── CRUD: Definitions ──────────────────────────────────────────────────

  async createDefinition(data: {
    projectId?: string | null;
    name: string;
    description?: string;
    createdBy: string;
    nodes: { nodeType: NodeType; name: string; config: Record<string, any>; positionX?: number; positionY?: number }[];
    edges: { sourceIndex: number; targetIndex: number; conditionExpr?: Record<string, any>; label?: string; sortOrder?: number }[];
  }): Promise<DefinitionWithGraph> {
    const defId = uuidv4();
    await workflowRepository.insertDefinition(defId, data.projectId ?? null, data.name, data.description ?? null, data.createdBy);

    const nodes: WorkflowNode[] = [];
    for (const n of data.nodes) {
      const nodeId = uuidv4();
      const node = await workflowRepository.insertNode(nodeId, defId, n.nodeType, n.name, n.config, n.positionX ?? 0, n.positionY ?? 0);
      nodes.push(node);
    }

    const edges: import('./types').WorkflowEdge[] = [];
    for (const e of data.edges) {
      const edgeId = uuidv4();
      const srcId = nodes[e.sourceIndex]?.id;
      const tgtId = nodes[e.targetIndex]?.id;
      if (!srcId || !tgtId) continue;
      const edge = await workflowRepository.insertEdge(edgeId, defId, srcId, tgtId, e.conditionExpr ?? null, e.label ?? null, e.sortOrder ?? 0);
      edges.push(edge);
    }

    const def = await workflowRepository.findDefinitionById(defId);
    return { ...def!, nodes, edges };
  }

  async getDefinition(id: string): Promise<DefinitionWithGraph | null> {
    if (!(await this.ensureTablesExist())) return null;
    const def = await workflowRepository.findDefinitionById(id);
    if (!def) return null;
    const nodes = await workflowRepository.findNodesByWorkflow(id);
    const edges = await workflowRepository.findEdgesByWorkflow(id);
    return { ...def, nodes, edges };
  }

  async listDefinitions(projectId?: string): Promise<WorkflowDefinition[]> {
    if (!(await this.ensureTablesExist())) return [];
    return workflowRepository.findDefinitions(projectId);
  }

  async updateDefinition(id: string, data: {
    name?: string;
    description?: string;
    projectId?: string | null;
    nodes?: { nodeType: NodeType; name: string; config: Record<string, any>; positionX?: number; positionY?: number }[];
    edges?: { sourceIndex: number; targetIndex: number; conditionExpr?: Record<string, any>; label?: string; sortOrder?: number }[];
  }): Promise<DefinitionWithGraph | null> {
    const existing = await this.getDefinition(id);
    if (!existing) return null;

    const sets: string[] = [];
    const params: any[] = [];
    if (data.name !== undefined) { sets.push('name = ?'); params.push(data.name); }
    if (data.description !== undefined) { sets.push('description = ?'); params.push(data.description); }
    if (data.projectId !== undefined) { sets.push('project_id = ?'); params.push(data.projectId); }

    if (sets.length > 0) {
      sets.push('version = version + 1');
      await workflowRepository.updateDefinitionFields(id, sets, params);
    }

    if (data.nodes) {
      await workflowRepository.deleteEdgesByWorkflow(id);
      await workflowRepository.deleteNodesByWorkflow(id);

      const nodes: WorkflowNode[] = [];
      for (const n of data.nodes) {
        const nodeId = uuidv4();
        const node = await workflowRepository.insertNode(nodeId, id, n.nodeType, n.name, n.config, n.positionX ?? 0, n.positionY ?? 0);
        nodes.push(node);
      }

      if (data.edges) {
        for (const e of data.edges) {
          const edgeId = uuidv4();
          const srcId = nodes[e.sourceIndex]?.id;
          const tgtId = nodes[e.targetIndex]?.id;
          if (!srcId || !tgtId) continue;
          await workflowRepository.insertEdgeNoReturn(edgeId, id, srcId, tgtId, e.conditionExpr ?? null, e.label ?? null, e.sortOrder ?? 0);
        }
      }
    }

    return this.getDefinition(id);
  }

  async deleteDefinition(id: string): Promise<boolean> {
    return workflowRepository.deleteDefinition(id);
  }

  async toggleEnabled(id: string, enabled: boolean): Promise<WorkflowDefinition | null> {
    const def = await workflowRepository.findDefinitionById(id);
    if (!def) return null;
    await workflowRepository.setEnabled(id, enabled);
    return workflowRepository.findDefinitionById(id);
  }

  // ── Execution queries ──────────────────────────────────────────────────

  async getExecution(id: string): Promise<ExecutionWithNodes | null> {
    if (!(await this.ensureTablesExist())) return null;
    const exec = await workflowRepository.findExecutionById(id);
    if (!exec) return null;
    const nodeExecutions = await workflowRepository.findNodeExecutionsByExecution(id);
    return { ...exec, nodeExecutions };
  }

  async listExecutions(filters?: {
    id?: string;
    workflowId?: string;
    visibleTo?: ExecutionVisibility;
    entityType?: string;
    entityId?: string;
    status?: string;
    limit?: number;
  }): Promise<WorkflowExecution[]> {
    if (!(await this.ensureTablesExist())) return [];
    return workflowRepository.findExecutions(filters);
  }

  // ── Engine: evaluate task changes ──────────────────────────────────────

  async evaluateTaskChange(
    task: Task,
    oldTask: Task | null,
    _scheduleService: ScheduleService,
  ): Promise<void> {
    if (!(await this.ensureTablesExist())) return;
    if (stoppedByDepth('task', task.id)) return;

    try {
      const defs = await workflowRepository.findEnabledDefinitions();
      const taskProject = defs.some(d => d.projectId) ? await projectOfSchedule(task.scheduleId) : null;

      for (const def of defs) {
        if (!appliesTo(def, taskProject)) continue;
        const fullDef = await this.getDefinition(def.id);
        if (!fullDef) continue;

        const triggerNodes = fullDef.nodes.filter(n => n.nodeType === 'trigger');
        for (const triggerNode of triggerNodes) {
          if (matchesTrigger(triggerNode.config, task, oldTask)) {
            // eslint-disable-next-line no-await-in-loop -- workflows fired by one change run one at a time so their actions do not race on the same task
            await runAsWorkflow(() => this.executeWorkflow(fullDef, triggerNode, task));
          }
        }
      }
    } catch (err) {
      logger.error('[DagWorkflow] evaluateTaskChange error:', err);
    }
  }

  async evaluateProjectChange(
    projectId: string,
    changeType: string,
    data: Record<string, any>,
  ): Promise<void> {
    if (stoppedByDepth('project', projectId)) return;
    if (!(await this.ensureTablesExist())) return;

    try {
      const defs = await workflowRepository.findEnabledDefinitions();

      for (const def of defs) {
        if (!appliesTo(def, projectId)) continue;
        const fullDef = await this.getDefinition(def.id);
        if (!fullDef) continue;

        const triggerNodes = fullDef.nodes.filter(n => n.nodeType === 'trigger');
        for (const triggerNode of triggerNodes) {
          const config = triggerNode.config;
          let matched = false;

          if (changeType === 'budget_update' && config.triggerType === 'budget_threshold') {
            const utilization = data.utilization ?? 0;
            const threshold = config.thresholdPercent ?? 90;
            matched = utilization >= threshold;
          } else if (changeType === 'project_status_change' && config.triggerType === 'project_status_change') {
            if (config.toStatus && data.newStatus !== config.toStatus) continue;
            if (config.fromStatus && data.oldStatus !== config.fromStatus) continue;
            matched = true;
          }

          if (matched) {
            // eslint-disable-next-line no-await-in-loop -- workflows fired by one change run one at a time so their actions do not race on the same project
            await runAsWorkflow(() => this.executeWorkflow(fullDef, triggerNode, null));
          }
        }
      }
    } catch (err) {
      logger.error('[DagWorkflow] evaluateProjectChange error:', err);
    }
  }

  async evaluateProposalEvent(
    eventType: 'proposal_created' | 'proposal_executed',
    data: { proposalId: string; projectId: string; agentId: string; confidenceScore: number; riskLevel: string; title: string },
  ): Promise<void> {
    if (stoppedByDepth('proposal', data.proposalId)) return;
    if (!(await this.ensureTablesExist())) return;

    try {
      const defs = await workflowRepository.findEnabledDefinitions();

      for (const def of defs) {
        if (!appliesTo(def, data.projectId)) continue;
        const fullDef = await this.getDefinition(def.id);
        if (!fullDef) continue;

        const triggerNodes = fullDef.nodes.filter(n => n.nodeType === 'trigger');
        for (const triggerNode of triggerNodes) {
          const config = triggerNode.config;
          if (config.triggerType !== eventType) continue;

          let matched = true;

          if (config.agentId && data.agentId !== config.agentId) matched = false;
          if (config.minConfidence && data.confidenceScore < config.minConfidence) matched = false;
          if (config.riskLevel && data.riskLevel !== config.riskLevel) matched = false;

          if (matched) {
            // eslint-disable-next-line no-await-in-loop -- workflows fired by one event run one at a time so their actions do not race on the same proposal
            await runAsWorkflow(() => this.executeWorkflow(fullDef, triggerNode, null, {
              entityType: 'proposal',
              entityId: data.proposalId,
              proposalId: data.proposalId,
              projectId: data.projectId,
              agentId: data.agentId,
              confidenceScore: data.confidenceScore,
              riskLevel: data.riskLevel,
              title: data.title,
            }));
          }
        }
      }
    } catch (err) {
      logger.error('[DagWorkflow] evaluateProposalEvent error:', err);
    }
  }

  async triggerManual(
    workflowId: string,
    entityType: string,
    entityId: string,
    _scheduleService: ScheduleService,
  ): Promise<WorkflowExecution | null> {
    const def = await this.getDefinition(workflowId);
    if (!def) return null;

    const triggerNode = def.nodes.find(n => n.nodeType === 'trigger');
    if (!triggerNode) return null;

    let task: Task | null = null;
    if (entityType === 'task') {
      task = await scheduleService.findTaskById(entityId) ?? null;
    }

    await this.executeWorkflow(def, triggerNode, task);
    return null;
  }

  async resumeExecution(
    executionId: string,
    nodeId: string,
    result: Record<string, any>,
    _scheduleService: ScheduleService,
  ): Promise<ExecutionWithNodes | null> {
    const exec = await this.getExecution(executionId);
    if (!exec || exec.status !== 'waiting') return null;

    const def = await this.getDefinition(exec.workflowId);
    if (!def) return null;

    await workflowRepository.completeWaitingNodeExecution(executionId, nodeId, JSON.stringify(result));
    await workflowRepository.updateExecutionStatus(executionId, 'running');

    let task: Task | null = null;
    if (exec.entityType === 'task') {
      task = await scheduleService.findTaskById(exec.entityId) ?? null;
    }

    const adjacency = buildAdjacencyList(def);
    const visited = new Set<string>();

    const nodeOutputs: Record<string, any> = {};
    for (const ne of exec.nodeExecutions) {
      if (ne.status === 'completed' && ne.outputData) {
        nodeOutputs[ne.nodeId] = ne.outputData;
      }
      if (ne.status === 'completed') visited.add(ne.nodeId);
    }
    nodeOutputs[nodeId] = result;
    visited.add(nodeId);

    await advanceExecution(executionId, nodeId, def, adjacency, visited, task, scheduleService, nodeOutputs);

    return this.getExecution(executionId);
  }

  // ── Internal ───────────────────────────────────────────────────────────

  private async executeWorkflow(
    def: DefinitionWithGraph,
    triggerNode: WorkflowNode,
    task: Task | null,
    triggerContext?: Record<string, any>,
  ): Promise<WorkflowExecution> {
    const execId = await executeWorkflowEngine(def, triggerNode, task, scheduleService, triggerContext);

    const exec = await this.getExecution(execId);

    const entityType = task ? 'task' : (triggerContext?.entityType ?? 'unknown');
    const entityId = task?.id ?? (triggerContext?.entityId ?? '');

    auditLedgerService.append({
      actorId: 'system',
      actorType: 'system',
      action: 'workflow.execute',
      entityType: 'workflow',
      entityId: def.id,
      payload: {
        executionId: execId,
        workflowName: def.name,
        triggerNode: triggerNode.name,
        entityType,
        entityId,
        status: exec?.status ?? 'unknown',
      },
      source: 'system',
    }).catch(err => deadLetterService.capture('audit.workflow_trigger', { workflowId: def.id, entityId }, err));

    return exec!;
  }
}

export const dagWorkflowService = new DagWorkflowService();
