import { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import { requireProjectAccess } from '../../middleware/requireProjectAccess';
import { monteCarloService } from '../../services/MonteCarloService';
import { MonteCarloConfigSchema } from '../../schemas/monteCarloSchemas';
import { authMiddleware } from '../../middleware/auth';
import { requireScope } from '../../middleware/requireScope';
import { userService } from '../../services/UserService';

export async function monteCarloRoutes(fastify: FastifyInstance) {
  fastify.addHook('preHandler', authMiddleware);

  // POST /:scheduleId/simulate — Run Monte Carlo simulation for a schedule
  // Trial users get sample results with an upgrade prompt.
  fastify.post('/:scheduleId/simulate', { preHandler: [requireScope('write'), requireProjectAccess('viewer')] }, async (
    request: FastifyRequest,
    reply: FastifyReply,
  ) => {
    try {
      const { scheduleId } = request.params as { scheduleId: string };

      // Trial users get sample simulation data
      if (request.user!.role !== 'admin') {
        const user = await userService.findById(request.user!.userId);
        if (user && user.subscriptionTier === 'trial') {
          return reply.send({ result: generateSampleResult(scheduleId), sample: true });
        }
      }

      // Parse optional config from body, applying defaults
      const rawBody = (request.body as Record<string, unknown>) || {};
      const config = MonteCarloConfigSchema.parse(rawBody);

      const result = await monteCarloService.runSimulation(scheduleId, config);
      return reply.send({ result });
    } catch (err: any) {
      if (err.name === 'ZodError') {
        return reply.status(400).send({ error: 'Invalid configuration', details: err.issues });
      }
      fastify.log.error({ err }, 'Monte Carlo simulation failed');
      return reply.status(500).send({ error: err.message || 'Failed to run Monte Carlo simulation' });
    }
  });
}

function generateSampleResult(scheduleId: string) {
  const today = new Date();
  const addDays = (d: Date, n: number) => new Date(d.getTime() + n * 86400000).toISOString().slice(0, 10);

  return {
    scheduleId,
    iterations: 10000,
    uncertaintyModel: 'PERT',
    confidenceLevels: [
      { percentile: 50, durationDays: 142, completionDate: addDays(today, 142) },
      { percentile: 80, durationDays: 158, completionDate: addDays(today, 158) },
      { percentile: 90, durationDays: 168, completionDate: addDays(today, 168) },
    ],
    histogram: [
      { min: 110, max: 118, count: 320, cumulativePercent: 3.2 },
      { min: 118, max: 126, count: 780, cumulativePercent: 11.0 },
      { min: 126, max: 134, count: 1450, cumulativePercent: 25.5 },
      { min: 134, max: 142, count: 2480, cumulativePercent: 50.3 },
      { min: 142, max: 150, count: 2100, cumulativePercent: 71.3 },
      { min: 150, max: 158, count: 1350, cumulativePercent: 84.8 },
      { min: 158, max: 166, count: 850, cumulativePercent: 93.3 },
      { min: 166, max: 174, count: 420, cumulativePercent: 97.5 },
      { min: 174, max: 182, count: 180, cumulativePercent: 99.3 },
      { min: 182, max: 190, count: 70, cumulativePercent: 100.0 },
    ],
    statistics: {
      mean: 143.5, standardDeviation: 14.2, min: 112, max: 188, p50: 142, p80: 158, p90: 168,
    },
    sensitivityAnalysis: [
      { taskId: 's1', taskName: 'Requirements Analysis', correlationCoefficient: 0.82, rank: 1 },
      { taskId: 's2', taskName: 'System Integration Testing', correlationCoefficient: 0.71, rank: 2 },
      { taskId: 's3', taskName: 'Data Migration', correlationCoefficient: 0.65, rank: 3 },
      { taskId: 's4', taskName: 'UAT & Pilot', correlationCoefficient: 0.58, rank: 4 },
      { taskId: 's5', taskName: 'Infrastructure Setup', correlationCoefficient: 0.43, rank: 5 },
    ],
    criticalityIndex: [
      { taskId: 's1', taskName: 'Requirements Analysis', criticalityPercent: 94 },
      { taskId: 's2', taskName: 'System Integration Testing', criticalityPercent: 87 },
      { taskId: 's3', taskName: 'Data Migration', criticalityPercent: 72 },
      { taskId: 's4', taskName: 'UAT & Pilot', criticalityPercent: 68 },
      { taskId: 's5', taskName: 'Infrastructure Setup', criticalityPercent: 45 },
    ],
    costForecast: {
      p50: 485000, p80: 538000, p90: 572000, mean: 490000, standardDeviation: 42000,
    },
  };
}
