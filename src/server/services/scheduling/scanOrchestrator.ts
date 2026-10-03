import { config } from '../../config';
import { agentRegistry } from '../AgentRegistryService';
import '../agentCapabilities';
import { notificationService } from '../NotificationService';
import { projectService } from '../ProjectService';
import { scheduleService } from '../ScheduleService';
import { AgentActivityLogService } from '../AgentActivityLogService';
import { webhookService } from '../WebhookService';
import { killSwitchService } from '../agents/KillSwitchService';
import { agentMemoryService } from '../AgentMemoryService';
import { deadLetterService } from '../DeadLetterService';
import { ProjectAgentResults } from '../agents/RiskEscalationAgent';
import logger from '../../utils/logger';
import {
  runBudgetBurnRateAgent,
  runMonteCarloConfidenceAgent,
  runMeetingFollowUpAgent,
  runScopeCreepAgent,
} from './registryAgentRunners';
import {
  runBudgetIntelligenceAgent,
  runResourceOptimizationAgent,
  runStakeholderCommunicationAgent,
  runProjectHygieneAgent,
  runDependencyRiskAgent,
  runLessonsLearnedAgent,
  runPredictiveAlertingAgent,
} from './projectAgentRunners';
import {
  runCrossProjectIntelligenceAgent,
  runRiskEscalationAgent,
} from './portfolioAgentRunners';

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
  proposalsGenerated: number;
  notificationsSent: number;
  budgetAlertsCreated: number;
  mcAlertsCreated: number;
  meetingAlertsCreated: number;
  scopeCreepAlertsCreated: number;
  budgetProposalsCreated: number;
  resourceProposalsCreated: number;
  portfolioProposalsCreated: number;
  riskEscalationsCreated: number;
  stakeholderReportsCreated: number;
  hygieneAlertsCreated: number;
  dependencyRiskAlertsCreated: number;
  lessonsExtracted: number;
  predictiveAlertsCreated: number;
}

