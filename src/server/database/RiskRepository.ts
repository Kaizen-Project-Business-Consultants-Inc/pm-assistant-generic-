import { BaseRepository } from './BaseRepository';
import { databaseService } from './connection';
import { v4 as uuidv4 } from 'uuid';

export interface ProjectRisk {
  id: string;
  projectId: string;
  type: 'risk' | 'issue' | 'action' | 'decision';
  title: string;
  description: string | null;
  category: string;
  severity: string;
  probability: number;
  impact: number;
  riskScore: number;
  status: string;
  triggerCondition: string | null;
  triggered: boolean;
  triggeredAt: string | null;
  mitigationPlan: string | null;
  responsePlan: string | null;
  ownerId: string | null;
  source: 'manual' | 'ai_detected' | 'agent' | 'imported';
  sourceAgentId: string | null;
  aiConfidence: number | null;
  linkedTaskIds: string[] | null;
  linkedProposalId: string | null;
  createdBy: string;
  createdAt: string;
  updatedAt: string;
  resolvedAt: string | null;
  // RAID expansion fields
  sequenceNumber: number | null;
  recordId: string | null;
  dueDate: string | null;
  actionType: 'preventive' | 'corrective' | 'improvement' | null;
  rationale: string | null;
  decidedBy: string | null;
  decisionDate: string | null;
  alternativesConsidered: string | null;
  stakeholdersConsulted: string[] | null;
  cancelReason: string | null;
  linkedRaidIds: string[] | null;
  // Issue-specific fields
  rootCause: string | null;
  impactAssessment: string | null;
  workaround: string | null;
}

export interface RaidActivityLog {
  id: string;
  raidItemId: string;
  projectId: string;
  userId: string;
  actionType: 'comment' | 'status_change' | 'field_update' | 'created' | 'cancelled' | 'reversed' | 'linked';
  fieldName: string | null;
  oldValue: string | null;
  newValue: string | null;
  comment: string | null;
  createdAt: string;
}

function mapRow(row: any): ProjectRisk {
  return {
    id: row.id,
    projectId: row.project_id,
    type: row.type,
    title: row.title,
    description: row.description,
    category: row.category,
    severity: row.severity,
    probability: row.probability,
    impact: row.impact,
    riskScore: row.risk_score,
    status: row.status,
    triggerCondition: row.trigger_condition,
    triggered: !!row.triggered,
    triggeredAt: row.triggered_at,
    mitigationPlan: row.mitigation_plan,
    responsePlan: row.response_plan,
    ownerId: row.owner_id,
    source: row.source,
    sourceAgentId: row.source_agent_id,
    aiConfidence: row.ai_confidence != null ? Number(row.ai_confidence) : null,
    linkedTaskIds: row.linked_task_ids ? (typeof row.linked_task_ids === 'string' ? JSON.parse(row.linked_task_ids) : row.linked_task_ids) : null,
    linkedProposalId: row.linked_proposal_id,
    createdBy: row.created_by,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    resolvedAt: row.resolved_at,
    sequenceNumber: row.sequence_number ?? null,
    recordId: row.record_id ?? null,
    dueDate: row.due_date ?? null,
    actionType: row.action_type ?? null,
    rationale: row.rationale ?? null,
    decidedBy: row.decided_by ?? null,
    decisionDate: row.decision_date ?? null,
    alternativesConsidered: row.alternatives_considered ?? null,
    stakeholdersConsulted: row.stakeholders_consulted ? (typeof row.stakeholders_consulted === 'string' ? JSON.parse(row.stakeholders_consulted) : row.stakeholders_consulted) : null,
    cancelReason: row.cancel_reason ?? null,
    linkedRaidIds: row.linked_raid_ids ? (typeof row.linked_raid_ids === 'string' ? JSON.parse(row.linked_raid_ids) : row.linked_raid_ids) : null,
    rootCause: row.root_cause ?? null,
    impactAssessment: row.impact_assessment ?? null,
    workaround: row.workaround ?? null,
  };
}

