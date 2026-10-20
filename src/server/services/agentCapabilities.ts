import { z } from 'zod';

/**
 * The agents the app runs (2026-10-04, after the agent review): delays (AI Reschedule) and Monte
 * Carlo (the nightly budget check reads EVM directly). Twelve others were removed — they duplicated Schedule Review,
 * the Team Planner, EVM, status reports and Lessons, their AI replies failed, or they reached
 * across projects. Knowledge search (rag-context-v1) is registered in ragAgentCapability.ts.
 */
import { agentRegistry } from './AgentRegistryService';
import { autoRescheduleService } from './AutoRescheduleService';
import { monteCarloService } from './MonteCarloService';
import { companyCacheKey } from '../utils/companyCacheKey';

// Register RAG agent capability (side-effect import)
import './ragAgentCapability';

// One run per schedule at a time: the overdue workflow fires once per late task, so importing a
// late plan started a run per task, all on the same schedule (U59, 2026-10-20). Keyed inside the
// company: the sample project's schedule id is the same in every company, and the nightly scan
// runs several companies at once.
const runsInFlight = new Map<string, Promise<{ delays: unknown; proposal?: unknown }>>();

async function proposeForDelays(scheduleId: string, thresholdDays: number) {
  const delays = await autoRescheduleService.detectDelays(scheduleId);
  const significant = delays.filter(d => d.delayDays >= thresholdDays || d.isOnCriticalPath);
  if (significant.length === 0) return { delays: significant };
  // Rules only, as the AI inbox's weekly agent does: background runs are rarely opened, and an AI
  // call per late task cost 20x the chat on staging (U59). The PM's own button still uses AI.
  const proposal = await autoRescheduleService.generateProposal(scheduleId, undefined, 'agent', { useAi: false });
  return { delays: significant, proposal };
}

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
    const thresholdDays = input.thresholdDays ?? 3;
    const key = companyCacheKey(`${input.scheduleId}:${thresholdDays}`);
    const running = runsInFlight.get(key);
    if (running) return running;
    const run = proposeForDelays(input.scheduleId, thresholdDays).finally(() => runsInFlight.delete(key));
    runsInFlight.set(key, run);
    return run;
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