function emptyStats(): ScanStats {
  return {
    projectsScanned: 0, schedulesScanned: 0, delaysDetected: 0,
    proposalsGenerated: 0, notificationsSent: 0, budgetAlertsCreated: 0,
    mcAlertsCreated: 0, meetingAlertsCreated: 0, scopeCreepAlertsCreated: 0,
    budgetProposalsCreated: 0, resourceProposalsCreated: 0, portfolioProposalsCreated: 0,
    riskEscalationsCreated: 0, stakeholderReportsCreated: 0,
    hygieneAlertsCreated: 0, dependencyRiskAlertsCreated: 0, lessonsExtracted: 0,
    predictiveAlertsCreated: 0,
  };
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

let scanInProgress = false;

export async function runScanImpl(activityLog: AgentActivityLogService, projectId?: string): Promise<ScanStats> {
  if (scanInProgress) {
    logger.warn('[Agent] Scan skipped — previous scan still in progress');
    return emptyStats();
  }
  scanInProgress = true;

  try {
  logger.info(`[Agent] Starting scan...${projectId ? ` (project: ${projectId})` : ''}`);

  const ksStatus = killSwitchService.getStatus();
  if (!ksStatus.globalEnabled) {
    logger.info('[Agent] Scan aborted — global kill switch is active');
    return emptyStats();
  }

  const stats = emptyStats();
  const projectAgentFlags = new Map<string, { name: string; flags: ProjectAgentResults['agentFlags']; details: Record<string, string> }>();
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
      flags: { scheduleDelay: false, budgetOverrun: false, scopeCreep: false, resourceBottleneck: false, meetingOverdue: false },
      details: {},
    });

    const schedules = await scheduleService.findByProjectId(project.id);

    // --- Agent 1: Auto-Reschedule ---
    for (const schedule of schedules) {
      pStats.schedulesScanned++;

      try {
        const ctx = { actorId: 'system' as const, actorType: 'system' as const, source: 'system' as const, projectId: project.id };
        const result = await agentRegistry.invoke('auto-reschedule-v1', { scheduleId: schedule.id, thresholdDays }, ctx);

        if (!result.success) {
          throw new Error(result.error || 'Auto-reschedule agent failed');
        }

        const { delays: significant, proposal } = result.output;
        pStats.delaysDetected += significant.length;

        if (significant.length === 0) {
          await activityLog.log({
            projectId: project.id,
            agentName: 'auto_reschedule',
            result: 'skipped',
            summary: `No significant delays in "${schedule.name}" (threshold: ${thresholdDays}d)`,
            details: { scheduleId: schedule.id, scheduleName: schedule.name, thresholdDays },
          });
          continue;
        }

        logger.info(
          `[Agent] ${project.name} / ${schedule.name}: ${significant.length} significant delay(s)`,
        );

        pStats.proposalsGenerated++;

        const pFlags = projectAgentFlags.get(project.id);
        if (pFlags) {
          pFlags.flags.scheduleDelay = true;
          pFlags.details.scheduleDelay = `${significant.length} delay(s) in "${schedule.name}"`;
        }

        const notifyUserId = project.projectManagerId || project.createdBy;

        await notificationService.create({
          userId: notifyUserId,
          type: 'reschedule_proposal',
          severity: significant.some((d: any) => d.severity === 'critical')
            ? 'critical'
            : significant.some((d: any) => d.severity === 'high')
              ? 'high'
              : 'medium',
          title: `Auto-Reschedule: ${significant.length} delay(s) in "${schedule.name}"`,
          message: `${proposal.proposedChanges.length} date change(s) proposed. Impact: ${proposal.estimatedImpact.daysChange} day(s). Review the proposal to approve or reject.`,
          projectId: project.id,
          scheduleId: schedule.id,
          linkType: 'proposal',
          linkId: proposal.id,
        });
        pStats.notificationsSent++;

        await activityLog.log({
          projectId: project.id,
          agentName: 'auto_reschedule',
          result: 'alert_created',
          summary: `${significant.length} significant delay(s) in "${schedule.name}". ${proposal.proposedChanges.length} change(s) proposed.`,
          details: { scheduleId: schedule.id, scheduleName: schedule.name, significantDelays: significant.length, proposedChanges: proposal.proposedChanges.length, daysImpact: proposal.estimatedImpact.daysChange },
        });
      } catch (error) {
        logger.error(
          `[Agent] Error processing schedule ${schedule.id} (${schedule.name}):`,
          error,
        );
        await activityLog.log({
          projectId: project.id,
          agentName: 'auto_reschedule',
          result: 'error',
          summary: `Error processing schedule "${schedule.name}": ${error instanceof Error ? error.message : String(error)}`,
          details: { scheduleId: schedule.id, scheduleName: schedule.name },
        }).catch(err => deadLetterService.capture('agent.activity_log', {}, err));
      }
    }

    // --- Agent 2: Budget Burn-Rate ---
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

    // --- Agent 3: Monte Carlo Confidence ---
    try {
      const mcAlerts = await runMonteCarloConfidenceAgent(project, schedules, activityLog);
      pStats.mcAlertsCreated += mcAlerts;
    } catch (error) {
      logger.error(`[Agent:MonteCarlo] Error for project ${project.id} (${project.name}):`, error);
      await activityLog.log({ projectId: project.id, agentName: 'monte_carlo', result: 'error', summary: `Error: ${error instanceof Error ? error.message : String(error)}` }).catch(err => deadLetterService.capture('agent.activity_log', {}, err));
    }

    // --- Agent 4: Meeting Follow-Up ---
    try {
      const meetingAlerts = await runMeetingFollowUpAgent(project, activityLog);
      pStats.meetingAlertsCreated += meetingAlerts;
      if (meetingAlerts > 0) {
        const pFlags = projectAgentFlags.get(project.id);
        if (pFlags) { pFlags.flags.meetingOverdue = true; pFlags.details.meetingOverdue = `${meetingAlerts} meeting alert(s)`; }
      }
    } catch (error) {
      logger.error(`[Agent:Meeting] Error for project ${project.id} (${project.name}):`, error);
      await activityLog.log({ projectId: project.id, agentName: 'meeting', result: 'error', summary: `Error: ${error instanceof Error ? error.message : String(error)}` }).catch(err => deadLetterService.capture('agent.activity_log', {}, err));
    }

    // --- Agent 5: Scope Creep Detection ---
    try {
      const scopeAlerts = await runScopeCreepAgent(project, activityLog);
      pStats.scopeCreepAlertsCreated += scopeAlerts;
      if (scopeAlerts > 0) {
        const pFlags = projectAgentFlags.get(project.id);
        if (pFlags) { pFlags.flags.scopeCreep = true; pFlags.details.scopeCreep = 'Scope creep detected'; }
      }
    } catch (error) {
      logger.error(`[Agent:ScopeCreep] Error for project ${project.id} (${project.name}):`, error);
      await activityLog.log({ projectId: project.id, agentName: 'scope_creep', result: 'error', summary: `Error: ${error instanceof Error ? error.message : String(error)}` }).catch(err => deadLetterService.capture('agent.activity_log', {}, err));
    }

    // --- Agent 6: Budget Intelligence ---
    try {
      const budgetProposals = await runBudgetIntelligenceAgent(project, activityLog);
      pStats.budgetProposalsCreated += budgetProposals;
      if (budgetProposals > 0) {
        const pFlags = projectAgentFlags.get(project.id);
        if (pFlags) { pFlags.flags.budgetOverrun = true; pFlags.details.budgetIntelligence = 'Budget intelligence proposal created'; }
      }
    } catch (error) {
      logger.error(`[Agent:BudgetIntelligence] Error for project ${project.id} (${project.name}):`, error);
      await activityLog.log({ projectId: project.id, agentName: 'budget_intelligence', result: 'error', summary: `Error: ${error instanceof Error ? error.message : String(error)}` }).catch(err => deadLetterService.capture('agent.activity_log', {}, err));
    }

    // --- Agent 7: Resource Optimization ---
    try {
      const resourceProposals = await runResourceOptimizationAgent(project, activityLog);
      pStats.resourceProposalsCreated += resourceProposals;
      if (resourceProposals > 0) {
        const pFlags = projectAgentFlags.get(project.id);
        if (pFlags) { pFlags.flags.resourceBottleneck = true; pFlags.details.resourceOptimization = 'Resource optimization proposal created'; }
      }
    } catch (error) {
      logger.error(`[Agent:ResourceOptimization] Error for project ${project.id} (${project.name}):`, error);
      await activityLog.log({ projectId: project.id, agentName: 'resource_optimization', result: 'error', summary: `Error: ${error instanceof Error ? error.message : String(error)}` }).catch(err => deadLetterService.capture('agent.activity_log', {}, err));
    }

    // --- Agent 10: Stakeholder Communication ---
    try {
      const stakeholderReports = await runStakeholderCommunicationAgent(project, activityLog);
      pStats.stakeholderReportsCreated += stakeholderReports;
    } catch (error) {
      logger.error(`[Agent:StakeholderCommunication] Error for project ${project.id} (${project.name}):`, error);
      await activityLog.log({ projectId: project.id, agentName: 'stakeholder_communication', result: 'error', summary: `Error: ${error instanceof Error ? error.message : String(error)}` }).catch(err => deadLetterService.capture('agent.activity_log', {}, err));
    }

    // --- Agent 11: Project Hygiene ---
    try {
      const hygieneAlerts = await runProjectHygieneAgent(project, activityLog);
      pStats.hygieneAlertsCreated += hygieneAlerts;
    } catch (error) {
      logger.error(`[Agent:ProjectHygiene] Error for project ${project.id} (${project.name}):`, error);
      await activityLog.log({ projectId: project.id, agentName: 'project_hygiene', result: 'error', summary: `Error: ${error instanceof Error ? error.message : String(error)}` }).catch(err => deadLetterService.capture('agent.activity_log', {}, err));
    }

    // --- Agent 12: Dependency Risk ---
    try {
      const dependencyAlerts = await runDependencyRiskAgent(project, activityLog);
      pStats.dependencyRiskAlertsCreated += dependencyAlerts;
    } catch (error) {
      logger.error(`[Agent:DependencyRisk] Error for project ${project.id} (${project.name}):`, error);
      await activityLog.log({ projectId: project.id, agentName: 'dependency_risk', result: 'error', summary: `Error: ${error instanceof Error ? error.message : String(error)}` }).catch(err => deadLetterService.capture('agent.activity_log', {}, err));
    }

    // --- Agent 13: Lessons Learned ---
    try {
      const lessons = await runLessonsLearnedAgent(project, activityLog);
      pStats.lessonsExtracted += lessons;
    } catch (error) {
      logger.error(`[Agent:LessonsLearned] Error for project ${project.id} (${project.name}):`, error);
      await activityLog.log({ projectId: project.id, agentName: 'lessons_learned', result: 'error', summary: `Error: ${error instanceof Error ? error.message : String(error)}` }).catch(err => deadLetterService.capture('agent.activity_log', {}, err));
    }

    // --- Agent 14: Predictive Alerting ---
    try {
      const predictiveAlerts = await runPredictiveAlertingAgent(project, activityLog);
      pStats.predictiveAlertsCreated += predictiveAlerts;
    } catch (error) {
      logger.error(`[Agent:PredictiveAlerting] Error for project ${project.id} (${project.name}):`, error);
      await activityLog.log({ projectId: project.id, agentName: 'predictive_alerting', result: 'error', summary: `Error: ${error instanceof Error ? error.message : String(error)}` }).catch(err => deadLetterService.capture('agent.activity_log', {}, err));
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
        scopeCreep: pStats.scopeCreepAlertsCreated,
        hygieneAlerts: pStats.hygieneAlertsCreated,
        predictiveAlerts: pStats.predictiveAlertsCreated,
      },
    });

    return pStats;
  });

  const projectResults = await parallelLimit(projectTasks, PROJECT_CONCURRENCY);

  // Merge per-project stats into aggregate
  for (const pStats of projectResults) {
    stats.projectsScanned += pStats.projectsScanned;
    stats.schedulesScanned += pStats.schedulesScanned;
    stats.delaysDetected += pStats.delaysDetected;
    stats.proposalsGenerated += pStats.proposalsGenerated;
    stats.notificationsSent += pStats.notificationsSent;
    stats.budgetAlertsCreated += pStats.budgetAlertsCreated;
    stats.mcAlertsCreated += pStats.mcAlertsCreated;
    stats.meetingAlertsCreated += pStats.meetingAlertsCreated;
    stats.scopeCreepAlertsCreated += pStats.scopeCreepAlertsCreated;
    stats.budgetProposalsCreated += pStats.budgetProposalsCreated;
    stats.resourceProposalsCreated += pStats.resourceProposalsCreated;
    stats.stakeholderReportsCreated += pStats.stakeholderReportsCreated;
    stats.hygieneAlertsCreated += pStats.hygieneAlertsCreated;
    stats.dependencyRiskAlertsCreated += pStats.dependencyRiskAlertsCreated;
    stats.lessonsExtracted += pStats.lessonsExtracted;
    stats.predictiveAlertsCreated += pStats.predictiveAlertsCreated;
  }

  // --- Portfolio-level agents (skip for single-project scans) ---
  if (!projectId) {
    // --- Agent 8: Cross-Project Intelligence (portfolio-level) ---
    try {
      const portfolioProposals = await runCrossProjectIntelligenceAgent(projects, activityLog);
      stats.portfolioProposalsCreated += portfolioProposals;
    } catch (error) {
      logger.error('[Agent:CrossProjectIntelligence] Error:', error);
      await activityLog.log({
        projectId: 'portfolio',
        agentName: 'cross_project_intelligence',
        result: 'error',
        summary: `Error: ${error instanceof Error ? error.message : String(error)}`,
      }).catch(err => deadLetterService.capture('agent.activity_log', {}, err));
    }

    // --- Agent 9: Risk Escalation (runs last) ---
    try {
      const riskEscalations = await runRiskEscalationAgent(projects, projectAgentFlags, activityLog);
      stats.riskEscalationsCreated += riskEscalations;
    } catch (error) {
      logger.error('[Agent:RiskEscalation] Error:', error);
      await activityLog.log({
        projectId: 'portfolio',
        agentName: 'risk_escalation',
        result: 'error',
        summary: `Error: ${error instanceof Error ? error.message : String(error)}`,
      }).catch(err => deadLetterService.capture('agent.activity_log', {}, err));
    }
  }

  logger.info('[Agent] Scan complete:', stats);
  webhookService.dispatch('agent.scan_completed', { stats }, undefined);
  return stats;
  } finally {
    scanInProgress = false;
  }
}
