import { FastifyInstance } from 'fastify';
import { claudeService, promptTemplates } from './claudeService';
import { AIContextBuilder } from './aiContextBuilder';
import { FallbackTaskBreakdownService, ProjectAnalysis } from './aiTaskBreakdown';
import { AIProjectAnalysisSchema } from '../schemas/aiSchemas';
import { logAIUsage } from './aiUsageLogger';

export class ClaudeTaskBreakdownService {
  private fastify: FastifyInstance;
  private fallback: FallbackTaskBreakdownService;
  private contextBuilder: AIContextBuilder;

  constructor(fastify: FastifyInstance) {
    this.fastify = fastify;
    this.fallback = new FallbackTaskBreakdownService(fastify);
    this.contextBuilder = new AIContextBuilder(fastify);
  }

  async analyzeProject(
    projectDescription: string,
    projectType?: string,
    projectId?: string,
    userId?: string,
  ): Promise<{ analysis: ProjectAnalysis; aiPowered: boolean }> {
    if (!claudeService.isAvailable()) {
      this.fastify.log.info('Claude unavailable, using fallback task breakdown');
      const analysis = await this.fallback.analyzeProject(projectDescription, projectType);
      return { analysis, aiPowered: false };
    }

    try {
      let additionalContext = '';
      if (projectId) {
        try {
          const ctx = await this.contextBuilder.buildProjectContext(projectId);
          additionalContext = this.contextBuilder.toPromptString(ctx);
        } catch {
          // Context building is best-effort
        }
      }
      if (projectType) {
        additionalContext += `\nProject type hint: ${projectType}`;
      }

      const systemPrompt = promptTemplates.taskBreakdown.render({
        projectDescription,
        additionalContext,
      });

      const result = await claudeService.completeWithJsonSchema({
      feature: 'task-breakdown',
        systemPrompt,
        userMessage:
          'Analyze this project and generate a comprehensive task breakdown. ' +
          'Return valid JSON matching the requested schema.',
        schema: AIProjectAnalysisSchema,
        temperature: 0.3,
      });

      logAIUsage({
        userId,
        feature: 'task-breakdown',
        model: 'claude',
        usage: result.usage,
        latencyMs: result.latencyMs,
        success: true,
        requestContext: { projectType, projectId },
      });

      const analysis: ProjectAnalysis = {
        projectType: result.data.projectType,
        complexity: result.data.complexity,
        estimatedDuration: result.data.estimatedDuration,
        riskLevel: result.data.riskLevel,
        suggestedPhases: result.data.suggestedPhases,
        taskSuggestions: result.data.taskSuggestions,
        criticalPath: result.data.criticalPath,
        resourceRequirements: result.data.resourceRequirements,
      };

      return { analysis, aiPowered: true };
    } catch (error) {
      this.fastify.log.warn(
        { err: error instanceof Error ? error : new Error(String(error)) },
        'Claude task breakdown failed, falling back to template',
      );

      logAIUsage({
        userId,
        feature: 'task-breakdown',
        model: 'claude',
        usage: { inputTokens: 0, outputTokens: 0 },
        latencyMs: 0,
        success: false,
        errorMessage: error instanceof Error ? error.message : String(error),
      });

      const analysis = await this.fallback.analyzeProject(projectDescription, projectType);
      return { analysis, aiPowered: false };
    }
  }
}
