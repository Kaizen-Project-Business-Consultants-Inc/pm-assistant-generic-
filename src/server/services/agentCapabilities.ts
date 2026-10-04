import { z } from 'zod';

/**
 * The agents the app runs (2026-10-04, after the agent review): delays (AI Reschedule), the EVM
 * budget forecast and Monte Carlo. Twelve others were removed — they duplicated Schedule Review,
 * the Team Planner, EVM, status reports and Lessons, their AI replies failed, or they reached
 * across projects. Knowledge search (rag-context-v1) is registered in ragAgentCapability.ts.
 */
import { agentRegistry } from './AgentRegistryService';
import { autoRescheduleService } from './AutoRescheduleService';
import { evmForecastService } from './EVMForecastService';
import { monteCarloService } from './MonteCarloService';

// Register RAG agent capability (side-effect import)
import './ragAgentCapability';

// --- Auto-Reschedule Agent ---
agentRegistry.register({
  id: 'auto-reschedule-v1',
  capability: 'schedule.optimize',
  version: '1.0.0',
  description: 'Detects schedule delays and generates reschedule proposals',
  inputSchema: z.object({
    scheduleId: z.string(),
    thresholdDays: z.number().optional(),
  }),
  outputSchema: z.object({
    delays: z.any(),
    proposal: z.any().optional(),
  }),
  permissions: ['agent:schedule'],
  timeoutMs: 120000,
  handler: async (input: { scheduleId: string; thresholdDays?: number }) => {
    const delays = await autoRescheduleService.detectDelays(input.scheduleId);
    const thresholdDays = input.thresholdDays ?? 3;
    const significant = delays.filter(
      (d: any) => d.delayDays >= thresholdDays || d.isOnCriticalPath,
    );
    if (significant.length === 0) {
      return { delays: significant };
    }
    const proposal = await autoRescheduleService.generateProposal(input.scheduleId, undefined, 'agent');
    return { delays: significant, proposal };
  },
});

// --- Budget Forecast Agent ---
agentRegistry.register({
  id: 'budget-forecast-v1',
  capability: 'budget.forecast',
  version: '1.0.0',
  description: 'Generates EVM budget forecast for a project',
  inputSchema: z.object({
    projectId: z.string(),
  }),
  outputSchema: z.object({
    forecast: z.any(),
  }),
  permissions: ['agent:budget'],
  timeoutMs: 90000,
  handler: async (input: { projectId: string }) => {
    const forecast = await evmForecastService.generateForecast(input.projectId);
    return { forecast };
  },
});

// --- Monte Carlo Agent ---
agentRegistry.register({
  id: 'monte-carlo-v1',
  capability: 'risk.assess',
  version: '1.0.0',
  description: 'Runs Monte Carlo simulation for schedule risk assessment',
  inputSchema: z.object({
    scheduleId: z.string(),
    config: z.object({
      iterations: z.number().optional(),
      confidenceLevels: z.array(z.number()).optional(),
      uncertaintyModel: z.string().optional(),
    }).optional(),
  }),
  outputSchema: z.object({
    result: z.any(),
  }),
  permissions: ['agent:risk'],
  timeoutMs: 120000,
  handler: async (input: { scheduleId: string; config?: any }) => {
    const result = await monteCarloService.runSimulation(input.scheduleId, input.config);
    return { result };
  },
});
