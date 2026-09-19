import { config } from '../../config';
import { agentRegistry } from '../AgentRegistryService';
import { notificationService } from '../NotificationService';
import { AgentActivityLogService } from '../AgentActivityLogService';
import type { Project } from '../ProjectService';
import logger from '../../utils/logger';
import { isOverdue } from '../../utils/calendarDate';

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

  const ctx = { actorId: 'system' as const, actorType: 'system' as const, source: 'system' as const, projectId: project.id };
  const result = await agentRegistry.invoke('budget-forecast-v1', { projectId: project.id }, ctx);
  if (!result.success) throw new Error(result.error || 'Budget agent failed');
  const forecast = result.output.forecast;
  const { CPI, VAC } = forecast.currentMetrics;
  const overrunProbability = forecast.aiPredictions?.overrunProbability;

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

  const notifyUserId = project.projectManagerId || project.createdBy;
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
      logger.error(`[Agent:MonteCarlo] Invocation failed for schedule ${schedule.id}: ${invocationResult.error}`);
      continue;
    }
    const result = invocationResult.output.result;

    const pDateStr = result.completionDate[pKey];
    if (!pDateStr || !schedule.endDate) continue;

    const pDate = new Date(pDateStr);
    const endDate = new Date(schedule.endDate);

    if (pDate > endDate) {
      const daysOver = Math.ceil((pDate.getTime() - endDate.getTime()) / (1000 * 60 * 60 * 24));

      const criticalTasks = result.criticalityIndex
        .filter((t: any) => t.criticalityPercent > 80)
        .map((t: any) => t.taskName);

      const notifyUserId = project.projectManagerId || project.createdBy;

      await notificationService.create({
        userId: notifyUserId,
        type: 'monte_carlo_alert',
        severity: daysOver > 14 ? 'critical' : daysOver > 7 ? 'high' : 'medium',
        title: `Schedule Risk: "${schedule.name}"`,
        message: `P${confidenceLevel} completion is ${daysOver} day(s) past deadline.${
          criticalTasks.length > 0
            ? ` Critical tasks: ${criticalTasks.slice(0, 3).join(', ')}.`
            : ''
        }`,
        projectId: project.id,
        scheduleId: schedule.id,
        linkType: 'schedule',
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

// ---------------------------------------------------------------------------
// Agent 4 — Meeting Follow-Up
// ---------------------------------------------------------------------------

export async function runMeetingFollowUpAgent(
  project: Project,
  activityLog: AgentActivityLogService,
): Promise<number> {
  const ctx = { actorId: 'system' as const, actorType: 'system' as const, source: 'system' as const, projectId: project.id };
  const invocationResult = await agentRegistry.invoke('meeting-followup-v1', { projectId: project.id }, ctx);
  if (!invocationResult.success) throw new Error(invocationResult.error || 'Meeting agent failed');
  const analyses = invocationResult.output.analyses;
  if (analyses.length === 0) {
    await activityLog.log({
      projectId: project.id,
      agentName: 'meeting',
      result: 'skipped',
      summary: 'No meeting analyses found for this project',
    });
    return 0;
  }

  let alertCount = 0;
  const notifyUserId = project.projectManagerId || project.createdBy;

  for (const analysis of analyses) {
    const problems: string[] = [];

    const unappliedUpdates = analysis.taskUpdates.filter(
      (_: any, idx: number) => !analysis.appliedItems.includes(idx),
    );
    if (unappliedUpdates.length > 0) {
      problems.push(`${unappliedUpdates.length} unapplied task update(s)`);
    }

    const now = new Date();
    const overdueItems = analysis.actionItems.filter((item: any) => {
      if (!item.dueDate) return false;
      return isOverdue(item.dueDate);
    });
    if (overdueItems.length > 0) {
      problems.push(`${overdueItems.length} overdue action item(s)`);
    }

    if (problems.length === 0) {
      await activityLog.log({
        projectId: project.id,
        agentName: 'meeting',
        result: 'skipped',
        summary: `Meeting analysis "${analysis.id}" — nothing overdue or unapplied`,
      });
      continue;
    }

    await notificationService.create({
      userId: notifyUserId,
      type: 'meeting_followup',
      severity: overdueItems.length > 2 ? 'high' : 'medium',
      title: `Meeting Follow-Up: "${project.name}"`,
      message: problems.join('. ') + '.',
      projectId: project.id,
      linkType: 'meeting',
      linkId: analysis.id,
    });

    logger.info(`[Agent:Meeting] Alert for "${project.name}": ${problems.join('; ')}`);
    alertCount++;

    await activityLog.log({
      projectId: project.id,
      agentName: 'meeting',
      result: 'alert_created',
      summary: problems.join('. ') + '.',
      details: { analysisId: analysis.id, unappliedUpdates: unappliedUpdates.length, overdueItems: overdueItems.length },
    });
  }

  return alertCount;
}

// ---------------------------------------------------------------------------
// Agent 5 — Scope Creep Detection
// ---------------------------------------------------------------------------

export async function runScopeCreepAgent(
  project: Project,
  activityLog: AgentActivityLogService,
): Promise<number> {
  const notifyUserId = project.projectManagerId || project.createdBy;
  const ctx = { actorId: 'system' as const, actorType: 'system' as const, source: 'system' as const, projectId: project.id };

  const invocationResult = await agentRegistry.invoke('scope-creep-detection-v1', {
    projectId: project.id,
    userId: notifyUserId,
  }, ctx);

  if (!invocationResult.success) {
    throw new Error(invocationResult.error || 'Scope creep agent failed');
  }

  const { skipped, skipReason, indicators, proposal } = invocationResult.output;

  if (skipped) {
    await activityLog.log({
      projectId: project.id,
      agentName: 'scope_creep',
      result: 'skipped',
      summary: skipReason || 'No scope creep detected',
      details: indicators ? { ...indicators } : undefined,
    });
    return 0;
  }

  logger.info(`[Agent:ScopeCreep] Alert created for "${project.name}"`);

  await activityLog.log({
    projectId: project.id,
    agentName: 'scope_creep',
    result: 'alert_created',
    summary: `Scope creep detected — proposal created`,
    details: indicators ? { ...indicators, proposalId: proposal?.id } : undefined,
  });

  return 1;
}
