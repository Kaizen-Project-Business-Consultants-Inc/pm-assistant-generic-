import { config } from '../../config';
import '../agentCapabilities';
import { notificationService } from '../NotificationService';
import { projectService } from '../ProjectService';
import { scheduleService } from '../ScheduleService';
import { autoRescheduleService } from '../AutoRescheduleService';
import { AgentActivityLogService } from '../AgentActivityLogService';
import { webhookService } from '../WebhookService';
import { killSwitchService } from '../agents/KillSwitchService';
import { agentMemoryService } from '../AgentMemoryService';
import { deadLetterService } from '../DeadLetterService';
import logger from '../../utils/logger';
import { getTenantContext } from '../../middleware/requestContext';
import { runBudgetBurnRateAgent, runMonteCarloConfidenceAgent } from './registryAgentRunners';

/**
 * The nightly scan (2026-10-04, slimmed after the agent review): three checks, no AI, nothing
 * changed — each only alerts the project's PM, once per unread alert:
 *  1. Delays — tasks behind where their working days say they should be (AI Reschedule then
 *     proposes new dates when the PM asks; the scan used to generate an AI proposal every night).
 *  2. Budget — EVM cost performance (CPI, VAC) from the real spend.
 *  3. Schedule risk — Monte Carlo: the P80 finish against the plan's end date.
 * The other twelve agents duplicated Schedule Review, the Team Planner, EVM, status reports or
 * Lessons, failed on their AI replies, or reached across projects; they were removed.
 */
type ScanFlags = { scheduleDelay: boolean; budgetOverrun: boolean; scheduleRisk: boolean };

// ---------------------------------------------------------------------------
// Concurrency limiter — runs async functions with bounded parallelism
// ---------------------------------------------------------------------------

async function parallelLimit<T>(tasks: (() => Promise<T>)[], concurrency: number): Promise<T[]> {
  const results: T[] = [];
  let idx = 0;

  async function worker() {
    while (idx < tasks.length) {
      const i = idx++;
      results[i] = await tasks[i]();
    }
  }

  const workers = Array.from({ length: Math.min(concurrency, tasks.length) }, () => worker());
  await Promise.all(workers);
  return results;
}

const PROJECT_CONCURRENCY = 3;

export interface ScanStats {
  projectsScanned: number;
  schedulesScanned: number;
  delaysDetected: number;
  notificationsSent: number;
  budgetAlertsCreated: number;
  mcAlertsCreated: number;
}

function emptyStats(): ScanStats {
  return { projectsScanned: 0, schedulesScanned: 0, delaysDetected: 0, notificationsSent: 0, budgetAlertsCreated: 0, mcAlertsCreated: 0 };
}

async function storeScanResult(agentId: string, projectId: string, result: Record<string, unknown>): Promise<void> {
  try {
    await agentMemoryService.store(agentId, 'project', projectId, 'latest_scan', {
      ...result,
      scannedAt: new Date().toISOString(),
    }, 86400); // TTL: 24 hours
  } catch {
    // Fire-and-forget — don't let memory storage fail the scan
  }
}

// One scan at a time PER COMPANY (2026-10-04: it was one flag for the whole server, and the nightly
// job scans three companies at once — the second and third were skipped as "still in progress")
const scansInProgress = new Set<string>();
const scanKey = () => getTenantContext()?.dbName ?? 'single-tenant';

