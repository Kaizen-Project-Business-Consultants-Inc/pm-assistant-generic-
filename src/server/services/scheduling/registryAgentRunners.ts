import { config } from '../../config';
import { agentRegistry } from '../AgentRegistryService';
import { notificationService } from '../NotificationService';
import { AgentActivityLogService } from '../AgentActivityLogService';
import type { Project } from '../ProjectService';
import logger from '../../utils/logger';
import { evmForecastService } from '../EVMForecastService';
import { scheduleService } from '../ScheduleService';
import { utcDay, workingDaysAfter } from '../../utils/workingDays';
import { alertRecipient } from './alertRecipient';

// ---------------------------------------------------------------------------
// Agent 2 — Budget Burn-Rate
// ---------------------------------------------------------------------------

export async function runBudgetBurnRateAgent(
  project: Project,
  activityLog: AgentActivityLogService,
): Promise<number> {
  if (!project.budgetAllocated) {
    await activityLog.log({
      projectId: project.id,
      agentName: 'budget',
      result: 'skipped',
      summary: 'No budget allocated for this project',
    });
    return 0;
  }

  // EVM figures only — no AI call (the nightly check used to run the AI forecast for every project)
  const forecast = await evmForecastService.generateMetricsOnly(project.id);
  const { CPI, VAC } = forecast.currentMetrics;
  const overrunProbability: number | undefined = undefined;

  const cpiThreshold = config.AGENT_BUDGET_CPI_THRESHOLD;
  const overrunThreshold = config.AGENT_BUDGET_OVERRUN_THRESHOLD;

  const problems: string[] = [];

  if (CPI < cpiThreshold) {
    problems.push(`CPI ${CPI.toFixed(2)} below threshold ${cpiThreshold}`);
  }
  if (VAC < 0) {
    problems.push(`VAC is negative ($${VAC.toFixed(0)})`);
  }
  if (overrunProbability !== undefined && overrunProbability > overrunThreshold) {
    problems.push(`AI overrun probability ${overrunProbability}% exceeds ${overrunThreshold}%`);
  }

  if (problems.length === 0) {
    await activityLog.log({
      projectId: project.id,
      agentName: 'budget',
      result: 'skipped',
      summary: `Metrics within thresholds — CPI ${CPI.toFixed(2)} (threshold ${cpiThreshold}), VAC $${VAC.toFixed(0)}${overrunProbability !== undefined ? `, overrun ${overrunProbability}% (threshold ${overrunThreshold}%)` : ''}`,
      details: { CPI, VAC, overrunProbability, cpiThreshold, overrunThreshold },
    });
    return 0;
  }

  // the PM if their login still exists, else the company owner (services/scheduling/alertRecipient.ts)
  const notifyUserId = await alertRecipient(project);
  if (!notifyUserId) return 0;
  const severity = CPI < 0.8 || (overrunProbability !== undefined && overrunProbability > 75)
    ? 'critical'
    : CPI < cpiThreshold
      ? 'high'
      : 'medium';

  await notificationService.create({
    userId: notifyUserId,
    type: 'budget_alert',
    severity,
    title: `Budget Alert: "${project.name}"`,
    message: problems.join('. ') + '.',
    projectId: project.id,
    linkType: 'evm',
    linkId: project.id, // one unread budget alert per project, not one a night
  });

  logger.info(`[Agent:Budget] Alert created for "${project.name}": ${problems.join('; ')}`);

  await activityLog.log({
    projectId: project.id,
    agentName: 'budget',
    result: 'alert_created',
    summary: problems.join('. ') + '.',
    details: { CPI, VAC, overrunProbability, cpiThreshold, overrunThreshold },
  });

  return 1;
}

// ---------------------------------------------------------------------------
// Agent 3 — Monte Carlo Confidence
// ---------------------------------------------------------------------------

export async function runMonteCarloConfidenceAgent(
  project: Project,
  schedules: Array<{ id: string; name: string; endDate: string }>,
  activityLog: AgentActivityLogService,
): Promise<number> {
  let alertCount = 0;
  const confidenceLevel = config.AGENT_MC_CONFIDENCE_LEVEL;
  const pKey = `p${confidenceLevel}` as 'p50' | 'p80' | 'p90';

  for (const schedule of schedules) {
    const ctx = { actorId: 'system' as const, actorType: 'system' as const, source: 'system' as const, projectId: project.id };
    const invocationResult = await agentRegistry.invoke('monte-carlo-v1', { scheduleId: schedule.id }, ctx);
    if (!invocationResult.success) {
      // A plan with no tasks has nothing to simulate — not an error (it filled the log every night)
      if (/no tasks/i.test(String(invocationResult.error ?? ''))) {
        await activityLog.log({
          projectId: project.id, agentName: 'monte_carlo', result: 'skipped',
          summary: `"${schedule.name}" has no tasks yet`, details: { scheduleId: schedule.id, scheduleName: schedule.name },
        });
        continue;
      }
      logger.error(`[Agent:MonteCarlo] Invocation failed for schedule ${schedule.id}: ${invocationResult.error}`);
      continue;
    }
    const result = invocationResult.output.result;

    const pDateStr = result.completionDate[pKey];
    if (!pDateStr || !schedule.endDate) continue;

    const end = String(schedule.endDate).slice(0, 10);
    const pDay = String(pDateStr).slice(0, 10);

    if (pDay > end) {
      // late by WORKING days, on the plan's calendar (it counted calendar days)
      const isWorking = await scheduleService.workingDayTest(schedule.id);
      const daysOver = Math.max(1, workingDaysAfter(utcDay(end), utcDay(pDay), isWorking));

      const criticalTasks = result.criticalityIndex
        .filter((t: any) => t.criticalityPercent > 80)
        .map((t: any) => t.taskName);

      const notifyUserId = await alertRecipient(project);
      if (!notifyUserId) continue;

      await notificationService.create({
        userId: notifyUserId,
        type: 'monte_carlo_alert',
        severity: daysOver > 14 ? 'critical' : daysOver > 7 ? 'high' : 'medium',
        title: `Schedule Risk: "${schedule.name}"`,
        message: `P${confidenceLevel} completion is ${daysOver} working day(s) past the plan's end.${
          criticalTasks.length > 0
            ? ` Critical tasks: ${criticalTasks.slice(0, 3).join(', ')}.`
            : ''
        }`,
        projectId: project.id,
        scheduleId: schedule.id,
        linkType: 'schedule',
        linkId: schedule.id, // one unread risk alert per plan, not one a night
      });

      logger.info(`[Agent:MonteCarlo] Alert for "${schedule.name}": P${confidenceLevel} +${daysOver}d`);
      alertCount++;

      await activityLog.log({
        projectId: project.id,
        agentName: 'monte_carlo',
        result: 'alert_created',
        summary: `P${confidenceLevel} completion for "${schedule.name}" is ${daysOver} day(s) past deadline`,
        details: { scheduleId: schedule.id, scheduleName: schedule.name, confidenceLevel, daysOver, criticalTasks: criticalTasks.slice(0, 5) },
      });
    } else {
      await activityLog.log({
        projectId: project.id,
        agentName: 'monte_carlo',
        result: 'skipped',
        summary: `"${schedule.name}" P${confidenceLevel} completion is on time`,
        details: { scheduleId: schedule.id, scheduleName: schedule.name, confidenceLevel, pDate: pDateStr, endDate: schedule.endDate.toString() },
      });
    }
  }

  return alertCount;
}
