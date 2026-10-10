import { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import { authMiddleware } from '../../middleware/auth';
import { requireScope } from '../../middleware/requireScope';
import { agentCostTracker } from '../../services/agents/AgentCostTracker';
import { actionProposalService } from '../../services/agents/ActionProposalService';
import { claudeService } from '../../services/claudeService';
import { degradationHandler } from '../../services/agents/DegradationHandler';
import { killSwitchService } from '../../services/agents/KillSwitchService';
import logger from '../../utils/logger';

export async function agentHealthRoutes(fastify: FastifyInstance) {
  fastify.addHook('preHandler', authMiddleware);

  // Agent system health
  fastify.get('/health', {
    preHandler: [requireScope('read')],
    schema: { description: 'Get agent system health status', tags: ['agent'] },
  }, async (request: FastifyRequest, reply: FastifyReply) => {
    try {
      const [dailyCost, pendingProposals, healthStatus] = await Promise.all([
        agentCostTracker.getDailyCost(),
        actionProposalService.list({ status: 'pending', limit: 0 }),
        degradationHandler.getHealthStatus(),
      ]);

      // on/off and which agents are stopped; the stopped projects (other companies') are the admin's
      const { globalEnabled, disabledAgents } = await killSwitchService.getStatus();
      const killSwitch = { globalEnabled, disabledAgents };

      return {
        status: healthStatus.claudeAvailable && healthStatus.databaseHealthy && killSwitch.globalEnabled
          ? 'healthy'
          : 'degraded',
        claudeApiStatus: healthStatus.claudeAvailable ? 'available' : 'unavailable',
        userFacingCircuitBreaker: claudeService.getCircuitBreakerStatus(),
        databaseStatus: {
          healthy: healthStatus.databaseHealthy,
          latencyMs: healthStatus.databaseLatencyMs,
        },
        circuitBreakers: healthStatus.circuitBreakers,
        killSwitch,
        recommendedScanScope: healthStatus.recommendedScope,
        costs: {
          today: {
            tokens: dailyCost.totalTokens,
            estimatedUsd: dailyCost.estimatedCostUsd,
            invocations: dailyCost.entries,
          },
        },
        pendingProposals: pendingProposals.total,
      };
    } catch (error) {
      logger.error('Agent health check error', { error });
      return reply.status(500).send({ error: 'Failed to get agent health status' });
    }
  });

  // Agent cost breakdown
  fastify.get('/costs', {
    preHandler: [requireScope('read')],
    schema: { description: 'Get agent cost breakdown', tags: ['agent'] },
  }, async (request: FastifyRequest, reply: FastifyReply) => {
    try {
      const query = request.query as { since?: string; until?: string };
      const byAgent = await agentCostTracker.getCostsByAgent(query.since, query.until);
      const dailyCost = await agentCostTracker.getDailyCost();

      return {
        daily: dailyCost,
        byAgent,
      };
    } catch (error) {
      logger.error('Agent costs error', { error });
      return reply.status(500).send({ error: 'Failed to get agent costs' });
    }
  });
}
