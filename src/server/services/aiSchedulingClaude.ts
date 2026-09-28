import { FastifyInstance } from 'fastify';
import { claudeService, promptTemplates, PromptTemplate } from './claudeService';
import { AIContextBuilder } from './aiContextBuilder';
import {
  AIDependencyResponseSchema,
  AIScheduleOptimizationSchema,
  AIProjectInsightsSchema,
  type AIDependencyResponse,
  type AIScheduleOptimization,
  type AIProjectInsights,
} from '../schemas/aiSchemas';
import { logAIUsage } from './aiUsageLogger';

// Additional prompt templates for scheduling
export const schedulingPromptTemplates = {
  dependencyDetection: new PromptTemplate(
    `You are a project scheduling AI specializing in dependency analysis.

Given the following list of tasks, identify all logical dependencies between them. Consider:
1. Natural sequencing (e.g., design before development, foundation before framing)
2. Resource constraints (tasks sharing the same team/equipment)
3. Regulatory requirements (inspections, permits must precede certain work)
4. Safety requirements

Tasks:
{{taskList}}

{{projectContext}}

For each dependency, specify:
- fromTask: the task ID that must complete/start first
- toTask: the task ID that depends on it
- type: "finish-to-start" (most common), "start-to-start", or "finish-to-finish"
- confidence: 0.0 to 1.0
- reason: brief explanation

Respond in valid JSON matching the requested schema.`,
    '1.0.0',
  ),

  scheduleOptimization: new PromptTemplate(
    `You are a schedule optimization AI.

Current schedule data:
{{scheduleData}}

Optimization goals: {{goals}}
Constraints: {{constraints}}

Analyze the schedule and suggest optimizations. Consider:
1. Task parallelization opportunities
2. Resource leveling
3. Critical path optimization
4. Buffer placement for risk mitigation

For each task, suggest optimized start/end dates and explain reasoning.
Calculate overall improvements in duration, risk, and resource utilization.

Respond in valid JSON matching the requested schema.`,
    '1.0.0',
  ),
};

// Claude-powered dependency suggestions
export async function suggestDependenciesClaude(
  tasks: Array<{ id: string; name: string; description?: string; category?: string }>,
  projectContext?: string,
  fastify?: FastifyInstance,
  userId?: string,
): Promise<{ dependencies: AIDependencyResponse['dependencies']; aiPowered: boolean }> {
  if (!claudeService.isAvailable()) {
    return { dependencies: fallbackDependencies(tasks), aiPowered: false };
  }

  try {
    const taskList = tasks
      .map(t => `- ID: ${t.id} | Name: ${t.name} | Description: ${t.description || 'N/A'} | Category: ${t.category || 'N/A'}`)
      .join('\n');

    const systemPrompt = schedulingPromptTemplates.dependencyDetection.render({
      taskList,
      projectContext: projectContext ? `Project context: ${projectContext}` : '',
    });

    const result = await claudeService.completeWithJsonSchema({
      feature: 'dependency-suggestion',
      systemPrompt,
      userMessage: 'Analyze these tasks and identify all dependencies. Return valid JSON.',
      schema: AIDependencyResponseSchema,
      temperature: 0.2,
    });

    if (fastify) {
      logAIUsage({
        userId,
        feature: 'dependency-suggestion',
        model: 'claude',
        usage: result.usage,
        latencyMs: result.latencyMs,
        success: true,
      });
    }

    return { dependencies: result.data.dependencies, aiPowered: true };
  } catch (error) {
    if (fastify) {
      fastify.log.warn({ err: error instanceof Error ? error : new Error(String(error)) }, 'Claude dependency suggestion failed, using fallback');
      logAIUsage({
        userId,
        feature: 'dependency-suggestion',
        model: 'claude',
        usage: { inputTokens: 0, outputTokens: 0 },
        latencyMs: 0,
        success: false,
        errorMessage: error instanceof Error ? error.message : String(error),
      });
    }
    return { dependencies: fallbackDependencies(tasks), aiPowered: false };
  }
}

