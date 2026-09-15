import { databaseService } from './connection';

class AgentCostRepository {
  async insert(
    id: string, agentId: string, projectId: string | null, scanId: string | null,
    inputTokens: number, outputTokens: number, totalTokens: number,
    estimatedCostUsd: number, model: string | null, latencyMs: number | null,
  ): Promise<void> {
    await databaseService.query(
      `INSERT INTO agent_cost_ledger (id, agent_id, project_id, scan_id, input_tokens, output_tokens, total_tokens, estimated_cost_usd, model, latency_ms, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, NOW())`,
      [id, agentId, projectId, scanId, inputTokens, outputTokens, totalTokens, estimatedCostUsd, model, latencyMs],
    );
  }

  async getDailySummary(date: string): Promise<{ total_tokens: number; total_cost: number; cnt: number }> {
    const rows = await databaseService.query<{ total_tokens: number; total_cost: number; cnt: number }>(
      `SELECT COALESCE(SUM(total_tokens), 0) AS total_tokens,
              COALESCE(SUM(estimated_cost_usd), 0) AS total_cost,
              COUNT(*) AS cnt
       FROM agent_cost_ledger WHERE DATE(created_at) = ?`,
      [date],
    );
    return rows[0];
  }

  async getProjectDailySummary(projectId: string, date: string): Promise<{ total_tokens: number; total_cost: number; cnt: number }> {
    const rows = await databaseService.query<{ total_tokens: number; total_cost: number; cnt: number }>(
      `SELECT COALESCE(SUM(total_tokens), 0) AS total_tokens,
              COALESCE(SUM(estimated_cost_usd), 0) AS total_cost,
              COUNT(*) AS cnt
       FROM agent_cost_ledger WHERE project_id = ? AND DATE(created_at) = ?`,
      [projectId, date],
    );
    return rows[0];
  }

  async getCostsByAgent(since?: string, until?: string): Promise<Array<{ agent_id: string; input_tokens: number; output_tokens: number; total_tokens: number; total_cost: number; invocations: number }>> {
    let sql = `SELECT agent_id, SUM(input_tokens) AS input_tokens, SUM(output_tokens) AS output_tokens, SUM(total_tokens) AS total_tokens, SUM(estimated_cost_usd) AS total_cost, COUNT(*) AS invocations
               FROM agent_cost_ledger WHERE 1=1`;
    const params: unknown[] = [];
    if (since) { sql += ' AND created_at >= ?'; params.push(since); }
    if (until) { sql += ' AND created_at <= ?'; params.push(until); }
    sql += ' GROUP BY agent_id ORDER BY total_cost DESC';
    return databaseService.query(sql, params);
  }
}

export const agentCostRepository = new AgentCostRepository();
