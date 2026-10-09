import { databaseService } from './connection';
import {
  WorkflowDefinition, WorkflowNode, WorkflowEdge,
  WorkflowExecution, WorkflowNodeExecution, NodeType,
} from '../services/dagWorkflow/types';
import { rowToDef, rowToNode, rowToEdge, rowToExecution, rowToNodeExec, parseJson } from '../services/dagWorkflow/rowMappers';
import { chunksOf } from '../utils/chunksOf';

export type { WorkflowDefinition, WorkflowNode, WorkflowEdge, WorkflowExecution, WorkflowNodeExecution };

/** What a caller who can't read every project may see of the run log (see findExecutions) */
export interface ExecutionVisibility {
  /** workflows of projects the caller can read */
  projectWorkflowIds: string[];
  /** company-wide workflows (no project) */
  orgWorkflowIds: string[];
  /** projects the caller can read */
  projectIds: string[];
}

class WorkflowRepository {
  // ── Table check ───────────────────────────────────────────────────────

  async checkTablesExist(): Promise<boolean> {
    try {
      await databaseService.query('SELECT 1 FROM workflow_definitions LIMIT 1');
      return true;
    } catch {
      return false;
    }
  }

  // ── Definitions ───────────────────────────────────────────────────────

  async insertDefinition(
    id: string, projectId: string | null, name: string, description: string | null, createdBy: string,
  ): Promise<void> {
    await databaseService.query(
      `INSERT INTO workflow_definitions (id, project_id, name, description, created_by) VALUES (?, ?, ?, ?, ?)`,
      [id, projectId, name, description, createdBy],
    );
  }

  async findDefinitionById(id: string): Promise<WorkflowDefinition | null> {
    const rows = await databaseService.query('SELECT * FROM workflow_definitions WHERE id = ?', [id]);
    return rows.length > 0 ? rowToDef(rows[0]) : null;
  }

  async findDefinitions(projectId?: string): Promise<WorkflowDefinition[]> {
    let sql = 'SELECT * FROM workflow_definitions';
    const params: any[] = [];
    if (projectId) {
      sql += ' WHERE (project_id = ? OR project_id IS NULL)';
      params.push(projectId);
    }
    sql += ' ORDER BY created_at DESC';
    const rows = await databaseService.query(sql, params);
    return rows.map(rowToDef);
  }

  async findEnabledDefinitions(): Promise<WorkflowDefinition[]> {
    const rows = await databaseService.query('SELECT * FROM workflow_definitions WHERE is_enabled = 1');
    return rows.map(rowToDef);
  }

  async updateDefinitionFields(id: string, sets: string[], params: any[]): Promise<void> {
    await databaseService.query(
      `UPDATE workflow_definitions SET ${sets.join(', ')} WHERE id = ?`,
      [...params, id],
    );
  }

  async deleteDefinition(id: string): Promise<boolean> {
    const result: any = await databaseService.query('DELETE FROM workflow_definitions WHERE id = ?', [id]);
    return (result.affectedRows ?? 0) > 0;
  }

  async setEnabled(id: string, enabled: boolean): Promise<void> {
    await databaseService.query(
      'UPDATE workflow_definitions SET is_enabled = ? WHERE id = ?',
      [enabled ? 1 : 0, id],
    );
  }

  // ── Nodes ─────────────────────────────────────────────────────────────

  /** A workflow's steps, 200 per statement (was one INSERT + one read-back per step; 2026-10-09) */
  async insertNodes(workflowId: string, nodes: Array<{ id: string; nodeType: NodeType; name: string; config: Record<string, any>; positionX: number; positionY: number }>): Promise<void> {
    for (const chunk of chunksOf(nodes, 200)) {
      // eslint-disable-next-line no-await-in-loop -- one statement per 200 steps
      await databaseService.query(
        `INSERT INTO workflow_nodes (id, workflow_id, node_type, name, config, position_x, position_y) VALUES ${chunk.map(() => '(?, ?, ?, ?, ?, ?, ?)').join(', ')}`,
        chunk.flatMap(n => [n.id, workflowId, n.nodeType, n.name, JSON.stringify(n.config), n.positionX, n.positionY]),
      );
    }
  }

  /** The steps of several workflows in one read, in the same order as findNodesByWorkflow */
  async findNodesByWorkflows(workflowIds: string[]): Promise<WorkflowNode[]> {
    if (workflowIds.length === 0) return [];
    const rows = await databaseService.query(
      `SELECT * FROM workflow_nodes WHERE workflow_id IN (${workflowIds.map(() => '?').join(',')}) ORDER BY position_y, position_x`,
      workflowIds,
    );
    return rows.map(rowToNode);
  }

