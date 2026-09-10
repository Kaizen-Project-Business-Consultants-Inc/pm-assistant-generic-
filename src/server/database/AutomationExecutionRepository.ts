import { v4 as uuidv4 } from 'uuid';
import { BaseRepository } from './BaseRepository';
import type { AutomationExecution } from '../services/automation/types';

interface ExecutionRow {
  id: string;
  automation_id: string;
  event_type: string;
  event_payload: string | null;
  status: string;
  actions_executed: number;
  actions_failed: number;
  result: string | null;
  error_message: string | null;
  duration_ms: number | null;
  triggered_by: string | null;
  is_dry_run: number;
  recursion_depth: number;
  created_at: string;
}

function rowToDTO(row: ExecutionRow): AutomationExecution {
  let eventPayload: Record<string, any> | null = null;
  if (row.event_payload) {
    try { eventPayload = JSON.parse(row.event_payload); } catch { /* ignore */ }
  }
  let result: Record<string, any> | null = null;
  if (row.result) {
    try { result = JSON.parse(row.result); } catch { /* ignore */ }
  }
  return {
    id: row.id,
    automationId: row.automation_id,
    eventType: row.event_type,
    eventPayload,
    status: row.status as AutomationExecution['status'],
    actionsExecuted: Number(row.actions_executed),
    actionsFailed: Number(row.actions_failed),
    result,
    errorMessage: row.error_message,
    durationMs: row.duration_ms != null ? Number(row.duration_ms) : null,
    triggeredBy: row.triggered_by,
    isDryRun: !!row.is_dry_run,
    recursionDepth: Number(row.recursion_depth),
    createdAt: row.created_at,
  };
}

export class AutomationExecutionRepository extends BaseRepository<AutomationExecution> {
  constructor() {
    super('automation_executions', rowToDTO);
  }

  async insert(data: {
    automationId: string;
    eventType: string;
    eventPayload?: Record<string, any>;
    triggeredBy?: string;
    isDryRun?: boolean;
    recursionDepth?: number;
  }): Promise<string> {
    const id = uuidv4();
    await this.queryRaw(
      `INSERT INTO automation_executions (id, automation_id, event_type, event_payload, triggered_by, is_dry_run, recursion_depth)
       VALUES (?, ?, ?, ?, ?, ?, ?)`,
      [id, data.automationId, data.eventType,
       data.eventPayload ? JSON.stringify(data.eventPayload) : null,
       data.triggeredBy || null, data.isDryRun ? 1 : 0, data.recursionDepth ?? 0],
    );
    return id;
  }

  async complete(id: string, data: {
    status: 'completed' | 'failed' | 'skipped';
    actionsExecuted: number;
    actionsFailed: number;
    result?: Record<string, any>;
    errorMessage?: string;
    durationMs: number;
  }): Promise<void> {
    await this.queryRaw(
      `UPDATE automation_executions SET status = ?, actions_executed = ?, actions_failed = ?, result = ?, error_message = ?, duration_ms = ? WHERE id = ?`,
      [data.status, data.actionsExecuted, data.actionsFailed,
       data.result ? JSON.stringify(data.result) : null,
       data.errorMessage || null, data.durationMs, id],
    );
  }

  async findByAutomation(automationId: string, limit = 50, offset = 0): Promise<{ rows: AutomationExecution[]; total: number }> {
    return this.queryPaginated(
      'automation_id = ?', [automationId],
      'created_at DESC', limit, offset,
    );
  }

  async countTodayByAutomation(automationId: string): Promise<number> {
    const rows = await this.queryRaw(
      `SELECT COUNT(*) AS cnt FROM automation_executions WHERE automation_id = ? AND DATE(created_at) = CURDATE() AND is_dry_run = 0`,
      [automationId],
    );
    return Number(rows[0]?.cnt ?? 0);
  }
}

export const automationExecutionRepository = new AutomationExecutionRepository();