function mapActivityRow(row: any): RaidActivityLog {
  return {
    id: row.id,
    raidItemId: row.raid_item_id,
    projectId: row.project_id,
    userId: row.user_id,
    actionType: row.action_type,
    fieldName: row.field_name,
    oldValue: row.old_value,
    newValue: row.new_value,
    comment: row.comment,
    createdAt: row.created_at,
  };
}

export interface RiskFilters {
  type?: 'risk' | 'issue' | 'action' | 'decision';
  status?: string;
  severity?: string;
  source?: string;
  category?: string;
  ownerId?: string;
  search?: string;
  sort?: 'risk_score' | 'created_at' | 'severity' | 'status' | 'record_id' | 'due_date';
  sortDir?: 'asc' | 'desc';
}

export interface RiskStats {
  totalRisks: number;
  totalIssues: number;
  totalActions: number;
  totalDecisions: number;
  openRisks: number;
  openIssues: number;
  openActions: number;
  pendingDecisions: number;
  critical: number;
  triggered: number;
}

const COLUMN_MAP: Record<string, string> = {
  type: 'type',
  title: 'title',
  description: 'description',
  category: 'category',
  severity: 'severity',
  probability: 'probability',
  impact: 'impact',
  status: 'status',
  triggerCondition: 'trigger_condition',
  triggered: 'triggered',
  triggeredAt: 'triggered_at',
  mitigationPlan: 'mitigation_plan',
  responsePlan: 'response_plan',
  ownerId: 'owner_id',
  source: 'source',
  sourceAgentId: 'source_agent_id',
  aiConfidence: 'ai_confidence',
  linkedTaskIds: 'linked_task_ids',
  linkedProposalId: 'linked_proposal_id',
  resolvedAt: 'resolved_at',
  dueDate: 'due_date',
  actionType: 'action_type',
  rationale: 'rationale',
  decidedBy: 'decided_by',
  decisionDate: 'decision_date',
  alternativesConsidered: 'alternatives_considered',
  stakeholdersConsulted: 'stakeholders_consulted',
  cancelReason: 'cancel_reason',
  linkedRaidIds: 'linked_raid_ids',
  rootCause: 'root_cause',
  impactAssessment: 'impact_assessment',
  workaround: 'workaround',
};

class RiskRepository extends BaseRepository<ProjectRisk> {
  constructor() {
    super('project_risks', mapRow);
  }

  async nextSequenceId(type: string): Promise<{ sequenceNumber: number; recordId: string }> {
    const prefix: Record<string, string> = { risk: 'R', issue: 'I', action: 'A', decision: 'D' };
    const p = prefix[type] || 'X';
    return databaseService.transaction(async (conn) => {
      const rows = await databaseService.queryOn<{ next_val: number }>(conn,
        'SELECT next_val FROM raid_sequence_counter WHERE type = ? FOR UPDATE', [type],
      );
      const seqNum = rows[0].next_val;
      await databaseService.queryOn(conn,
        'UPDATE raid_sequence_counter SET next_val = next_val + 1 WHERE type = ?', [type],
      );
      return { sequenceNumber: seqNum, recordId: `${p}-${String(seqNum).padStart(3, '0')}` };
    });
  }

