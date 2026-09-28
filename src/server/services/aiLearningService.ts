import { randomUUID } from 'crypto';
import { claudeService, PromptTemplate } from './claudeService';
import { logAIUsage } from './aiUsageLogger';
import { databaseService } from '../database/connection';
import logger from '../utils/logger';
import type {
  AIFeedbackRecord,
  AIAccuracyRecord,
  AIAccuracyReport,
} from '../schemas/phase5Schemas';

// ---------------------------------------------------------------------------
// Prompt Template
// ---------------------------------------------------------------------------

const accuracyInsightsPrompt = new PromptTemplate(
  `You are an AI performance analyst for a project management system. Analyze the accuracy report below and provide actionable improvement suggestions.

Accuracy Report:
{{accuracyReport}}

Provide 3-5 specific, actionable improvement suggestions based on the data. Focus on:
- Which prediction types are least accurate and why
- Patterns in over/under-estimation
- How to calibrate future predictions

Return a JSON object with: { "improvements": ["suggestion1", "suggestion2", ...] }`,
  '1.0.0',
);

// ---------------------------------------------------------------------------
// AILearningServiceV2
// ---------------------------------------------------------------------------

export class AILearningServiceV2 {
  constructor() {}

  // -------------------------------------------------------------------------
  // Record Feedback (fire-and-forget)
  // -------------------------------------------------------------------------

