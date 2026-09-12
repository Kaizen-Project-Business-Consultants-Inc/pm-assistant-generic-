import { v4 as uuidv4 } from 'uuid';
import { BaseRepository } from './BaseRepository';
import type { AutomationRule, AutomationDefinition, AutomationStatus, ScheduleConfig } from '../services/automation/types';

interface AutomationRow {
  id: string;
  project_id: string;
  name: string;
  description: string | null;
  owner_user_id: string;
  status: string;
  version: number;
  trigger_event_type: string;
  trigger_entity_type: string | null;
  scope: string;
  definition: string;
  schedule_config: string | null;
  timezone: string | null;
  next_run_at: string | null;
  last_run_at: string | null;
  trigger_count: number;
  last_triggered_at: string | null;
  last_error: string | null;
  max_runs_per_day: number;
  cooldown_seconds: number;
  enabled_at: string | null;
  disabled_at: string | null;
  created_at: string;
  updated_at: string;
}

function rowToDTO(row: AutomationRow): AutomationRule {
  let definition: AutomationDefinition = { actions: [] };
  if (row.definition) {
    try { definition = typeof row.definition === 'string' ? JSON.parse(row.definition) : row.definition; } catch { /* keep default */ }
  }
  return {
    id: row.id,
    projectId: row.project_id,
    name: row.name,
    description: row.description,
    ownerUserId: row.owner_user_id,
    status: row.status as AutomationStatus,
    version: Number(row.version),
    triggerEventType: row.trigger_event_type,
    triggerEntityType: row.trigger_entity_type,
    scope: (row.scope === 'portfolio' ? 'portfolio' : 'project') as 'project' | 'portfolio',
    definition,
    scheduleConfig: row.schedule_config ? (typeof row.schedule_config === 'string' ? JSON.parse(row.schedule_config) : row.schedule_config) : null,
    timezone: row.timezone || null,
    nextRunAt: row.next_run_at,
    lastRunAt: row.last_run_at,
    triggerCount: Number(row.trigger_count),
    lastTriggeredAt: row.last_triggered_at,
    lastError: row.last_error,
    maxRunsPerDay: Number(row.max_runs_per_day),
    cooldownSeconds: Number(row.cooldown_seconds),
    enabledAt: row.enabled_at,
    disabledAt: row.disabled_at,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

export class AutomationRepository extends BaseRepository<AutomationRule> {
  constructor() {
    super('automations', rowToDTO);
  }

  async create(projectId: string, data: {
    name: string;
    description?: string;
    ownerUserId: string;
    triggerEventType: string;
    triggerEntityType?: string;
    scope?: 'project' | 'portfolio';
    definition: AutomationDefinition;
    scheduleConfig?: ScheduleConfig | null;
    timezone?: string;
    nextRunAt?: Date | null;
    maxRunsPerDay?: number;
    cooldownSeconds?: number;
  }): Promise<AutomationRule> {
    const id = uuidv4();
    await this.queryRaw(
      `INSERT INTO automations (id, project_id, name, description, owner_user_id, trigger_event_type, trigger_entity_type, scope, definition, schedule_config, timezone, next_run_at, max_runs_per_day, cooldown_seconds)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [id, projectId, data.name, data.description || null, data.ownerUserId,
       data.triggerEventType, data.triggerEntityType || null,
       data.scope || 'project',
       JSON.stringify(data.definition),
       data.scheduleConfig ? JSON.stringify(data.scheduleConfig) : null,
       data.timezone || null,
       data.nextRunAt || null,
       data.maxRunsPerDay ?? 50, data.cooldownSeconds ?? 0],
    );
    return (await this.findById(id))!;
  }

  async findByProject(projectId: string): Promise<AutomationRule[]> {
    const rows = await this.queryRaw(
      'SELECT * FROM automations WHERE project_id = ? ORDER BY created_at DESC',
      [projectId],
    );
    return this.mapRows(rows);
  }

  async findActiveByTrigger(eventType: string): Promise<AutomationRule[]> {
    const rows = await this.queryRaw(
      `SELECT * FROM automations WHERE trigger_event_type = ? AND status = 'active'`,
      [eventType],
    );
    return this.mapRows(rows);
  }

  async findActivePortfolioByTrigger(eventType: string): Promise<AutomationRule[]> {
    const rows = await this.queryRaw(
      `SELECT * FROM automations WHERE scope = 'portfolio' AND trigger_event_type = ? AND status = 'active'`,
      [eventType],
    );
    return this.mapRows(rows);
  }

  async findPortfolioAutomations(): Promise<AutomationRule[]> {
    const rows = await this.queryRaw(
      `SELECT * FROM automations WHERE scope = 'portfolio' ORDER BY created_at DESC`,
      [],
    );
    return this.mapRows(rows);
  }

  async update(id: string, data: {
    name?: string;
    description?: string;
    triggerEventType?: string;
    triggerEntityType?: string;
    scope?: 'project' | 'portfolio';
    definition?: AutomationDefinition;
    scheduleConfig?: ScheduleConfig | null;
    timezone?: string | null;
    nextRunAt?: Date | null;
    maxRunsPerDay?: number;
    cooldownSeconds?: number;
  }): Promise<AutomationRule> {
    const sets: string[] = [];
    const params: any[] = [];
    if (data.name !== undefined) { sets.push('name = ?'); params.push(data.name); }
    if (data.description !== undefined) { sets.push('description = ?'); params.push(data.description); }
    if (data.triggerEventType !== undefined) { sets.push('trigger_event_type = ?'); params.push(data.triggerEventType); }
    if (data.triggerEntityType !== undefined) { sets.push('trigger_entity_type = ?'); params.push(data.triggerEntityType); }
    if (data.scope !== undefined) { sets.push('scope = ?'); params.push(data.scope); }
    if (data.definition !== undefined) { sets.push('definition = ?'); params.push(JSON.stringify(data.definition)); }
    if (data.scheduleConfig !== undefined) { sets.push('schedule_config = ?'); params.push(data.scheduleConfig ? JSON.stringify(data.scheduleConfig) : null); }
    if (data.timezone !== undefined) { sets.push('timezone = ?'); params.push(data.timezone); }
    if (data.nextRunAt !== undefined) { sets.push('next_run_at = ?'); params.push(data.nextRunAt); }
    if (data.maxRunsPerDay !== undefined) { sets.push('max_runs_per_day = ?'); params.push(data.maxRunsPerDay); }
    if (data.cooldownSeconds !== undefined) { sets.push('cooldown_seconds = ?'); params.push(data.cooldownSeconds); }
    if (sets.length > 0) {
      sets.push('version = version + 1');
      params.push(id);
      await this.queryRaw(`UPDATE automations SET ${sets.join(', ')} WHERE id = ?`, params);
    }
    return (await this.findById(id))!;
  }

  async updateStatus(id: string, status: AutomationStatus): Promise<void> {
    const extra = status === 'active' ? ', enabled_at = NOW()' : status === 'disabled' ? ', disabled_at = NOW()' : '';
    await this.queryRaw(`UPDATE automations SET status = ?${extra} WHERE id = ?`, [status, id]);
  }

  async updateStats(id: string, data: { lastError?: string | null }): Promise<void> {
    await this.queryRaw(
      `UPDATE automations SET trigger_count = trigger_count + 1, last_triggered_at = NOW(), last_error = ? WHERE id = ?`,
      [data.lastError ?? null, id],
    );
  }

  async findDueScheduled(): Promise<AutomationRule[]> {
    const rows = await this.queryRaw(
      `SELECT * FROM automations WHERE status = 'active' AND schedule_config IS NOT NULL AND next_run_at IS NOT NULL AND next_run_at <= NOW()`,
      [],
    );
    return this.mapRows(rows);
  }

  async updateScheduleAfterRun(id: string, nextRunAt: Date | null): Promise<void> {
    await this.queryRaw(
      `UPDATE automations SET last_run_at = NOW(), next_run_at = ?, trigger_count = trigger_count + 1, last_triggered_at = NOW() WHERE id = ?`,
      [nextRunAt, id],
    );
  }

  async clearNextRunAt(id: string): Promise<void> {
    await this.queryRaw('UPDATE automations SET next_run_at = NULL WHERE id = ?', [id]);
  }

  async delete(id: string): Promise<void> {
    await this.queryRaw('DELETE FROM automation_executions WHERE automation_id = ?', [id]);
    await this.queryRaw('DELETE FROM automation_cooldowns WHERE automation_id = ?', [id]);
    await this.queryRaw('DELETE FROM automations WHERE id = ?', [id]);
  }
}

export const automationRepository = new AutomationRepository();