  async findNodesByWorkflow(workflowId: string): Promise<WorkflowNode[]> {
    const rows = await databaseService.query(
      'SELECT * FROM workflow_nodes WHERE workflow_id = ? ORDER BY position_y, position_x',
      [workflowId],
    );
    return rows.map(rowToNode);
  }

  async deleteNodesByWorkflow(workflowId: string): Promise<void> {
    await databaseService.query('DELETE FROM workflow_nodes WHERE workflow_id = ?', [workflowId]);
  }

  // ── Edges ─────────────────────────────────────────────────────────────

  /** A workflow's links, 200 per statement (was one INSERT per link; 2026-10-09) */
  async insertEdges(workflowId: string, edges: Array<{ id: string; sourceNodeId: string; targetNodeId: string; conditionExpr: Record<string, any> | null; label: string | null; sortOrder: number }>): Promise<void> {
    for (const chunk of chunksOf(edges, 200)) {
      // eslint-disable-next-line no-await-in-loop -- one statement per 200 links
      await databaseService.query(
        `INSERT INTO workflow_edges (id, workflow_id, source_node_id, target_node_id, condition_expr, label, sort_order) VALUES ${chunk.map(() => '(?, ?, ?, ?, ?, ?, ?)').join(', ')}`,
        chunk.flatMap(e => [e.id, workflowId, e.sourceNodeId, e.targetNodeId, e.conditionExpr ? JSON.stringify(e.conditionExpr) : null, e.label, e.sortOrder]),
      );
    }
  }

  /** The links of several workflows in one read, in the same order as findEdgesByWorkflow */
  async findEdgesByWorkflows(workflowIds: string[]): Promise<WorkflowEdge[]> {
    if (workflowIds.length === 0) return [];
    const rows = await databaseService.query(
      `SELECT * FROM workflow_edges WHERE workflow_id IN (${workflowIds.map(() => '?').join(',')}) ORDER BY sort_order`,
      workflowIds,
    );
    return rows.map(rowToEdge);
  }

  async findEdgesByWorkflow(workflowId: string): Promise<WorkflowEdge[]> {
    const rows = await databaseService.query(
      'SELECT * FROM workflow_edges WHERE workflow_id = ? ORDER BY sort_order',
      [workflowId],
    );
    return rows.map(rowToEdge);
  }

  async deleteEdgesByWorkflow(workflowId: string): Promise<void> {
    await databaseService.query('DELETE FROM workflow_edges WHERE workflow_id = ?', [workflowId]);
  }

  // ── Executions ────────────────────────────────────────────────────────

  async insertExecution(
    id: string, workflowId: string, triggerNodeId: string,
    entityType: string, entityId: string, context: Record<string, any>,
  ): Promise<void> {
    await databaseService.query(
      `INSERT INTO workflow_executions (id, workflow_id, trigger_node_id, entity_type, entity_id, status, context) VALUES (?, ?, ?, ?, ?, 'running', ?)`,
      [id, workflowId, triggerNodeId, entityType, entityId, JSON.stringify(context)],
    );
  }

  async findExecutionById(id: string): Promise<WorkflowExecution | null> {
    const rows = await databaseService.query('SELECT * FROM workflow_executions WHERE id = ?', [id]);
    return rows.length > 0 ? rowToExecution(rows[0]) : null;
  }

  async findExecutions(filters?: {
    id?: string; workflowId?: string; visibleTo?: ExecutionVisibility; entityType?: string; entityId?: string; status?: string; limit?: number;
  }): Promise<WorkflowExecution[]> {
    let sql = 'SELECT * FROM workflow_executions WHERE 1=1';
    const params: any[] = [];
    if (filters?.id) { sql += ' AND id = ?'; params.push(filters.id); }
    if (filters?.workflowId) { sql += ' AND workflow_id = ?'; params.push(filters.workflowId); }
    // Only runs the caller may see: all runs of their projects' workflows; runs of company-wide
    // workflows only on tasks in projects they can read (a run's context names the task)
    const v = filters?.visibleTo;
    if (v) {
      const ph = (n: number) => Array(n).fill('?').join(',');
      const parts: string[] = [];
      if (v.projectWorkflowIds.length) { parts.push(`workflow_id IN (${ph(v.projectWorkflowIds.length)})`); params.push(...v.projectWorkflowIds); }
      if (v.orgWorkflowIds.length && v.projectIds.length) {
        parts.push(`(workflow_id IN (${ph(v.orgWorkflowIds.length)}) AND entity_type = 'task' AND entity_id IN `
          + `(SELECT t.id FROM tasks t JOIN schedules s ON s.id = t.schedule_id WHERE s.project_id IN (${ph(v.projectIds.length)})))`);
        params.push(...v.orgWorkflowIds, ...v.projectIds);
      }
      if (parts.length === 0) return [];
      sql += ` AND (${parts.join(' OR ')})`;
    }
    if (filters?.entityType) { sql += ' AND entity_type = ?'; params.push(filters.entityType); }
    if (filters?.entityId) { sql += ' AND entity_id = ?'; params.push(filters.entityId); }
    if (filters?.status) { sql += ' AND status = ?'; params.push(filters.status); }
    sql += ' ORDER BY started_at DESC';
    sql += ' LIMIT ?';
    params.push(filters?.limit ?? 50);
    const rows = await databaseService.query(sql, params);
    return rows.map(rowToExecution);
  }

