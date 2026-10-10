import { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import { requireProjectAccess } from '../../middleware/requireProjectAccess';
import { PredictiveIntelligenceService } from '../../services/predictiveIntelligence';
import { sCurveService } from '../../services/SCurveService';
import { scheduleService } from '../../services/ScheduleService';
import { baselineService } from '../../services/BaselineService';
import { databaseService } from '../../database/connection';
import { authMiddleware } from '../../middleware/auth';
import { requireScope } from '../../middleware/requireScope';
import { runHealthSnapshot } from '../../services/scheduling/healthSnapshotJob';
import { platformAdminOnly } from '../../utils/platformAdmin';
import { cachedAIResult, peekAIResult, type WithAITime } from '../../utils/aiResultCache';

/**
 * `?ai=0` (the AI Predictions tab opening): the AI answer already kept for this project if there
 * is one, else the rules-based answer — no AI call. The tab's "Ask AI" button, and API/MCP callers
 * (who ask on purpose), leave it off and get the AI's answer (audit 2026-10-10 M1).
 */
async function predictionFor<T extends { aiPowered: boolean }>(
  request: FastifyRequest,
  key: string,
  compute: (opts: { ai: boolean }) => Promise<T>,
): Promise<WithAITime<T>> {
  if ((request.query as { ai?: string } | undefined)?.ai === '0') {
    return (await peekAIResult<T>(key)) ?? compute({ ai: false });
  }
  return cachedAIResult(key, () => compute({ ai: true }));
}

export async function predictionRoutes(fastify: FastifyInstance) {
  fastify.addHook('preHandler', authMiddleware);

  const service = new PredictiveIntelligenceService(fastify);

  // GET /dashboard — Portfolio predictions
  fastify.get('/dashboard', {
    preHandler: [requireScope('read')],
  }, async (request: FastifyRequest, reply: FastifyReply) => {
    try {
      const userId = request.user!.userId;
      const userRole = request.user!.role;
      // ai=1: the Portfolio Intelligence panel (the only place the AI highlights are shown)
      const { refresh, ai } = request.query as { refresh?: string; ai?: string };
      const { predictions, aiPowered, generatedAt } = await service.getDashboardPredictions(userId, userRole, { refresh: refresh === '1', ai: ai === '1' });
      return reply.send({ data: predictions, aiPowered, generatedAt });
    } catch (err) {
      fastify.log.error({ err }, 'Dashboard predictions failed');
      return reply.status(500).send({ error: 'Failed to generate dashboard predictions' });
    }
  });

  // GET /project/:projectId/risks — Full risk assessment
  fastify.get('/project/:projectId/risks', {
    preHandler: [requireScope('read'), requireProjectAccess('viewer')],
  }, async (request: FastifyRequest, reply: FastifyReply) => {
    try {
      const { projectId } = request.params as { projectId: string };
      const userId = request.user!.userId;
      // the project's answer, reused for 30 minutes (it asked the AI on every visit)
      const { assessment, aiPowered, aiGeneratedAt } = await predictionFor(request, `risks:${projectId}`, (o) => service.assessProjectRisks(projectId, userId, o));
      return reply.send({ data: assessment, aiPowered, aiGeneratedAt });
    } catch (err) {
      fastify.log.error({ err }, 'Risk assessment failed');
      return reply.status(500).send({ error: 'Failed to generate risk assessment' });
    }
  });

  // GET /project/:projectId/weather — Weather impact analysis
  fastify.get('/project/:projectId/weather', {
    preHandler: [requireScope('read'), requireProjectAccess('viewer')],
  }, async (request: FastifyRequest, reply: FastifyReply) => {
    try {
      const { projectId } = request.params as { projectId: string };
      const userId = request.user!.userId;
      const { impact, aiPowered, aiGeneratedAt } = await predictionFor(request, `weather:${projectId}`, (o) => service.analyzeWeatherImpact(projectId, userId, o));
      return reply.send({ data: impact, aiPowered, aiGeneratedAt });
    } catch (err) {
      fastify.log.error({ err }, 'Weather impact analysis failed');
      return reply.status(500).send({ error: 'Failed to analyze weather impact' });
    }
  });

  // GET /project/:projectId/budget — Budget forecast with EVM
  fastify.get('/project/:projectId/budget', {
    preHandler: [requireScope('read'), requireProjectAccess('viewer')],
  }, async (request: FastifyRequest, reply: FastifyReply) => {
    try {
      const { projectId } = request.params as { projectId: string };
      const userId = request.user!.userId;
      const { forecast, aiPowered, aiGeneratedAt } = await predictionFor(request, `budget:${projectId}`, (o) => service.forecastBudget(projectId, userId, o));
      return reply.send({ data: forecast, aiPowered, aiGeneratedAt });
    } catch (err) {
      fastify.log.error({ err }, 'Budget forecast failed');
      return reply.status(500).send({ error: 'Failed to generate budget forecast' });
    }
  });

  // GET /project/:projectId/health — Composite health score
  fastify.get('/project/:projectId/health', {
    preHandler: [requireScope('read'), requireProjectAccess('viewer')],
  }, async (request: FastifyRequest, reply: FastifyReply) => {
    try {
      const { projectId } = request.params as { projectId: string };
      const userId = request.user!.userId;
      const result = await service.getProjectHealthScore(projectId, userId);
      return reply.send({ data: result });
    } catch (err) {
      fastify.log.error({ err }, 'Health score calculation failed');
      return reply.status(500).send({ error: 'Failed to calculate health score' });
    }
  });

  // GET /project/:projectId/evm/s-curve — S-Curve data
  fastify.get('/project/:projectId/evm/s-curve', {
    preHandler: [requireScope('read'), requireProjectAccess('viewer')],
  }, async (request: FastifyRequest, reply: FastifyReply) => {
    try {
      const { projectId } = request.params as { projectId: string };
      const data = await sCurveService.computeSCurveData(projectId);
      return reply.send({ data });
    } catch (err) {
      fastify.log.error({ err }, 'S-Curve computation failed');
      return reply.status(500).send({ error: 'Failed to compute S-Curve data' });
    }
  });

  // GET /project/:projectId/scope-creep — Scope creep indicators
  fastify.get('/project/:projectId/scope-creep', {
    preHandler: [requireScope('read'), requireProjectAccess('viewer')],
  }, async (request: FastifyRequest, reply: FastifyReply) => {
    try {
      const { projectId } = request.params as { projectId: string };
      const schedules = await scheduleService.findByProjectId(projectId);
      if (schedules.length === 0) {
        return reply.send({ indicators: null, baselineComparison: null, severity: 'low', hasBaseline: false, aiPowered: false });
      }

      // Find the first schedule with a baseline
      let comparison: any = null;
      let hasBaseline = false;
      for (const sched of schedules) {
        // eslint-disable-next-line no-await-in-loop -- a project's plans (a handful), stopping at the first with a baseline
        const baselines = await baselineService.findByScheduleId(sched.id);
        if (baselines.length > 0) {
          hasBaseline = true;
          // eslint-disable-next-line no-await-in-loop -- runs once, then the loop stops
          comparison = await baselineService.compareBaseline(baselines[baselines.length - 1].id);
          break;
        }
      }

      // Count current tasks across all schedules
      let currentTaskCount = 0;
      let totalEstimateDays = 0;
      for (const sched of schedules) {
        // eslint-disable-next-line no-await-in-loop -- small: a project's plans (a handful)
        const tasks = await scheduleService.findTasksByScheduleId(sched.id);
        currentTaskCount += tasks.length;
        totalEstimateDays += tasks.reduce((sum, t) => sum + (t.estimatedDays || 0), 0);
      }

      // Count open change requests
      const crRows = await databaseService.query(
        "SELECT COUNT(*) as cnt FROM change_requests WHERE project_id = ? AND status IN ('draft','pending')",
        [projectId]
      );
      const changeRequestCount = Number(crRows[0]?.cnt || 0);

      // Compute indicators
      const originalTaskCount = comparison?.summary?.totalTasks ?? currentTaskCount;
      const taskCountDelta = comparison ? (comparison.summary.newTasks || 0) : 0;
      const estimateIncreaseDays = comparison
        ? comparison.taskVariances.reduce((sum: number, v: any) => sum + Math.max(0, v.durationVarianceDays || 0), 0)
        : 0;

      // Determine severity
      let severity: 'low' | 'medium' | 'high' | 'critical' = 'low';
      if (taskCountDelta >= 10 || estimateIncreaseDays >= 20) severity = 'critical';
      else if (taskCountDelta >= 5 || estimateIncreaseDays >= 10) severity = 'high';
      else if (taskCountDelta >= 3 || estimateIncreaseDays >= 5 || changeRequestCount >= 2) severity = 'medium';

      return reply.send({
        indicators: { taskCountDelta, estimateIncreaseDays, changeRequestCount, originalTaskCount, currentTaskCount },
        baselineComparison: comparison ? { summary: comparison.summary, taskVariances: comparison.taskVariances } : null,
        severity,
        hasBaseline,
        aiPowered: false,
      });
    } catch (err) {
      fastify.log.error({ err }, 'Scope creep detection failed');
      return reply.status(500).send({ error: 'Failed to detect scope creep' });
    }
  });

  // GET /project/:projectId/task-slips — Task slip predictions
  fastify.get('/project/:projectId/task-slips', {
    preHandler: [requireScope('read'), requireProjectAccess('viewer')],
  }, async (request: FastifyRequest, reply: FastifyReply) => {
    try {
      const { projectId } = request.params as { projectId: string };
      const result = await service.predictTaskSlips(projectId);
      return reply.send(result);
    } catch (err) {
      fastify.log.error({ err }, 'Task slip prediction failed');
      return reply.status(500).send({ error: 'Failed to predict task slips' });
    }
  });

  // GET /project/:projectId/health/history — Health score history for sparklines
  fastify.get('/project/:projectId/health/history', {
    preHandler: [requireScope('read'), requireProjectAccess('viewer')],
  }, async (request: FastifyRequest, reply: FastifyReply) => {
    try {
      const { projectId } = request.params as { projectId: string };
      const { days } = request.query as { days?: string };
      const limit = Math.min(parseInt(days || '30', 10) || 30, 90);
      const rows = await databaseService.query(
        `SELECT health_score AS healthScore, risk_level AS riskLevel,
                schedule_health AS scheduleHealth, budget_health AS budgetHealth,
                risk_health AS riskHealth, recorded_at AS recordedAt
         FROM project_health_history
         WHERE project_id = ? AND recorded_at >= DATE_SUB(NOW(), INTERVAL ? DAY)
         ORDER BY recorded_at ASC`,
        [projectId, limit]
      );
      return reply.send({ data: rows });
    } catch (err) {
      fastify.log.error({ err }, 'Health history query failed');
      return reply.send({ data: [] });
    }
  });

  // POST /health/snapshot — Manual trigger for health snapshot (admin only)
  fastify.post('/health/snapshot', {
    preHandler: [requireScope('admin'), platformAdminOnly],
  }, async (_request: FastifyRequest, reply: FastifyReply) => {
    try {
      const count = await runHealthSnapshot();
      return reply.send({ message: `Recorded health scores for ${count} projects` });
    } catch (err) {
      fastify.log.error({ err }, 'Manual health snapshot failed');
      return reply.status(500).send({ error: 'Failed to run health snapshot' });
    }
  });
}