  async findByProject(projectId: string, filters: RiskFilters = {}): Promise<ProjectRisk[]> {
    const conditions: string[] = ['project_id = ?'];
    const params: any[] = [projectId];

    if (filters.type) {
      conditions.push('type = ?');
      params.push(filters.type);
    }
    if (filters.status) {
      conditions.push('status = ?');
      params.push(filters.status);
    }
    if (filters.severity) {
      conditions.push('severity = ?');
      params.push(filters.severity);
    }
    if (filters.source) {
      conditions.push('source = ?');
      params.push(filters.source);
    }
    if (filters.category) {
      conditions.push('category = ?');
      params.push(filters.category);
    }
    if (filters.ownerId) {
      conditions.push('owner_id = ?');
      params.push(filters.ownerId);
    }
    if (filters.search) {
      conditions.push('(title LIKE ? OR description LIKE ?)');
      const term = `%${filters.search}%`;
      params.push(term, term);
    }

    const ALLOWED_SORT_COLS = ['risk_score', 'severity', 'probability', 'impact', 'created_at', 'title', 'status', 'type', 'category', 'updated_at'];
    const ALLOWED_DIRS = ['asc', 'desc'];
    const sort = ALLOWED_SORT_COLS.includes(filters.sort || '') ? filters.sort! : 'risk_score';
    const dir = ALLOWED_DIRS.includes((filters.sortDir || '').toLowerCase()) ? filters.sortDir!.toLowerCase() : 'desc';
    const orderBy = `${sort} ${dir}, created_at DESC`;

    const rows = await this.queryRaw(
      `SELECT * FROM project_risks WHERE ${conditions.join(' AND ')} ORDER BY ${orderBy}`,
      params,
    );
    return this.mapRows(rows);
  }