export async function runScanImpl(activityLog: AgentActivityLogService, projectId?: string): Promise<ScanStats> {
  const key = scanKey();
  if (scansInProgress.has(key)) {
    logger.warn('[Agent] Scan skipped — previous scan still in progress');
    return emptyStats();
  }
  scansInProgress.add(key);

  try {
  logger.info(`[Agent] Starting scan...${projectId ? ` (project: ${projectId})` : ''}`);

  const ksStatus = killSwitchService.getStatus();
  if (!ksStatus.globalEnabled) {
    logger.info('[Agent] Scan aborted — global kill switch is active');
    return emptyStats();
  }

  const stats = emptyStats();
  const projectAgentFlags = new Map<string, { name: string; flags: ScanFlags; details: Record<string, string> }>();
  const thresholdDays = config.AGENT_DELAY_THRESHOLD_DAYS;

  let projects: Awaited<ReturnType<typeof projectService.findAll>>;
  if (projectId) {
    const project = await projectService.findById(projectId);
    projects = project ? [project] : [];
  } else {
    const allProjects = await projectService.findAll();
    projects = allProjects.filter(
      // the read-only sample project is never scanned
      (p) => !p.isDemo && (p.status === 'active' || p.status === 'planning'),
    );
  }

  logger.info(`[Agent] Found ${projects.length} active/planning projects`);

  // Process projects in parallel (bounded concurrency)
  const projectTasks = projects.map((project) => async () => {
    const pStats = emptyStats();
    pStats.projectsScanned = 1;

    projectAgentFlags.set(project.id, {
      name: project.name,
      flags: { scheduleDelay: false, budgetOverrun: false, scheduleRisk: false },
      details: {},
    });

    const schedules = await scheduleService.findByProjectId(project.id);

    // --- 1. Delays (no AI: AI Reschedule proposes dates only when the PM asks) ---
    for (const schedule of schedules) {
      pStats.schedulesScanned++;
      try {
        const delays = await autoRescheduleService.detectDelays(schedule.id);
        const significant = delays.filter(d => d.delayDays >= thresholdDays || d.isOnCriticalPath);
        pStats.delaysDetected += significant.length;
        if (significant.length === 0) {
          await activityLog.log({
            projectId: project.id, agentName: 'auto_reschedule', result: 'skipped',
            summary: `No significant delays in "${schedule.name}" (threshold: ${thresholdDays} working days)`,
            details: { scheduleId: schedule.id, scheduleName: schedule.name, thresholdDays },
          });
          continue;
        }
        const pFlags = projectAgentFlags.get(project.id);
        if (pFlags) { pFlags.flags.scheduleDelay = true; pFlags.details.scheduleDelay = `${significant.length} delay(s) in "${schedule.name}"`; }
        const worst = significant[0]; // most severe first
        const late = `${worst.delayDays} working day${worst.delayDays === 1 ? '' : 's'}`;
        await notificationService.create({
          userId: project.projectManagerId || project.createdBy,
          type: 'reschedule_proposal',
          severity: significant.some(d => d.severity === 'critical') ? 'critical' : significant.some(d => d.severity === 'high') ? 'high' : 'medium',
          title: `${significant.length} task${significant.length === 1 ? '' : 's'} slipping in "${schedule.name}"`,
          message: `"${worst.taskName}" looks set to finish ${late} late${worst.isOnCriticalPath ? ' (critical path)' : ''}. Open the schedule and use AI Reschedule to get proposed new dates.`,
          projectId: project.id,
          scheduleId: schedule.id,
          linkType: 'schedule',
          linkId: schedule.id, // one unread alert per plan, not one a night
        });
        pStats.notificationsSent++;
        await activityLog.log({
          projectId: project.id, agentName: 'auto_reschedule', result: 'alert_created',
          summary: `${significant.length} significant delay(s) in "${schedule.name}"`,
          details: { scheduleId: schedule.id, scheduleName: schedule.name, significantDelays: significant.length },
        });
      } catch (error) {
        logger.error(`[Agent] Error processing schedule ${schedule.id} (${schedule.name}):`, error);
        await activityLog.log({
          projectId: project.id, agentName: 'auto_reschedule', result: 'error',
          summary: `Error processing schedule "${schedule.name}": ${error instanceof Error ? error.message : String(error)}`,
          details: { scheduleId: schedule.id, scheduleName: schedule.name },
        }).catch(err => deadLetterService.capture('agent.activity_log', {}, err));
      }
    }

    // --- 2. Budget ---
    try {
      const budgetAlerts = await runBudgetBurnRateAgent(project, activityLog);
      pStats.budgetAlertsCreated += budgetAlerts;
      if (budgetAlerts > 0) {
        const pFlags = projectAgentFlags.get(project.id);
        if (pFlags) { pFlags.flags.budgetOverrun = true; pFlags.details.budgetBurnRate = 'Budget alert triggered'; }
      }
    } catch (error) {
      logger.error(`[Agent:Budget] Error for project ${project.id} (${project.name}):`, error);
      await activityLog.log({ projectId: project.id, agentName: 'budget', result: 'error', summary: `Error: ${error instanceof Error ? error.message : String(error)}` }).catch(err => deadLetterService.capture('agent.activity_log', {}, err));
    }

    // --- 3. Schedule risk (Monte Carlo) ---
    try {
      const mcAlerts = await runMonteCarloConfidenceAgent(project, schedules, activityLog);
      pStats.mcAlertsCreated += mcAlerts;
      if (mcAlerts > 0) {
        const pFlags = projectAgentFlags.get(project.id);
        if (pFlags) { pFlags.flags.scheduleRisk = true; pFlags.details.scheduleRisk = 'Monte Carlo finish past the plan end'; }
      }
    } catch (error) {
      logger.error(`[Agent:MonteCarlo] Error for project ${project.id} (${project.name}):`, error);
      await activityLog.log({ projectId: project.id, agentName: 'monte_carlo', result: 'error', summary: `Error: ${error instanceof Error ? error.message : String(error)}` }).catch(err => deadLetterService.capture('agent.activity_log', {}, err));
    }

    // Store aggregate scan results for inter-agent collaboration
    const pFlags = projectAgentFlags.get(project.id);
    storeScanResult('scan_orchestrator', project.id, {
      summary: 'per_project_scan',
      flags: pFlags?.flags || {},
      details: pFlags?.details || {},
      stats: {
        delays: pStats.delaysDetected,
        budgetAlerts: pStats.budgetAlertsCreated,
        scheduleRiskAlerts: pStats.mcAlertsCreated,
      },
    });

    return pStats;
  });

  const projectResults = await parallelLimit(projectTasks, PROJECT_CONCURRENCY);

  // Merge per-project stats into aggregate
  for (const pStats of projectResults) {
    for (const k of Object.keys(stats) as Array<keyof ScanStats>) stats[k] += pStats[k];
  }

  logger.info('[Agent] Scan complete:', stats);
  webhookService.dispatch('agent.scan_completed', { stats }, undefined);
  return stats;
  } finally {
    scansInProgress.delete(key);
  }
}
