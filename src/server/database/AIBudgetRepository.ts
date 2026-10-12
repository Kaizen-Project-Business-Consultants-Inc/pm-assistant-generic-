import { databaseService } from './connection';

class AIBudgetRepository {
  async getMonthlyUsage(userId: string): Promise<{ total_input: number; total_output: number; total_cost: number; request_count: number }> {
    const rows = await databaseService.queryControlPlane<any>(
      `SELECT
         COALESCE(SUM(input_tokens), 0) AS total_input,
         COALESCE(SUM(output_tokens), 0) AS total_output,
         COALESCE(SUM(cost_estimate), 0) AS total_cost,
         COUNT(*) AS request_count
       FROM ai_usage_log
       WHERE user_id = ?
         AND created_at >= DATE_FORMAT(NOW(), '%Y-%m-01')`,
      [userId],
    );
    return rows[0];
  }

  async getOrgMonthlyUsage(userIds: string[]): Promise<{ total_input: number; total_output: number; total_cost: number; request_count: number }> {
    if (userIds.length === 0) {
      return { total_input: 0, total_output: 0, total_cost: 0, request_count: 0 };
    }
    const placeholders = userIds.map(() => '?').join(',');
    const rows = await databaseService.queryControlPlane<any>(
      `SELECT
         COALESCE(SUM(input_tokens), 0) AS total_input,
         COALESCE(SUM(output_tokens), 0) AS total_output,
         COALESCE(SUM(cost_estimate), 0) AS total_cost,
         COUNT(*) AS request_count
       FROM ai_usage_log
       WHERE user_id IN (${placeholders})
         AND created_at >= DATE_FORMAT(NOW(), '%Y-%m-01')`,
      userIds,
    );
    return rows[0];
  }

  async getUserBudget(userId: string): Promise<number | null> {
    const rows = await databaseService.queryControlPlane<{ ai_monthly_token_budget: number | null }>(
      'SELECT ai_monthly_token_budget FROM users WHERE id = ?',
      [userId],
    );
    if (rows.length > 0 && rows[0].ai_monthly_token_budget != null) {
      return Number(rows[0].ai_monthly_token_budget);
    }
    return null;
  }

  async getUserTier(userId: string): Promise<string> {
    const rows = await databaseService.queryControlPlane<{ subscription_tier: string }>(
      'SELECT subscription_tier FROM users WHERE id = ?',
      [userId],
    );
    return rows.length > 0 ? (rows[0].subscription_tier || 'trial') : 'trial';
  }

  /** Who is asking, for the AI plan check: their app role and their own plan */
  async getUserRoleAndTier(userId: string): Promise<{ role: string; tier: string; status: string; trialEndsAt: string | null } | null> {
    const rows = await databaseService.queryControlPlane<{ role: string; subscription_tier: string | null; subscription_status: string | null; trial_ends_at: string | null }>(
      'SELECT role, subscription_tier, subscription_status, trial_ends_at FROM users WHERE id = ?',
      [userId],
    );
    if (rows.length === 0) return null;
    const r = rows[0];
    return { role: r.role, tier: r.subscription_tier || 'trial', status: r.subscription_status || 'none', trialEndsAt: r.trial_ends_at };
  }

  async findBudgetWarningToday(userId: string, today: string): Promise<boolean> {
    const rows = await databaseService.queryControlPlane<{ id: string }>(
      `SELECT id FROM notifications
       WHERE user_id = ? AND type = 'ai_budget_warning' AND DATE(created_at) = ?
       LIMIT 1`,
      [userId, today],
    );
    return rows.length > 0;
  }
}

export const aiBudgetRepository = new AIBudgetRepository();
