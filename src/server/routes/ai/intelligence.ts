import { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import { AnomalyDetectionService } from '../../services/anomalyDetectionService';
import { CrossProjectIntelligenceService } from '../../services/crossProjectIntelligenceService';
import { WhatIfScenarioService } from '../../services/whatIfScenarioService';
import { AIScenarioRequestSchema } from '../../schemas/phase5Schemas';
import { authMiddleware } from '../../middleware/auth';
import { requireScope } from '../../middleware/requireScope';
import { requireFeature } from '../../middleware/requireTier';
import { userService } from '../../services/UserService';

export async function intelligenceRoutes(fastify: FastifyInstance) {
  fastify.addHook('preHandler', authMiddleware);

  const anomalyService = new AnomalyDetectionService(fastify);
  const crossProjectService = new CrossProjectIntelligenceService(fastify);
  const scenarioService = new WhatIfScenarioService(fastify);

  // Helper: check if request user is on trial tier
  async function isTrialUser(request: FastifyRequest): Promise<boolean> {
    if (request.user!.role === 'admin') return false;
    const user = await userService.findById(request.user!.userId);
    return !!(user && user.subscriptionTier === 'trial');
  }

  // Anomaly Detection
  // Trial users get sample data with an upgrade prompt.
  fastify.get('/anomalies', {
    preHandler: [requireScope('read')],
  }, async (request: FastifyRequest, reply: FastifyReply) => {
    try {
      if (await isTrialUser(request)) {
        return reply.send({ data: generateSampleAnomalies(), aiPowered: false, sample: true });
      }
      const userId = request.user!.userId;
      const report = await anomalyService.detectPortfolioAnomalies(userId);
      return reply.send({ data: report, aiPowered: report.aiPowered });
    } catch (err) {
      fastify.log.error({ err }, 'Portfolio anomaly detection failed');
      return reply.status(500).send({ error: 'Failed to detect anomalies' });
    }
  });

  fastify.get('/anomalies/project/:projectId', {
    preHandler: [requireScope('read')],
  }, async (request: FastifyRequest, reply: FastifyReply) => {
    try {
      if (await isTrialUser(request)) {
        return reply.send({ data: generateSampleAnomalies(), aiPowered: false, sample: true });
      }
      const { projectId } = request.params as { projectId: string };
      const userId = request.user!.userId;
      const report = await anomalyService.detectProjectAnomalies(projectId, userId);
      return reply.send({ data: report, aiPowered: report.aiPowered });
    } catch (err) {
      fastify.log.error({ err }, 'Project anomaly detection failed');
      return reply.status(500).send({ error: 'Failed to detect project anomalies' });
    }
  });

  // Cross-Project Intelligence
  // Trial users get sample data with an upgrade prompt.
  fastify.get('/cross-project', {
    preHandler: [requireScope('read')],
  }, async (request: FastifyRequest, reply: FastifyReply) => {
    try {
      if (await isTrialUser(request)) {
        return reply.send({ data: generateSampleCrossProject(), aiPowered: false, sample: true });
      }
      const userId = request.user!.userId;
      const { insight, aiPowered } = await crossProjectService.analyzePortfolio(userId);
      return reply.send({ data: insight, aiPowered });
    } catch (err) {
      fastify.log.error({ err }, 'Cross-project analysis failed');
      return reply.status(500).send({ error: 'Failed to analyze cross-project intelligence' });
    }
  });

  fastify.get('/cross-project/similar/:projectId', {
    preHandler: [requireScope('read')],
  }, async (request: FastifyRequest, reply: FastifyReply) => {
    try {
      if (await isTrialUser(request)) {
        return reply.send({ data: [], aiPowered: false, sample: true });
      }
      const { projectId } = request.params as { projectId: string };
      const userId = request.user!.userId;
      const { similar, aiPowered } = await crossProjectService.findSimilarProjects(projectId, userId);
      return reply.send({ data: similar, aiPowered });
    } catch (err) {
      fastify.log.error({ err }, 'Similar projects search failed');
      return reply.status(500).send({ error: 'Failed to find similar projects' });
    }
  });

  // What-If Scenarios — run scenario
  fastify.post('/scenarios', {
    preHandler: [requireScope('write'), requireFeature('cross_project_intelligence')],
  }, async (request: FastifyRequest, reply: FastifyReply) => {
    try {
      // #10: Trial users get sample data
      if (await isTrialUser(request)) {
        return reply.send({ data: generateSampleScenarioResult(), aiPowered: false, sample: true, id: 'sample' });
      }
      const parsed = AIScenarioRequestSchema.parse(request.body);
      const userId = request.user!.userId;
      const { result, aiPowered, id } = await scenarioService.modelScenario(parsed, userId);
      return reply.send({ data: result, aiPowered, id });
    } catch (err) {
      if (err instanceof Error && err.name === 'ZodError') {
        return reply.status(400).send({ error: 'Invalid scenario request data' });
      }
      fastify.log.error({ err }, 'Scenario modeling failed');
      return reply.status(500).send({ error: 'Failed to model scenario' });
    }
  });

  // What-If Scenarios — get history for a project
  fastify.get('/scenarios/history/:projectId', {
    preHandler: [requireScope('read'), requireFeature('cross_project_intelligence')],
  }, async (request: FastifyRequest, reply: FastifyReply) => {
    try {
      const { projectId } = request.params as { projectId: string };
      const scenarios = await scenarioService.getHistory(projectId);
      return reply.send({ scenarios });
    } catch (err) {
      fastify.log.error({ err }, 'Failed to get scenario history');
      return reply.status(500).send({ error: 'Failed to get scenario history' });
    }
  });

  // What-If Scenarios — delete a saved scenario
  fastify.delete('/scenarios/:id', {
    preHandler: [requireScope('write'), requireFeature('cross_project_intelligence')],
  }, async (request: FastifyRequest, reply: FastifyReply) => {
    try {
      const { id } = request.params as { id: string };
      const deleted = await scenarioService.deleteScenario(id);
      if (!deleted) return reply.status(404).send({ error: 'Scenario not found' });
      return { message: 'Scenario deleted' };
    } catch (err) {
      fastify.log.error({ err }, 'Failed to delete scenario');
      return reply.status(500).send({ error: 'Failed to delete scenario' });
    }
  });
}

function generateSampleAnomalies() {
  return {
    anomalies: [
      { type: 'schedule_drift', projectId: 'demo-1', projectName: 'ERP Migration', severity: 'high', title: 'Schedule Slipping', description: 'Project is 12 days behind baseline schedule.', recommendation: 'Review critical path tasks and consider adding resources.' },
      { type: 'budget_overrun', projectId: 'demo-2', projectName: 'Mobile App v2', severity: 'medium', title: 'Budget Trending Over', description: 'Current burn rate projects 15% over budget at completion.', recommendation: 'Review scope and identify cost reduction opportunities.' },
      { type: 'resource_conflict', projectId: 'demo-3', projectName: 'Data Platform', severity: 'low', title: 'Resource Over-allocation', description: 'Senior developer allocated at 140% across projects.', recommendation: 'Rebalance workload or defer non-critical tasks.' },
    ],
    summary: 'Portfolio shows 1 high-severity anomaly requiring attention. Overall health is stable with minor resource concerns.',
    overallHealthTrend: 'stable',
    scannedProjects: 5,
  };
}

function generateSampleCrossProject() {
  return {
    resourceConflicts: [
      { description: 'Senior Developer over-allocated across ERP Migration and Mobile App v2 (140%)', severity: 'medium' },
      { description: 'QA Lead assigned to 3 projects with overlapping test phases', severity: 'low' },
    ],
    portfolioRiskHeatMap: [
      { projectId: 'demo-1', projectName: 'ERP Migration', healthScore: 62, riskLevel: 'medium', budgetUtilization: 78, progress: 55 },
      { projectId: 'demo-2', projectName: 'Mobile App v2', healthScore: 81, riskLevel: 'low', budgetUtilization: 45, progress: 72 },
      { projectId: 'demo-3', projectName: 'Data Platform', healthScore: 45, riskLevel: 'high', budgetUtilization: 92, progress: 38 },
      { projectId: 'demo-4', projectName: 'Website Redesign', healthScore: 90, riskLevel: 'low', budgetUtilization: 30, progress: 85 },
    ],
    budgetReallocation: {
      surplusCandidates: [
        { projectId: 'demo-4', projectName: 'Website Redesign', surplus: 35000 },
      ],
      deficitCandidates: [
        { projectId: 'demo-3', projectName: 'Data Platform', deficit: 28000 },
      ],
      recommendations: [
        'Consider reallocating $28K from Website Redesign surplus to Data Platform deficit.',
        'Review Data Platform scope to identify potential cost reductions.',
      ],
    },
    summary: 'Portfolio of 4 projects shows generally healthy status. Data Platform is the primary concern with high risk and 92% budget utilization at only 38% progress.',
  };
}

function generateSampleScenarioResult() {
  return {
    scheduleImpact: { originalDays: 180, projectedDays: 210, changePct: 16.7, explanation: 'Timeline extends by ~30 days due to reduced workforce and dependency cascading.' },
    budgetImpact: { originalBudget: 250000, projectedBudget: 265000, changePct: 6.0, explanation: 'Extended timeline increases overhead costs by approximately $15K.' },
    resourceImpact: { currentWorkers: 5, projectedWorkers: 3, explanation: 'Team reduces from 5 to 3 members. Critical skills coverage needs review.' },
    riskImpact: { currentRiskScore: 35, projectedRiskScore: 58, newRisks: ['Knowledge loss risk from departing team members.', 'Remaining team may face burnout from increased workload.'], explanation: 'Risk score increases significantly due to reduced capacity.' },
    affectedTasks: [
      { taskName: 'API Integration', impact: 'On critical path — reduced team delays this task directly.', severity: 'high' as const },
      { taskName: 'UAT Testing', impact: 'Dependent on API Integration — cascading delay.', severity: 'high' as const },
      { taskName: 'Documentation', impact: 'May be deprioritized due to resource constraints.', severity: 'medium' as const },
    ],
    recommendations: ['Prioritize critical path tasks and defer non-essential work.', 'Consider hiring contractors to maintain velocity on key deliverables.'],
    confidence: 0.65,
  };
}