  async updateExecutionStatus(id: string, status: string, errorMessage?: string): Promise<void> {
    if (errorMessage !== undefined) {
      await databaseService.query(
        `UPDATE workflow_executions SET status = ?, error_message = ?, completed_at = NOW() WHERE id = ?`,
        [status, errorMessage, id],
      );
    } else {
      await databaseService.query(
        `UPDATE workflow_executions SET status = ? WHERE id = ?`,
        [status, id],
      );
    }
  }

  async completeExecution(id: string, status: 'completed' | 'failed'): Promise<void> {
    await databaseService.query(
      `UPDATE workflow_executions SET status = ?, completed_at = NOW() WHERE id = ? AND status = 'running'`,
      [status, id],
    );
  }

  async getExecutionContext(id: string): Promise<Record<string, any>> {
    const rows = await databaseService.query('SELECT context FROM workflow_executions WHERE id = ?', [id]);
    return rows.length > 0 ? parseJson(rows[0].context) : {};
  }

  async updateExecutionContext(id: string, context: Record<string, any>): Promise<void> {
    await databaseService.query(
      `UPDATE workflow_executions SET context = ? WHERE id = ?`,
      [JSON.stringify(context), id],
    );
  }

  // ── Node Executions ───────────────────────────────────────────────────

  async insertNodeExecution(
    id: string, executionId: string, nodeId: string, status: string,
    inputData?: string | null,
  ): Promise<void> {
    const completedAt = status === 'completed' ? 'NOW()' : 'NULL';
    await databaseService.query(
      `INSERT INTO workflow_node_executions (id, execution_id, node_id, status, input_data, started_at, completed_at) VALUES (?, ?, ?, ?, ?, NOW(), ${completedAt})`,
      [id, executionId, nodeId, status, inputData ?? null],
    );
  }

  async findNodeExecutionsByExecution(executionId: string): Promise<WorkflowNodeExecution[]> {
    const rows = await databaseService.query(
      'SELECT * FROM workflow_node_executions WHERE execution_id = ? ORDER BY started_at',
      [executionId],
    );
    return rows.map(rowToNodeExec);
  }

  async updateNodeExecutionCompleted(id: string, outputData: string): Promise<void> {
    await databaseService.query(
      `UPDATE workflow_node_executions SET status = 'completed', output_data = ?, completed_at = NOW() WHERE id = ?`,
      [outputData, id],
    );
  }

  async completeWaitingNodeExecution(executionId: string, nodeId: string, outputData: string): Promise<void> {
    await databaseService.query(
      `UPDATE workflow_node_executions SET status = 'completed', output_data = ?, completed_at = NOW() WHERE execution_id = ? AND node_id = ? AND status = 'waiting'`,
      [outputData, executionId, nodeId],
    );
  }

  async updateNodeExecutionWaiting(id: string): Promise<void> {
    await databaseService.query(
      `UPDATE workflow_node_executions SET status = 'waiting' WHERE id = ?`,
      [id],
    );
  }

  async updateNodeExecutionSkipped(id: string): Promise<void> {
    await databaseService.query(
      `UPDATE workflow_node_executions SET status = 'skipped', completed_at = NOW() WHERE id = ?`,
      [id],
    );
  }

  async updateNodeExecutionFailed(id: string, errorMessage: string): Promise<void> {
    await databaseService.query(
      `UPDATE workflow_node_executions SET status = 'failed', error_message = ?, completed_at = NOW() WHERE id = ?`,
      [errorMessage, id],
    );
  }

  async getNodeExecutionStatuses(executionId: string): Promise<{ status: string }[]> {
    return databaseService.query(
      `SELECT status FROM workflow_node_executions WHERE execution_id = ?`,
      [executionId],
    );
  }
}

export const workflowRepository = new WorkflowRepository();
