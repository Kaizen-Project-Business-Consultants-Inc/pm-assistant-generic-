import { databaseService } from './connection';

class AIUsageLogRepository {
  insert(
    id: string, userId: string | null, feature: string, model: string,
    inputTokens: number, outputTokens: number, costEstimate: number,
    latencyMs: number, success: boolean, errorMessage: string | null,
    requestContext: string | null,
  ): Promise<any> {
    return databaseService.queryControlPlane(
      `INSERT INTO ai_usage_log (id, user_id, feature, model, input_tokens, output_tokens, cost_estimate, latency_ms, success, error_message, request_context)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [id, userId, feature, model, inputTokens, outputTokens, costEstimate, latencyMs, success, errorMessage, requestContext],
    );
  }

  /** This month's usage for every company (companies with none show zeros) */
  companyUsageThisMonth(): Promise<any[]> {
    return databaseService.queryControlPlane(
      `SELECT o.id, o.name, o.subscription_tier AS tier, o.billing_model, o.seat_count, o.ai_allowance_override AS override_tokens,
              COALESCE(SUM(a.input_tokens + a.output_tokens), 0) AS tokens, COALESCE(SUM(a.cost_estimate), 0) AS cost,
              COALESCE(SUM(CASE WHEN u.is_active = 1 THEN a.input_tokens + a.output_tokens ELSE 0 END), 0) AS pool_tokens,
              COUNT(a.id) AS calls, MAX(a.created_at) AS last_call
       FROM organizations o
       LEFT JOIN users u ON u.organization_id = o.id
       LEFT JOIN ai_usage_log a ON a.user_id = u.id AND a.created_at >= DATE_FORMAT(NOW(), '%Y-%m-01')
       GROUP BY o.id ORDER BY cost DESC`,
    );
  }

  /** This month's usage that belongs to no company: background jobs, wiped accounts, Kovarti's own login */
  unattributedUsageThisMonth(): Promise<any[]> {
    return databaseService.queryControlPlane(
      `SELECT CASE WHEN a.user_id IS NULL THEN 'background' WHEN u.id IS NULL THEN 'removed' ELSE 'no_company' END AS bucket,
              COALESCE(SUM(a.input_tokens + a.output_tokens), 0) AS tokens, COALESCE(SUM(a.cost_estimate), 0) AS cost,
              COUNT(*) AS calls, MAX(a.created_at) AS last_call
       FROM ai_usage_log a LEFT JOIN users u ON u.id = a.user_id
       WHERE a.created_at >= DATE_FORMAT(NOW(), '%Y-%m-01') AND (a.user_id IS NULL OR u.id IS NULL OR u.organization_id IS NULL)
       GROUP BY bucket`,
    );
  }

  /** This month's spend per feature, biggest first */
  featureSpendThisMonth(limit = 8): Promise<any[]> {
    return databaseService.queryControlPlane(
      `SELECT feature, SUM(cost_estimate) AS cost, COUNT(*) AS calls
       FROM ai_usage_log WHERE created_at >= DATE_FORMAT(NOW(), '%Y-%m-01')
       GROUP BY feature ORDER BY cost DESC LIMIT ${Math.max(1, Math.min(50, Math.trunc(limit)))}`,
    );
  }

  /** Spend so far today, and a normal day (the average of the 14 days before), per feature or per company */
  async spendTodayVsNormal(by: 'feature' | 'company'): Promise<Array<{ key: string; label: string; today: number; normal: number }>> {
    const from = by === 'feature'
      ? 'ai_usage_log a'
      : 'ai_usage_log a LEFT JOIN users u ON u.id = a.user_id LEFT JOIN organizations o ON o.id = u.organization_id';
    // a company is told apart by its id (two can share a name); its name is only for showing
    const key = by === 'feature' ? 'a.feature' : "COALESCE(o.id, '(no company)')";
    const label = by === 'feature' ? 'a.feature' : "COALESCE(MAX(o.name), '(no company)')";
    const [today, before] = await Promise.all([
      databaseService.queryControlPlane<any>(`SELECT ${key} AS k, ${label} AS label, SUM(a.cost_estimate) AS v FROM ${from} WHERE a.created_at >= CURDATE() GROUP BY k`),
      databaseService.queryControlPlane<any>(`SELECT ${key} AS k, SUM(a.cost_estimate) / 14 AS v FROM ${from} WHERE a.created_at >= DATE_SUB(CURDATE(), INTERVAL 14 DAY) AND a.created_at < CURDATE() GROUP BY k`),
    ]);
    const normal = new Map<string, number>(before.map((r: any) => [String(r.k), Number(r.v)]));
    return today.map((r: any) => ({ key: String(r.k), label: String(r.label), today: Number(r.v), normal: normal.get(String(r.k)) ?? 0 }));
  }

  /** Who spent the most on one feature today (for the alert: where to look) */
  async topCallerToday(feature: string): Promise<string | null> {
    const rows = await databaseService.queryControlPlane<any>(
      `SELECT COALESCE(u.email, 'a background job') AS who, SUM(a.cost_estimate) AS v
       FROM ai_usage_log a LEFT JOIN users u ON u.id = a.user_id
       WHERE a.feature = ? AND a.created_at >= CURDATE() GROUP BY who ORDER BY v DESC LIMIT 1`,
      [feature],
    );
    return rows.length ? String(rows[0].who) : null;
  }
}

export const aiUsageLogRepository = new AIUsageLogRepository();
