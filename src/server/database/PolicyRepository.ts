import { databaseService } from './connection';

export interface Policy {
  id: string;
  projectId: string | null;
  name: string;
  description: string | null;
  actionPattern: string;
  conditionExpr: { field: string; op: string; value: any };
  enforcement: 'log_only' | 'require_approval' | 'block';
  isActive: boolean;
  createdBy: string;
  createdAt: string;
}

function parseCondition(val: any): { field: string; op: string; value: any } {
  if (!val) return { field: '', op: '==', value: '' };
  try { return typeof val === 'string' ? JSON.parse(val) : val; } catch { return { field: '', op: '==', value: '' }; }
}

function rowToPolicy(row: any): Policy {
  return {
    id: row.id, projectId: row.project_id, name: row.name,
    description: row.description, actionPattern: row.action_pattern,
    conditionExpr: parseCondition(row.condition_expr),
    enforcement: row.enforcement, isActive: !!row.is_active,
    createdBy: row.created_by, createdAt: row.created_at,
  };
}

class PolicyRepository {
  async findActive(projectId?: string): Promise<Policy[]> {
    let sql: string;
    let params: any[];
    if (projectId) {
      sql = 'SELECT * FROM policies WHERE is_active = 1 AND (project_id = ? OR project_id IS NULL) ORDER BY created_at';
      params = [projectId];
    } else {
      sql = 'SELECT * FROM policies WHERE is_active = 1 AND project_id IS NULL ORDER BY created_at';
      params = [];
    }
    const rows = await databaseService.query(sql, params);
    return rows.map(rowToPolicy);
  }

  async findByProject(projectId: string): Promise<Policy[]> {
    const rows = await databaseService.query(
      'SELECT * FROM policies WHERE project_id = ? OR project_id IS NULL ORDER BY created_at',
      [projectId],
    );
    return rows.map(rowToPolicy);
  }

  async findAll(limit = 1000): Promise<Policy[]> {
    const rows = await databaseService.query(
      'SELECT * FROM policies ORDER BY created_at LIMIT ?',
      [limit],
    );
    return rows.map(rowToPolicy);
  }

  async findById(id: string): Promise<Policy | null> {
    const rows = await databaseService.query('SELECT * FROM policies WHERE id = ?', [id]);
    return rows.length > 0 ? rowToPolicy(rows[0]) : null;
  }

  async insert(
    id: string, projectId: string | null, name: string, description: string | null,
    actionPattern: string, conditionExpr: object, enforcement: string, createdBy: string,
  ): Promise<Policy> {
    await databaseService.query(
      `INSERT INTO policies (id, project_id, name, description, action_pattern, condition_expr, enforcement, is_active, created_by)
       VALUES (?, ?, ?, ?, ?, ?, ?, 1, ?)`,
      [id, projectId, name, description, actionPattern, JSON.stringify(conditionExpr), enforcement, createdBy],
    );
    return (await this.findById(id))!;
  }

  async updateFields(id: string, sets: string[], params: any[]): Promise<void> {
    if (sets.length === 0) return;
    await databaseService.query(`UPDATE policies SET ${sets.join(', ')} WHERE id = ?`, [...params, id]);
  }

  async deleteById(id: string): Promise<boolean> {
    const result: any = await databaseService.query('DELETE FROM policies WHERE id = ?', [id]);
    return (result.affectedRows ?? 0) > 0;
  }

  /** One check's log lines in one INSERT (was one per policy; 2026-10-09) */
  async logEvaluations(rows: Array<{
    policyId: string; action: string; actorId: string; entityType: string | null;
    entityId: string | null; matched: boolean; enforcementResult: string; contextSnapshot: object;
  }>): Promise<void> {
    if (rows.length === 0) return;
    await databaseService.query(
      `INSERT INTO policy_evaluations
        (policy_id, action, actor_id, entity_type, entity_id, matched, enforcement_result, context_snapshot)
       VALUES ${rows.map(() => '(?, ?, ?, ?, ?, ?, ?, ?)').join(', ')}`,
      rows.flatMap(r => [r.policyId, r.action, r.actorId, r.entityType, r.entityId, r.matched ? 1 : 0, r.enforcementResult, JSON.stringify(r.contextSnapshot)]),
    );
  }

  async getEvaluationStats(projectId?: string, since?: string): Promise<{
    total: number; allowed: number; blocked: number; pendingApproval: number;
  }> {
    let sql = `SELECT
      COUNT(*) as total,
      SUM(CASE WHEN enforcement_result = 'allowed' THEN 1 ELSE 0 END) as allowed,
      SUM(CASE WHEN enforcement_result = 'blocked' THEN 1 ELSE 0 END) as blocked,
      SUM(CASE WHEN enforcement_result = 'pending_approval' THEN 1 ELSE 0 END) as pending_approval
    FROM policy_evaluations pe`;
    const conditions: string[] = [];
    const params: any[] = [];
    if (projectId) {
      conditions.push('pe.policy_id IN (SELECT id FROM policies WHERE project_id = ? OR project_id IS NULL)');
      params.push(projectId);
    }
    if (since) { conditions.push('pe.created_at >= ?'); params.push(since); }
    if (conditions.length > 0) sql += ' WHERE ' + conditions.join(' AND ');
    const rows = await databaseService.query<any>(sql, params);
    return {
      total: Number(rows[0].total) || 0, allowed: Number(rows[0].allowed) || 0,
      blocked: Number(rows[0].blocked) || 0, pendingApproval: Number(rows[0].pending_approval) || 0,
    };
  }
}

export const policyRepository = new PolicyRepository();
