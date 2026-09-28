import { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import { requireProjectAccess, checkProjectRole, projectsOfSchedules } from '../../middleware/requireProjectAccess';
import { z } from 'zod';
import { ClaudeTaskBreakdownService } from '../../services/aiTaskBreakdownClaude';
import {
  suggestDependenciesClaude,
  optimizeScheduleClaude,
  generateProjectInsightsClaude,
} from '../../services/aiSchedulingClaude';
import { authMiddleware } from '../../middleware/auth';
import { requireScope } from '../../middleware/requireScope';

const analyzeProjectSchema = z.object({
  projectDescription: z.string().min(1),
  projectType: z.string().min(1).optional(),
  projectId: z.string().optional(),
});

const suggestDependenciesSchema = z.object({
  tasks: z.array(z.any()).min(1),
  projectContext: z.string().optional(),
});

const optimizeScheduleSchema = z.object({
  scheduleId: z.string().min(1),
  optimizationGoals: z.array(z.string()).optional(),
  constraints: z.record(z.string(), z.any()).optional(),
});

export async function aiSchedulingRoutes(fastify: FastifyInstance) {
  fastify.addHook('preHandler', authMiddleware);

  const claudeBreakdown = new ClaudeTaskBreakdownService(fastify);

  // Analyze project and generate AI task breakdown
  fastify.post('/analyze-project', {
    preHandler: [requireScope('write'), async (req: FastifyRequest, reply: FastifyReply) => {
      // Only when it's about an existing project (describing a new one needs no project)
      const projectId = (req.body as { projectId?: string } | undefined)?.projectId;
      if (!projectId) return;
      const d = await checkProjectRole(req, projectId, 'viewer');
      if (!d.ok) return reply.status(d.status).send(d.body);
    }],
    schema: {
      description: 'Analyze project and generate AI task breakdown',
      tags: ['ai-scheduling'],
    },
    handler: async (request: FastifyRequest, reply: FastifyReply) => {
      try {
        const { projectDescription, projectType, projectId } = analyzeProjectSchema.parse(request.body);
        const user = request.user!;

        const { analysis, aiPowered } = await claudeBreakdown.analyzeProject(
          projectDescription,
          projectType,
          projectId,
          user.userId,
        );

        const insights = generateInsights(analysis);
        return { analysis, insights, aiPowered };
      } catch (error) {
        if (error instanceof z.ZodError) return reply.code(400).send({ error: 'Validation error', details: error.issues });
        fastify.log.error({ err: error instanceof Error ? error : new Error(String(error)) }, 'Error in AI project analysis');
        return reply.code(500).send({ error: 'Failed to analyze project' });
      }
    },
  });

  // Suggest task dependencies
  fastify.post('/suggest-dependencies', {
    preHandler: [requireScope('write')],
    schema: {
      description: 'Suggest task dependencies',
      tags: ['ai-scheduling'],
    },
    handler: async (request: FastifyRequest, reply: FastifyReply) => {
      try {
        const { tasks, projectContext } = suggestDependenciesSchema.parse(request.body);
        const user = request.user!;

        const { dependencies, aiPowered } = await suggestDependenciesClaude(
          tasks,
          projectContext,
          fastify,
          user.userId,
        );

        return { dependencies, aiPowered };
      } catch (error) {
        if (error instanceof z.ZodError) return reply.code(400).send({ error: 'Validation error', details: error.issues });
        fastify.log.error({ err: error instanceof Error ? error : new Error(String(error)) }, 'Error in AI dependency suggestion');
        return reply.code(500).send({ error: 'Failed to suggest dependencies' });
      }
    },
  });

  // Optimize schedule
  fastify.post('/optimize-schedule', {
    preHandler: [requireScope('write'), requireProjectAccess('viewer', { resolve: async (req) => projectsOfSchedules([(req.body as { scheduleId?: string } | undefined)?.scheduleId]) })],
    schema: {
      description: 'Optimize existing schedule using AI',
      tags: ['ai-scheduling'],
    },
    handler: async (request: FastifyRequest, reply: FastifyReply) => {
      try {
        const { scheduleId, optimizationGoals, constraints } = optimizeScheduleSchema.parse(request.body);
        const user = request.user!;

        const { optimizedSchedule, aiPowered } = await optimizeScheduleClaude(
          scheduleId,
          optimizationGoals || [],
          constraints,
          fastify,
          user.userId,
        );

        return { optimizedSchedule, aiPowered };
      } catch (error) {
        if (error instanceof z.ZodError) return reply.code(400).send({ error: 'Validation error', details: error.issues });
        fastify.log.error({ err: error instanceof Error ? error : new Error(String(error)) }, 'Error in AI schedule optimization');
        return reply.code(500).send({ error: 'Failed to optimize schedule' });
      }
    },
  });

  // Get AI insights for project
  fastify.get('/insights/:projectId', {
    preHandler: [requireScope('read'), requireProjectAccess('viewer')],
    schema: {
      description: 'Get AI insights for project',
      tags: ['ai-scheduling'],
    },
    handler: async (request: FastifyRequest, reply: FastifyReply) => {
      try {
        const { projectId } = request.params as { projectId: string };
        const user = request.user!;

        const { insights, aiPowered } = await generateProjectInsightsClaude(
          projectId,
          fastify,
          user.userId,
        );

        return { insights, aiPowered };
      } catch (error) {
        fastify.log.error({ err: error instanceof Error ? error : new Error(String(error)) }, 'Error generating AI insights');
        return reply.code(500).send({ error: 'Failed to generate insights' });
      }
    },
  });
}

function generateInsights(analysis: any): any {
  const insights: { recommendations: string[]; warnings: string[]; optimizations: string[] } = {
    recommendations: [],
    warnings: [],
    optimizations: [],
  };

  if (analysis.complexity === 'high') {
    insights.recommendations.push('Consider breaking this project into smaller phases');
    insights.recommendations.push('Allocate experienced team members to high-complexity tasks');
  }
  if (analysis.riskLevel > 60) {
    insights.warnings.push('High risk level detected - add buffer time and contingency plans');
    insights.recommendations.push('Implement regular risk assessment checkpoints');
  }
  if (analysis.estimatedDuration > 60) {
    insights.optimizations.push('Long duration - consider parallel task execution');
    insights.recommendations.push('Break project into smaller milestones');
  }

  const highRiskTasks = analysis.taskSuggestions?.filter((t: any) => t.riskLevel > 50) || [];
  if (highRiskTasks.length > 0) {
    insights.warnings.push(`${highRiskTasks.length} high-risk tasks identified - monitor closely`);
  }

  return insights;
}