// Claude-powered schedule optimization
export async function optimizeScheduleClaude(
  scheduleId: string,
  goals: string[],
  constraints: any,
  fastify: FastifyInstance,
  userId?: string,
): Promise<{ optimizedSchedule: AIScheduleOptimization; aiPowered: boolean }> {
  // Try to get schedule data from in-memory service
  const { scheduleService } = await import('./ScheduleService');
  let scheduleData = '';

  try {
    const tasks = await scheduleService.findTasksByScheduleId(scheduleId);
    if (tasks.length > 0) {
      scheduleData = `Schedule ID: ${scheduleId}\nTasks:\n`;
      scheduleData += tasks
        .map((t: any) => `- ${t.name} [${t.status}] priority=${t.priority}, est=${t.estimatedDays || 'N/A'}d, due=${t.dueDate || 'N/A'}`)
        .join('\n');
    }
  } catch {
    // Best-effort
  }

  if (!claudeService.isAvailable() || !scheduleData) {
    return {
      optimizedSchedule: {
        tasks: [],
        improvements: { durationReduction: 0, riskReduction: 0, resourceUtilization: 0 },
      },
      aiPowered: false,
    };
  }

  try {
    const systemPrompt = schedulingPromptTemplates.scheduleOptimization.render({
      scheduleData,
      goals: goals.join(', ') || 'minimize-duration, balance-resources',
      constraints: JSON.stringify(constraints || {}),
    });

    const result = await claudeService.completeWithJsonSchema({
      feature: 'schedule-optimization',
      systemPrompt,
      userMessage: 'Optimize this schedule based on the goals and constraints. Return valid JSON.',
      schema: AIScheduleOptimizationSchema,
      temperature: 0.3,
    });

    logAIUsage({
      userId,
      feature: 'schedule-optimization',
      model: 'claude',
      usage: result.usage,
      latencyMs: result.latencyMs,
      success: true,
      requestContext: { scheduleId, goals },
    });

    return { optimizedSchedule: result.data, aiPowered: true };
  } catch (error) {
    fastify.log.warn({ err: error instanceof Error ? error : new Error(String(error)) }, 'Claude schedule optimization failed');
    logAIUsage({
      userId,
      feature: 'schedule-optimization',
      model: 'claude',
      usage: { inputTokens: 0, outputTokens: 0 },
      latencyMs: 0,
      success: false,
      errorMessage: error instanceof Error ? error.message : String(error),
    });
    return {
      optimizedSchedule: {
        tasks: [],
        improvements: { durationReduction: 0, riskReduction: 0, resourceUtilization: 0 },
      },
      aiPowered: false,
    };
  }
}

// Claude-powered project insights
export async function generateProjectInsightsClaude(
  projectId: string,
  fastify: FastifyInstance,
  userId?: string,
): Promise<{ insights: AIProjectInsights | Record<string, any>; aiPowered: boolean }> {
  const contextBuilder = new AIContextBuilder(fastify);

  let projectData = '';
  try {
    const ctx = await contextBuilder.buildProjectContext(projectId);
    projectData = contextBuilder.toPromptString(ctx);
  } catch {
    return {
      insights: { performanceMetrics: {}, riskIndicators: [], recommendations: [], trends: {} },
      aiPowered: false,
    };
  }

  if (!claudeService.isAvailable()) {
    return {
      insights: { performanceMetrics: {}, riskIndicators: [], recommendations: [], trends: {} },
      aiPowered: false,
    };
  }

  try {
    const systemPrompt = promptTemplates.projectInsights.render({
      projectData,
      timePeriod: 'Current snapshot',
    });

    const result = await claudeService.completeWithJsonSchema({
      feature: 'project-insights',
      tier: 'light', // routine job: the cheaper model
      systemPrompt,
      userMessage: 'Generate comprehensive project insights based on the data provided. Return valid JSON.',
      schema: AIProjectInsightsSchema,
      temperature: 0.3,
    });

    logAIUsage({
      userId,
      feature: 'project-insights',
      model: 'claude',
      usage: result.usage,
      latencyMs: result.latencyMs,
      success: true,
      requestContext: { projectId },
    });

    return { insights: result.data, aiPowered: true };
  } catch (error) {
    fastify.log.warn({ err: error instanceof Error ? error : new Error(String(error)) }, 'Claude project insights failed');
    logAIUsage({
      userId,
      feature: 'project-insights',
      model: 'claude',
      usage: { inputTokens: 0, outputTokens: 0 },
      latencyMs: 0,
      success: false,
      errorMessage: error instanceof Error ? error.message : String(error),
    });
    return {
      insights: { performanceMetrics: {}, riskIndicators: [], recommendations: [], trends: {} },
      aiPowered: false,
    };
  }
}

// Fallback dependency detection
function fallbackDependencies(
  tasks: Array<{ id: string; name: string; description?: string; category?: string }>,
): AIDependencyResponse['dependencies'] {
  const deps: AIDependencyResponse['dependencies'] = [];

  const planningTasks = tasks.filter(t => t.category?.toLowerCase().includes('planning') || t.name.toLowerCase().includes('requirements'));
  const designTasks = tasks.filter(t => t.category?.toLowerCase().includes('design') || t.name.toLowerCase().includes('design'));
  const devTasks = tasks.filter(t => t.category?.toLowerCase().includes('development') || t.name.toLowerCase().includes('development'));
  const testTasks = tasks.filter(t => t.category?.toLowerCase().includes('testing') || t.name.toLowerCase().includes('testing'));

  for (const p of planningTasks) {
    for (const d of designTasks) {
      deps.push({ fromTask: p.id, toTask: d.id, type: 'finish-to-start', confidence: 0.9, reason: 'Design depends on completed planning' });
    }
  }
  for (const d of designTasks) {
    for (const dev of devTasks) {
      deps.push({ fromTask: d.id, toTask: dev.id, type: 'finish-to-start', confidence: 0.8, reason: 'Development requires completed designs' });
    }
  }
  for (const dev of devTasks) {
    for (const t of testTasks) {
      deps.push({ fromTask: dev.id, toTask: t.id, type: 'finish-to-start', confidence: 0.95, reason: 'Testing requires completed development' });
    }
  }

  return deps;
}