  async create(data: {
    projectId: string;
    type: 'risk' | 'issue' | 'action' | 'decision';
    title: string;
    description?: string;
    category?: string;
    severity?: string;
    probability?: number;
    impact?: number;
    status?: string;
    triggerCondition?: string;
    mitigationPlan?: string;
    responsePlan?: string;
    ownerId?: string;
    source?: 'manual' | 'ai_detected' | 'agent' | 'imported';
    sourceAgentId?: string;
    aiConfidence?: number;
    linkedTaskIds?: string[];
    linkedProposalId?: string;
    createdBy: string;
    dueDate?: string;
    actionType?: 'preventive' | 'corrective' | 'improvement';
    rationale?: string;
    decidedBy?: string;
    decisionDate?: string;
    alternativesConsidered?: string;
    stakeholdersConsulted?: string[];
    linkedRaidIds?: string[];
    rootCause?: string;
    impactAssessment?: string;
    workaround?: string;
  }): Promise<ProjectRisk> {
    const id = uuidv4();
    const { sequenceNumber, recordId } = await this.nextSequenceId(data.type);

    await databaseService.query(
      `INSERT INTO project_risks (id, project_id, type, title, description, category, severity,
        probability, impact, status, trigger_condition, mitigation_plan, response_plan, owner_id,
        source, source_agent_id, ai_confidence, linked_task_ids, linked_proposal_id, created_by,
        sequence_number, record_id, due_date, action_type, rationale, decided_by, decision_date,
        alternatives_considered, stakeholders_consulted, linked_raid_ids,
        root_cause, impact_assessment, workaround)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        id,
        data.projectId,
        data.type,
        data.title,
        data.description || null,
        data.category || 'other',
        data.severity || 'medium',
        data.probability ?? 3,
        data.impact ?? 3,
        data.status || (data.type === 'decision' ? 'pending_decision' : 'open'),
        data.triggerCondition || null,
        data.mitigationPlan || null,
        data.responsePlan || null,
        data.ownerId || null,
        data.source || 'manual',
        data.sourceAgentId || null,
        data.aiConfidence ?? null,
        data.linkedTaskIds ? JSON.stringify(data.linkedTaskIds) : null,
        data.linkedProposalId || null,
        data.createdBy,
        sequenceNumber,
        recordId,
        data.dueDate || null,
        data.actionType || null,
        data.rationale || null,
        data.decidedBy || null,
        data.decisionDate || null,
        data.alternativesConsidered || null,
        data.stakeholdersConsulted ? JSON.stringify(data.stakeholdersConsulted) : null,
        data.linkedRaidIds ? JSON.stringify(data.linkedRaidIds) : null,
        data.rootCause || null,
        data.impactAssessment || null,
        data.workaround || null,
      ],
    );
    return (await this.findById(id))!;
  }

  async update(id: string, data: Record<string, any>): Promise<ProjectRisk | null> {
    const upd = this.buildUpdate(data, COLUMN_MAP, (key, val) => {
      if (key === 'linkedTaskIds' || key === 'linkedRaidIds' || key === 'stakeholdersConsulted') {
        return val ? JSON.stringify(val) : null;
      }
      return val;
    });
    if (!upd) return this.findById(id);

    upd.values.push(id);
    await databaseService.query(upd.sql, upd.values);
    return this.findById(id);
  }

  async findByAgentSource(projectId: string, agentId: string): Promise<ProjectRisk[]> {
    const rows = await this.queryRaw(
      `SELECT * FROM project_risks WHERE project_id = ? AND source_agent_id = ? ORDER BY created_at DESC`,
      [projectId, agentId],
    );
    return this.mapRows(rows);
  }

  async findUntriggered(projectId: string): Promise<ProjectRisk[]> {
    const rows = await this.queryRaw(
      `SELECT * FROM project_risks WHERE project_id = ? AND trigger_condition IS NOT NULL AND triggered = FALSE AND status NOT IN ('closed', 'resolved', 'cancelled')`,
      [projectId],
    );
    return this.mapRows(rows);
  }

  async getStats(projectId: string): Promise<RiskStats> {
    const rows = await this.queryRaw(
      `SELECT
         SUM(type = 'risk') AS totalRisks,
         SUM(type = 'issue') AS totalIssues,
         SUM(type = 'action') AS totalActions,
         SUM(type = 'decision') AS totalDecisions,
         SUM(type = 'risk' AND status NOT IN ('closed','mitigated','resolved','cancelled')) AS openRisks,
         SUM(type = 'issue' AND status NOT IN ('closed','resolved','cancelled')) AS openIssues,
         SUM(type = 'action' AND status NOT IN ('closed','completed','cancelled','deferred')) AS openActions,
         SUM(type = 'decision' AND status = 'pending_decision') AS pendingDecisions,
         SUM(severity = 'critical' AND status NOT IN ('closed','mitigated','resolved','cancelled')) AS critical,
         SUM(triggered = TRUE) AS triggered
       FROM project_risks WHERE project_id = ?`,
      [projectId],
    );
    const r = rows[0] || {};
    return {
      totalRisks: Number(r.totalRisks) || 0,
      totalIssues: Number(r.totalIssues) || 0,
      totalActions: Number(r.totalActions) || 0,
      totalDecisions: Number(r.totalDecisions) || 0,
      openRisks: Number(r.openRisks) || 0,
      openIssues: Number(r.openIssues) || 0,
      openActions: Number(r.openActions) || 0,
      pendingDecisions: Number(r.pendingDecisions) || 0,
      critical: Number(r.critical) || 0,
      triggered: Number(r.triggered) || 0,
    };
  }

  async createActivityLog(data: {
    raidItemId: string;
    projectId: string;
    userId: string;
    actionType: RaidActivityLog['actionType'];
    fieldName?: string;
    oldValue?: string;
    newValue?: string;
    comment?: string;
  }): Promise<RaidActivityLog> {
    const id = uuidv4();
    await databaseService.query(
      `INSERT INTO raid_activity_log (id, raid_item_id, project_id, user_id, action_type, field_name, old_value, new_value, comment)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [id, data.raidItemId, data.projectId, data.userId, data.actionType,
       data.fieldName || null, data.oldValue || null, data.newValue || null, data.comment || null],
    );
    return { id, ...data, fieldName: data.fieldName || null, oldValue: data.oldValue || null, newValue: data.newValue || null, comment: data.comment || null, createdAt: new Date().toISOString() };
  }

  async getActivityLog(raidItemId: string): Promise<RaidActivityLog[]> {
    const rows = await databaseService.query(
      `SELECT * FROM raid_activity_log WHERE raid_item_id = ? ORDER BY created_at DESC`,
      [raidItemId],
    );
    return rows.map(mapActivityRow);
  }
}

export const riskRepository = new RiskRepository();