  recordFeedback(feedback: AIFeedbackRecord, userId: string): void {
    const id = randomUUID();
    databaseService.query(
      `INSERT INTO ai_feedback (id, user_id, project_id, feature, suggestion_data, user_action, modified_data, feedback_text)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        id,
        userId,
        feedback.projectId || null,
        feedback.feature,
        feedback.suggestionData ? JSON.stringify(feedback.suggestionData) : null,
        feedback.userAction,
        feedback.modifiedData ? JSON.stringify(feedback.modifiedData) : null,
        feedback.feedbackText || null,
      ],
    ).catch((err: Error) => {
      logger.warn(`Failed to record AI feedback (non-critical): ${err.message}`);
    });
  }

  // -------------------------------------------------------------------------
  // Record Accuracy (fire-and-forget)
  // -------------------------------------------------------------------------

  recordAccuracy(record: AIAccuracyRecord): void {
    const id = randomUUID();
    const variancePct = record.actualValue !== 0
      ? parseFloat((((record.predictedValue - record.actualValue) / record.actualValue) * 100).toFixed(2))
      : 0;

    databaseService.query(
      `INSERT INTO ai_accuracy_tracking (id, project_id, task_id, metric_type, predicted_value, actual_value, variance_pct, project_type)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        id,
        record.projectId,
        record.taskId || null,
        record.metricType,
        record.predictedValue,
        record.actualValue,
        variancePct,
        record.projectType || null,
      ],
    ).catch((err: Error) => {
      logger.warn(`Failed to record AI accuracy (non-critical): ${err.message}`);
    });
  }

  // -------------------------------------------------------------------------
  // Feedback Stats
  // -------------------------------------------------------------------------

  async getFeedbackStats(feature?: string): Promise<{
    total: number;
    accepted: number;
    modified: number;
    rejected: number;
    acceptanceRate: number;
  }> {
    const whereClause = feature ? 'WHERE feature = ?' : '';
    const params = feature ? [feature] : [];

    const rows = await databaseService.query(
      `SELECT user_action, COUNT(*) as cnt
       FROM ai_feedback
       ${whereClause}
       GROUP BY user_action`,
      params,
    );

    let accepted = 0, modified = 0, rejected = 0;
    for (const r of rows) {
      if (r.user_action === 'accepted') accepted = parseInt(r.cnt);
      else if (r.user_action === 'modified') modified = parseInt(r.cnt);
      else if (r.user_action === 'rejected') rejected = parseInt(r.cnt);
    }
    const total = accepted + modified + rejected;
    const acceptanceRate = total > 0 ? parseFloat(((accepted / total) * 100).toFixed(1)) : 0;

    return { total, accepted, modified, rejected, acceptanceRate };
  }

  // -------------------------------------------------------------------------
  // Accuracy Report
  // -------------------------------------------------------------------------

  async getAccuracyReport(filters?: {
    projectType?: string;
  }): Promise<AIAccuracyReport> {
    const emptyReport: AIAccuracyReport = {
      overall: { totalRecords: 0, averageVariance: 0, accuracy: 0 },
      byMetric: [],
      byProjectType: [],
      feedbackSummary: { total: 0, accepted: 0, modified: 0, rejected: 0, acceptanceRate: 0 },
      improvements: [],
    };

    const conditions: string[] = ['1=1'];
    const params: any[] = [];
    if (filters?.projectType) { conditions.push('project_type = ?'); params.push(filters.projectType); }

    const where = conditions.join(' AND ');

    // Overall
    const overallRows = await databaseService.query(
      `SELECT COUNT(*) as total, AVG(ABS(variance_pct)) as avg_var FROM ai_accuracy_tracking WHERE ${where}`,
      params,
    );
    const totalRecords = parseInt((overallRows as any[])[0]?.total) || 0;
    const averageVariance = parseFloat((overallRows as any[])[0]?.avg_var) || 0;
    const accuracy = Math.max(0, Math.min(100, parseFloat((100 - averageVariance).toFixed(1))));

    // By metric
    const metricRows = await databaseService.query(
      `SELECT metric_type, COUNT(*) as cnt, AVG(ABS(variance_pct)) as avg_var
       FROM ai_accuracy_tracking WHERE ${where} GROUP BY metric_type`,
      params,
    );
    const byMetric = (metricRows as any[]).map((r: any) => ({
      metricType: r.metric_type,
      count: parseInt(r.cnt),
      averageVariance: parseFloat(parseFloat(r.avg_var).toFixed(1)),
      accuracy: Math.max(0, Math.min(100, parseFloat((100 - parseFloat(r.avg_var)).toFixed(1)))),
    }));

    // By project type
    const typeRows = await databaseService.query(
      `SELECT project_type, COUNT(*) as cnt, AVG(ABS(variance_pct)) as avg_var
       FROM ai_accuracy_tracking WHERE ${where} AND project_type IS NOT NULL GROUP BY project_type`,
      params,
    );
    const byProjectType = (typeRows as any[]).map((r: any) => ({
      projectType: r.project_type,
      count: parseInt(r.cnt),
      averageVariance: parseFloat(parseFloat(r.avg_var).toFixed(1)),
      accuracy: Math.max(0, Math.min(100, parseFloat((100 - parseFloat(r.avg_var)).toFixed(1)))),
    }));

    // Feedback summary
    const feedbackSummary = await this.getFeedbackStats();

    // Deterministic improvements
    const improvements: string[] = [];
    for (const m of byMetric) {
      if (m.accuracy < 80) {
        improvements.push(`${m.metricType} predictions have ${m.accuracy}% accuracy — consider recalibrating this model.`);
      }
    }
    if (feedbackSummary.acceptanceRate < 60 && feedbackSummary.total > 5) {
      improvements.push(`AI suggestion acceptance rate is only ${feedbackSummary.acceptanceRate}% — review suggestion quality.`);
    }
    if (improvements.length === 0 && totalRecords > 0) {
      improvements.push('All prediction metrics are within acceptable accuracy ranges.');
    }

    return {
      overall: { totalRecords, averageVariance, accuracy },
      byMetric,
      byProjectType,
      feedbackSummary,
      improvements,
    };
  }

  // -------------------------------------------------------------------------
  // Build Learning Context (for prompt injection)
  // -------------------------------------------------------------------------

  async buildLearningContext(projectType?: string): Promise<string> {
    try {
      const conditions: string[] = ['recorded_at > DATE_SUB(NOW(), INTERVAL 90 DAY)'];
      const params: any[] = [];
      if (projectType) { conditions.push('project_type = ?'); params.push(projectType); }
      const where = conditions.join(' AND ');

      const rows = await databaseService.query(
        `SELECT metric_type, AVG(ABS(variance_pct)) as avg_var, COUNT(*) as cnt
         FROM ai_accuracy_tracking WHERE ${where} GROUP BY metric_type`,
        params,
      );

      if ((rows as any[]).length === 0) return '';

      let context = '\n\n### Historical AI Accuracy Context (last 90 days)\n';
      for (const r of rows as any[]) {
        const acc = Math.max(0, 100 - parseFloat(r.avg_var));
        context += `- ${r.metric_type}: ${acc.toFixed(1)}% accurate (${r.cnt} samples, avg variance ${parseFloat(r.avg_var).toFixed(1)}%)\n`;
      }

      // Feedback adjustment patterns
      const feedbackRows = await databaseService.query(
        `SELECT feature, user_action, COUNT(*) as cnt
         FROM ai_feedback
         WHERE created_at > DATE_SUB(NOW(), INTERVAL 90 DAY)
         GROUP BY feature, user_action`,
        [],
      );

      if ((feedbackRows as any[]).length > 0) {
        const featureStats = new Map<string, { accepted: number; modified: number; rejected: number }>();
        for (const r of feedbackRows as any[]) {
          if (!featureStats.has(r.feature)) {
            featureStats.set(r.feature, { accepted: 0, modified: 0, rejected: 0 });
          }
          const stats = featureStats.get(r.feature)!;
          stats[r.user_action as 'accepted' | 'modified' | 'rejected'] = parseInt(r.cnt);
        }

        context += '\n### User Feedback Patterns\n';
        for (const [feature, stats] of featureStats) {
          const total = stats.accepted + stats.modified + stats.rejected;
          if (total > 0) {
            context += `- ${feature}: ${((stats.accepted / total) * 100).toFixed(0)}% accepted, ${((stats.rejected / total) * 100).toFixed(0)}% rejected (${total} reviews)\n`;
          }
        }
        context += '\nAdjust predictions based on historical accuracy data above. If a metric tends to over-estimate, bias slightly lower, and vice versa.\n';
      }

      return context;
    } catch (err) {
      logger.warn(`Failed to build learning context (non-critical): ${err instanceof Error ? err.message : String(err)}`);
      return '';
    }
  }

  // -------------------------------------------------------------------------
  // AI Accuracy Insights (Claude-enhanced)
  // -------------------------------------------------------------------------

  async getAIAccuracyInsights(
    userId?: string,
  ): Promise<{ insights: AIAccuracyReport; aiPowered: boolean }> {
    const report = await this.getAccuracyReport();

    if (!claudeService.isAvailable() || report.overall.totalRecords === 0) {
      return { insights: report, aiPowered: false };
    }

    try {
      const reportStr = JSON.stringify(report, null, 2);
      const systemPrompt = accuracyInsightsPrompt.render({ accuracyReport: reportStr });

      const result = await claudeService.complete({
      feature: 'accuracy_insights',
      tier: 'light', // routine job: the cheaper model
        systemPrompt,
        userMessage: 'Analyze the accuracy report and return improvement suggestions JSON.',
        responseFormat: 'json',
        temperature: 0.3,
      });

      logAIUsage({
        userId,
        feature: 'accuracy_insights',
        model: 'claude',
        usage: result.usage,
        latencyMs: result.latencyMs,
        success: true,
      });

      const parsed = JSON.parse(result.content);
      if (Array.isArray(parsed.improvements)) {
        report.improvements = parsed.improvements;
      }
      return { insights: report, aiPowered: true };
    } catch (err) {
      logger.warn(`AI accuracy insights failed, using deterministic fallback: ${err instanceof Error ? err.message : String(err)}`);
      return { insights: report, aiPowered: false };
    }
  }
}
