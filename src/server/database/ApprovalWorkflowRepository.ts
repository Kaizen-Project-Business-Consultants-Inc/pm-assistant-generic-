import { v4 as uuidv4 } from 'uuid';
import { BaseRepository } from './BaseRepository';
import { databaseService } from './connection';
import type { ApprovalWorkflow, WorkflowStep, ChangeRequest, ApprovalAction } from '../services/ApprovalWorkflowService';

interface ApprovalWorkflowRow {
  id: string;
  project_id: string;
  name: string;
  description: string | null;
  entity_type: string;
  steps: string;
  is_active: boolean | number;
  created_by: string;
  created_at: string;
  updated_at: string;
}

interface ChangeRequestRow {
  id: string;
  project_id: string;
  workflow_id: string | null;
  title: string;
  description: string | null;
  category: string;
  priority: string;
  impact_summary: string | null;
  status: string;
  current_step: number | null;
  requested_by: string;
  created_at: string;
  updated_at: string;
}

interface ApprovalActionRow {
  id: string;
  change_request_id: string;
  step_order: number;
  action: string;
  comment: string | null;
  acted_by: string;
  acted_at: string;
}

function workflowRowToDTO(row: ApprovalWorkflowRow): ApprovalWorkflow {
  let steps: WorkflowStep[] = [];
  if (row.steps) {
    try { steps = typeof row.steps === 'string' ? JSON.parse(row.steps) : row.steps; } catch { steps = []; }
  }
  return {
    id: row.id,
    projectId: row.project_id,
    name: row.name,
    description: row.description,
    entityType: row.entity_type,
    steps,
    isActive: !!row.is_active,
    createdBy: row.created_by,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

function changeRequestRowToDTO(row: ChangeRequestRow): ChangeRequest {
  return {
    id: row.id,
    projectId: row.project_id,
    workflowId: row.workflow_id,
    title: row.title,
    description: row.description,
    category: row.category,
    priority: row.priority,
    impactSummary: row.impact_summary,
    status: row.status,
    currentStep: row.current_step != null ? Number(row.current_step) : null,
    requestedBy: row.requested_by,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

function approvalActionRowToDTO(row: ApprovalActionRow): ApprovalAction {
  return {
    id: row.id,
    changeRequestId: row.change_request_id,
    stepOrder: Number(row.step_order),
    action: row.action,
    comment: row.comment,
    actedBy: row.acted_by,
    actedAt: row.acted_at,
  };
}

export class ApprovalWorkflowRepository extends BaseRepository<ApprovalWorkflow> {
  constructor() {
    super('approval_workflows', workflowRowToDTO);
  }

  async createWorkflow(projectId: string, data: {
    name: string;
    description?: string;
    entityType: string;
    steps: WorkflowStep[];
    isActive?: boolean;
    createdBy: string;
  }): Promise<ApprovalWorkflow> {
    const id = uuidv4();
    await this.queryRaw(
      `INSERT INTO approval_workflows (id, project_id, name, description, entity_type, steps, is_active, created_by)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
      [id, projectId, data.name, data.description || null, data.entityType,
       JSON.stringify(data.steps), data.isActive !== false, data.createdBy],
    );
    return (await this.findById(id))!;
  }

  async findByProject(projectId: string): Promise<ApprovalWorkflow[]> {
    const rows = await this.queryRaw(
      'SELECT * FROM approval_workflows WHERE project_id = ? ORDER BY created_at',
      [projectId],
    );
    return this.mapRows(rows);
  }

  async updateWorkflow(id: string, data: {
    name?: string;
    description?: string;
    entityType?: string;
    steps?: WorkflowStep[];
    isActive?: boolean;
  }): Promise<ApprovalWorkflow> {
    const sets: string[] = [];
    const params: any[] = [];
    if (data.name !== undefined) { sets.push('name = ?'); params.push(data.name); }
    if (data.description !== undefined) { sets.push('description = ?'); params.push(data.description); }
    if (data.entityType !== undefined) { sets.push('entity_type = ?'); params.push(data.entityType); }
    if (data.steps !== undefined) { sets.push('steps = ?'); params.push(JSON.stringify(data.steps)); }
    if (data.isActive !== undefined) { sets.push('is_active = ?'); params.push(data.isActive); }
    if (sets.length > 0) {
      params.push(id);
      await this.queryRaw(`UPDATE approval_workflows SET ${sets.join(', ')} WHERE id = ?`, params);
    }
    return (await this.findById(id))!;
  }

  async deleteWorkflow(id: string): Promise<void> {
    await this.queryRaw('DELETE FROM approval_workflows WHERE id = ?', [id]);
  }

  // --- Change Requests ---

  async createChangeRequest(projectId: string, data: {
    title: string;
    description?: string;
    category: string;
    priority: string;
    impactSummary?: string;
    requestedBy: string;
  }): Promise<ChangeRequest> {
    const id = uuidv4();
    await this.queryRaw(
      `INSERT INTO change_requests (id, project_id, title, description, category, priority, impact_summary, status, requested_by)
       VALUES (?, ?, ?, ?, ?, ?, ?, 'draft', ?)`,
      [id, projectId, data.title, data.description || '', data.category, data.priority,
       data.impactSummary || null, data.requestedBy],
    );
    const rows = await this.queryRaw('SELECT * FROM change_requests WHERE id = ?', [id]);
    return changeRequestRowToDTO(rows[0]);
  }

  async findChangeRequests(projectId: string, status?: string): Promise<ChangeRequest[]> {
    let sql = 'SELECT * FROM change_requests WHERE project_id = ?';
    const params: any[] = [projectId];
    if (status) { sql += ' AND status = ?'; params.push(status); }
    sql += ' ORDER BY created_at DESC';
    const rows = await this.queryRaw(sql, params);
    return rows.map(changeRequestRowToDTO);
  }

  async findChangeRequestById(id: string): Promise<ChangeRequest | null> {
    const rows = await this.queryRaw('SELECT * FROM change_requests WHERE id = ?', [id]);
    return rows.length > 0 ? changeRequestRowToDTO(rows[0]) : null;
  }

  async findChangeRequestRaw(id: string): Promise<ChangeRequestRow | null> {
    const rows = await this.queryRaw('SELECT * FROM change_requests WHERE id = ?', [id]);
    return rows.length > 0 ? rows[0] : null;
  }

  async updateChangeRequest(id: string, data: {
    title?: string;
    description?: string;
    category?: string;
    priority?: string;
    impactSummary?: string;
  }): Promise<ChangeRequest> {
    const sets: string[] = [];
    const params: any[] = [];
    if (data.title !== undefined) { sets.push('title = ?'); params.push(data.title); }
    if (data.description !== undefined) { sets.push('description = ?'); params.push(data.description); }
    if (data.category !== undefined) { sets.push('category = ?'); params.push(data.category); }
    if (data.priority !== undefined) { sets.push('priority = ?'); params.push(data.priority); }
    if (data.impactSummary !== undefined) { sets.push('impact_summary = ?'); params.push(data.impactSummary); }
    if (sets.length > 0) {
      params.push(id);
      await this.queryRaw(`UPDATE change_requests SET ${sets.join(', ')} WHERE id = ?`, params);
    }
    const rows = await this.queryRaw('SELECT * FROM change_requests WHERE id = ?', [id]);
    return changeRequestRowToDTO(rows[0]);
  }

  async deleteChangeRequest(id: string): Promise<void> {
    await this.queryRaw('DELETE FROM approval_actions WHERE change_request_id = ?', [id]);
    await this.queryRaw('DELETE FROM change_requests WHERE id = ?', [id]);
  }

  async updateChangeRequestStatus(id: string, status: string, extra?: { currentStep?: number; workflowId?: string }): Promise<ChangeRequest> {
    const sets: string[] = ['status = ?'];
    const params: any[] = [status];
    if (extra?.currentStep !== undefined) { sets.push('current_step = ?'); params.push(extra.currentStep); }
    if (extra?.workflowId !== undefined) { sets.push('workflow_id = ?'); params.push(extra.workflowId); }
    params.push(id);
    await this.queryRaw(`UPDATE change_requests SET ${sets.join(', ')} WHERE id = ?`, params);
    const rows = await this.queryRaw('SELECT * FROM change_requests WHERE id = ?', [id]);
    return changeRequestRowToDTO(rows[0]);
  }

  async actOnStepTransaction(crId: string, currentStep: number, action: string, comment: string | null, userId: string, totalSteps: number): Promise<void> {
    await databaseService.transaction(async (conn) => {
      const q = (sql: string, params: any[] = []) => databaseService.queryOn(conn, sql, params);

      const actionId = uuidv4();
      await q(
        `INSERT INTO approval_actions (id, change_request_id, step_order, action, comment, acted_by)
         VALUES (?, ?, ?, ?, ?, ?)`,
        [actionId, crId, currentStep, action, comment, userId],
      );

      if (action === 'approved') {
        if (currentStep < totalSteps - 1) {
          await q(`UPDATE change_requests SET status = 'in_review', current_step = ? WHERE id = ?`, [currentStep + 1, crId]);
        } else {
          await q(`UPDATE change_requests SET status = 'approved', current_step = ? WHERE id = ?`, [currentStep, crId]);
        }
      } else if (action === 'rejected') {
        await q(`UPDATE change_requests SET status = 'rejected' WHERE id = ?`, [crId]);
      } else if (action === 'returned') {
        await q(`UPDATE change_requests SET status = 'draft', current_step = 0 WHERE id = ?`, [crId]);
      }
    });
  }

  // --- Approval Actions ---

  async findApprovalHistory(crId: string): Promise<ApprovalAction[]> {
    const rows = await this.queryRaw(
      'SELECT * FROM approval_actions WHERE change_request_id = ? ORDER BY acted_at',
      [crId],
    );
    return rows.map(approvalActionRowToDTO);
  }
}

export const approvalWorkflowRepository = new ApprovalWorkflowRepository();
