import { scheduleService, Task } from './ScheduleService';
import { criticalPathService, CriticalPathResult, CPMTaskResult } from './CriticalPathService';
import { taskAssignmentService, TaskAssignment } from './TaskAssignmentService';
import { resourceService, Resource } from './ResourceService';
import { projectService, Project } from './ProjectService';
import { evmForecastService } from './EVMForecastService';
import { claudeService } from './claudeService';
import logger from '../utils/logger';

// ---------------------------------------------------------------------------
// Interfaces
// ---------------------------------------------------------------------------

export interface StructuralRisk {
  category: 'schedule' | 'resource' | 'dependency' | 'milestone' | 'budget';
  severity: 'critical' | 'high' | 'medium' | 'low';
  riskStatement: string;
  impactedElement: string;
  earlyWarningIndicators: string[];
  suggestedMitigation: string;
}

export interface StrategicRiskAnalysisResult {
  projectId: string;
  projectName: string;
  scanDate: string;
  categories: {
    schedule: StructuralRisk[];
    resource: StructuralRisk[];
    dependency: StructuralRisk[];
    milestone: StructuralRisk[];
    budget: StructuralRisk[];
  };
  summary: { totalRisks: number; bySeverity: Record<string, number>; aiEnhanced: boolean };
  crossCategoryInsights?: string[];
}

// ---------------------------------------------------------------------------
// Algorithmic Detectors
// ---------------------------------------------------------------------------

function detectScheduleRisks(tasks: Task[], cpm: CriticalPathResult | null): StructuralRisk[] {
  const risks: StructuralRisk[] = [];
  const now = new Date();

  if (!cpm || cpm.tasks.length === 0) return risks;

  const cpmMap = new Map<string, CPMTaskResult>();
  for (const ct of cpm.tasks) cpmMap.set(ct.taskId, ct);

  const activeTasks = tasks.filter(t => t.status !== 'completed' && t.status !== 'cancelled');
  const criticalTasks = activeTasks.filter(t => cpmMap.get(t.id)?.isCritical);

  // Zero-float tasks at risk (past due or stalled)
  const atRiskCritical: Task[] = [];
  for (const t of criticalTasks) {
    const pastDue = t.endDate && new Date(t.endDate) < now && t.status !== 'completed';
    const stalled = t.status === 'in_progress' && t.progressPercentage != null && t.progressPercentage < 20
      && t.startDate && (now.getTime() - new Date(t.startDate).getTime()) > 7 * 86_400_000;
    if (pastDue || stalled) atRiskCritical.push(t);
  }

  const criticalPct = criticalTasks.length > 0 ? (atRiskCritical.length / criticalTasks.length) * 100 : 0;
  if (atRiskCritical.length > 0) {
    const severity = criticalPct > 30 ? 'critical' : criticalPct > 15 ? 'high' : 'medium';
    risks.push({
      category: 'schedule',
      severity,
      riskStatement: `${atRiskCritical.length} critical-path task(s) are past due or stalled (${criticalPct.toFixed(0)}% of critical tasks).`,
      impactedElement: atRiskCritical.slice(0, 3).map(t => t.name).join(', '),
      earlyWarningIndicators: ['Tasks past their end date', 'In-progress tasks with < 20% progress after 7+ days'],
      suggestedMitigation: 'Fast-track or crash critical-path activities. Re-sequence non-critical work to free resources.',
    });
  }

  // Long-duration tasks (>15 days)
  const longTasks = activeTasks.filter(t => {
    const dur = t.estimatedDays ?? (t.startDate && t.endDate
      ? Math.round((new Date(t.endDate).getTime() - new Date(t.startDate).getTime()) / 86_400_000)
      : 0);
    return dur > 15;
  });
  if (longTasks.length > 0) {
    risks.push({
      category: 'schedule',
      severity: longTasks.some(t => cpmMap.get(t.id)?.isCritical) ? 'high' : 'medium',
      riskStatement: `${longTasks.length} task(s) exceed 15-day duration — higher estimation uncertainty.`,
      impactedElement: longTasks.slice(0, 3).map(t => t.name).join(', '),
      earlyWarningIndicators: ['Tasks with duration > 15 days are harder to track and estimate'],
      suggestedMitigation: 'Decompose long tasks into smaller work packages (5-10 day durations).',
    });
  }

  return risks;
}

function detectResourceRisks(
  tasks: Task[],
  assignmentMap: Map<string, TaskAssignment[]>,
  resources: Resource[],
  cpm: CriticalPathResult | null,
): StructuralRisk[] {
  const risks: StructuralRisk[] = [];
  const cpmMap = new Map<string, CPMTaskResult>();
  if (cpm) for (const ct of cpm.tasks) cpmMap.set(ct.taskId, ct);

  const activeTasks = tasks.filter(t => t.status !== 'completed' && t.status !== 'cancelled');
  const criticalTaskIds = new Set(cpm?.criticalPathTaskIds ?? []);

  // Unassigned critical tasks
  const unassignedCritical = activeTasks.filter(t =>
    criticalTaskIds.has(t.id) && (!assignmentMap.get(t.id) || assignmentMap.get(t.id)!.length === 0)
  );
  if (unassignedCritical.length > 0) {
    risks.push({
      category: 'resource',
      severity: 'critical',
      riskStatement: `${unassignedCritical.length} critical-path task(s) have no resource assigned.`,
      impactedElement: unassignedCritical.slice(0, 3).map(t => t.name).join(', '),
      earlyWarningIndicators: ['Critical tasks without resource assignments', 'No accountability for delivery'],
      suggestedMitigation: 'Assign resources to all critical-path tasks immediately. Prioritize by float.',
    });
  }

  // Single-resource critical tasks (bus factor = 1)
  const singleResourceCritical = activeTasks.filter(t => {
    const assignments = assignmentMap.get(t.id) || [];
    return criticalTaskIds.has(t.id) && assignments.length === 1;
  });
  if (singleResourceCritical.length > 0) {
    risks.push({
      category: 'resource',
      severity: 'high',
      riskStatement: `${singleResourceCritical.length} critical-path task(s) depend on a single resource (bus-factor risk).`,
      impactedElement: singleResourceCritical.slice(0, 3).map(t => t.name).join(', '),
      earlyWarningIndicators: ['Single point of failure on critical path', 'No backup if resource is unavailable'],
      suggestedMitigation: 'Cross-train team members or assign backup resources to critical single-resource tasks.',
    });
  }

  // Over-allocated resources (>120%)
  const resourceAllocation = new Map<string, number>();
  for (const [, assignments] of assignmentMap) {
    for (const a of assignments) {
      resourceAllocation.set(a.resourceId, (resourceAllocation.get(a.resourceId) || 0) + a.allocationPct);
    }
  }
  const overAllocated = resources.filter(r => (resourceAllocation.get(r.id) || 0) > 120);
  if (overAllocated.length > 0) {
    risks.push({
      category: 'resource',
      severity: 'high',
      riskStatement: `${overAllocated.length} resource(s) are allocated above 120%.`,
      impactedElement: overAllocated.slice(0, 3).map(r => r.name).join(', '),
      earlyWarningIndicators: ['Allocation exceeds capacity', 'Burnout risk', 'Schedule slip from multitasking'],
      suggestedMitigation: 'Level resources by redistributing work or adjusting timelines. Consider adding capacity.',
    });
  }

  return risks;
}

function detectDependencyRisks(tasks: Task[], cpm: CriticalPathResult | null): StructuralRisk[] {
  const risks: StructuralRisk[] = [];
  if (!cpm || tasks.length === 0) return risks;

  const cpmMap = new Map<string, CPMTaskResult>();
  for (const ct of cpm.tasks) cpmMap.set(ct.taskId, ct);
  const taskMap = new Map<string, Task>();
  for (const t of tasks) taskMap.set(t.id, t);

  // Build successor map for dependency chain analysis
  const successors = new Map<string, string[]>();
  const predecessorCount = new Map<string, number>();
  for (const t of tasks) {
    for (const dep of t.dependencies) {
      const succ = successors.get(dep.dependencyId) || [];
      succ.push(t.id);
      successors.set(dep.dependencyId, succ);
      predecessorCount.set(t.id, (predecessorCount.get(t.id) || 0) + 1);
    }
  }

  // Bottleneck tasks (3+ dependents)
  const bottlenecks: { task: Task; dependentCount: number }[] = [];
  for (const [taskId, succs] of successors) {
    if (succs.length >= 3) {
      const task = taskMap.get(taskId);
      if (task && task.status !== 'completed' && task.status !== 'cancelled') {
        bottlenecks.push({ task, dependentCount: succs.length });
      }
    }
  }
  if (bottlenecks.length > 0) {
    const worst = bottlenecks.sort((a, b) => b.dependentCount - a.dependentCount)[0];
    const severity = worst.dependentCount >= 5 ? 'critical' : 'high';
    risks.push({
      category: 'dependency',
      severity,
      riskStatement: `${bottlenecks.length} bottleneck task(s) block 3+ downstream tasks. Worst: "${worst.task.name}" blocks ${worst.dependentCount} tasks.`,
      impactedElement: bottlenecks.slice(0, 3).map(b => b.task.name).join(', '),
      earlyWarningIndicators: ['High fan-out dependencies', 'Single task blocking multiple workstreams'],
      suggestedMitigation: 'De-couple dependencies where possible. Add schedule buffer before bottleneck tasks.',
    });
  }

  // Dependency chain depth
  const depthCache = new Map<string, number>();
  function chainDepth(taskId: string, visited: Set<string> = new Set()): number {
    if (depthCache.has(taskId)) return depthCache.get(taskId)!;
    if (visited.has(taskId)) return 0; // cycle guard
    visited.add(taskId);
    const task = taskMap.get(taskId);
    if (!task || task.dependencies.length === 0) { depthCache.set(taskId, 0); return 0; }
    let maxPredDepth = 0;
    for (const dep of task.dependencies) {
      maxPredDepth = Math.max(maxPredDepth, chainDepth(dep.dependencyId, visited) + 1);
    }
    depthCache.set(taskId, maxPredDepth);
    return maxPredDepth;
  }
  let maxDepth = 0;
  let deepestTask: Task | null = null;
  for (const t of tasks) {
    const d = chainDepth(t.id);
    if (d > maxDepth) { maxDepth = d; deepestTask = t; }
  }
  if (maxDepth > 4 && deepestTask) {
    const severity = maxDepth > 6 ? 'critical' : 'high';
    risks.push({
      category: 'dependency',
      severity,
      riskStatement: `Dependency chain depth is ${maxDepth} levels deep (task: "${deepestTask.name}"). Delays propagate through long chains.`,
      impactedElement: deepestTask.name,
      earlyWarningIndicators: ['Chain depth > 4 levels', 'Cascading delay amplification'],
      suggestedMitigation: 'Identify opportunities to parallelize work. Break sequential chains with intermediate milestones.',
    });
  }

  return risks;
}

function detectMilestoneRisks(tasks: Task[], cpm: CriticalPathResult | null): StructuralRisk[] {
  const risks: StructuralRisk[] = [];
  const milestones = tasks.filter(t => t.isMilestone && t.status !== 'completed' && t.status !== 'cancelled');
  if (milestones.length === 0) return risks;

  const cpmMap = new Map<string, CPMTaskResult>();
  if (cpm) for (const ct of cpm.tasks) cpmMap.set(ct.taskId, ct);

  // Zero-float milestones
  const zeroFloatMilestones = milestones.filter(t => {
    const ct = cpmMap.get(t.id);
    return ct && ct.totalFloat <= 0;
  });
  if (zeroFloatMilestones.length > 0) {
    risks.push({
      category: 'milestone',
      severity: 'high',
      riskStatement: `${zeroFloatMilestones.length} milestone(s) have zero float — any predecessor delay will cause a miss.`,
      impactedElement: zeroFloatMilestones.slice(0, 3).map(t => t.name).join(', '),
      earlyWarningIndicators: ['Milestones on critical path with no buffer', 'Schedule is fully constrained'],
      suggestedMitigation: 'Add buffer tasks before critical milestones. Fast-track predecessor activities.',
    });
  }

  // Back-loaded milestones (>60% in last 25% of timeline)
  const milestoneDates = milestones
    .map(t => t.endDate || t.dueDate || t.startDate)
    .filter(Boolean)
    .map(d => new Date(d!).getTime())
    .sort((a, b) => a - b);

  if (milestoneDates.length >= 3) {
    const earliest = milestoneDates[0];
    const latest = milestoneDates[milestoneDates.length - 1];
    const span = latest - earliest;
    if (span > 0) {
      const cutoff = earliest + span * 0.75;
      const backLoaded = milestoneDates.filter(d => d >= cutoff).length;
      const backLoadedPct = (backLoaded / milestoneDates.length) * 100;
      if (backLoadedPct > 60) {
        const severity = backLoadedPct > 70 ? 'critical' : 'high';
        risks.push({
          category: 'milestone',
          severity,
          riskStatement: `${backLoadedPct.toFixed(0)}% of milestones are clustered in the last 25% of the timeline — back-loaded risk.`,
          impactedElement: `${backLoaded} of ${milestoneDates.length} milestones`,
          earlyWarningIndicators: ['Most milestones near project end', 'Late discovery of problems'],
          suggestedMitigation: 'Redistribute milestones evenly. Add intermediate checkpoints earlier in the schedule.',
        });
      }
    }
  }

  // Milestone clusters (3+ within 5 days)
  const sortedDates = [...milestoneDates];
  for (let i = 0; i < sortedDates.length - 2; i++) {
    const windowEnd = sortedDates[i] + 5 * 86_400_000;
    const inWindow = sortedDates.filter(d => d >= sortedDates[i] && d <= windowEnd).length;
    if (inWindow >= 3) {
      risks.push({
        category: 'milestone',
        severity: 'medium',
        riskStatement: `${inWindow} milestones are clustered within a 5-day window — review capacity and attention bottleneck.`,
        impactedElement: `Cluster around ${new Date(sortedDates[i]).toISOString().slice(0, 10)}`,
        earlyWarningIndicators: ['Multiple milestones competing for attention', 'Resource and stakeholder overload'],
        suggestedMitigation: 'Stagger milestone dates. Ensure distinct owners for each milestone.',
      });
      break; // report only the first cluster
    }
  }

  return risks;
}

function detectBudgetRisks(project: Project, tasks: Task[], evm: any | null): StructuralRisk[] {
  const risks: StructuralRisk[] = [];

  const budget = project.budgetAllocated ?? 0;
  const spent = project.budgetSpent ?? 0;

  // No budget allocated
  if (budget === 0) {
    risks.push({
      category: 'budget',
      severity: 'medium',
      riskStatement: 'No budget has been allocated to this project — cost tracking is not possible.',
      impactedElement: project.name,
      earlyWarningIndicators: ['Budget field is zero or empty'],
      suggestedMitigation: 'Set a baseline budget to enable cost performance monitoring.',
    });
    return risks;
  }

  // Burn rate
  const burnPct = (spent / budget) * 100;
  const activeTasks = tasks.filter(t => t.status !== 'cancelled');
  const completedTasks = activeTasks.filter(t => t.status === 'completed');
  const progressPct = activeTasks.length > 0 ? (completedTasks.length / activeTasks.length) * 100 : 0;

  if (burnPct > progressPct + 20 && burnPct > 30) {
    risks.push({
      category: 'budget',
      severity: burnPct > progressPct + 40 ? 'critical' : 'high',
      riskStatement: `Budget burn (${burnPct.toFixed(0)}%) is ahead of progress (${progressPct.toFixed(0)}%) by ${(burnPct - progressPct).toFixed(0)} percentage points.`,
      impactedElement: project.name,
      earlyWarningIndicators: ['Cost consumption outpacing work completion', 'Potential overrun at completion'],
      suggestedMitigation: 'Review cost drivers. Consider scope reduction or additional funding.',
    });
  }

  // EVM: CPI check
  if (evm?.currentMetrics?.cpi != null) {
    const cpi = evm.currentMetrics.cpi;
    if (cpi < 0.9) {
      const severity = cpi < 0.8 ? 'critical' : 'high';
      risks.push({
        category: 'budget',
        severity,
        riskStatement: `Cost Performance Index (CPI) is ${cpi.toFixed(2)} — the project is getting less value per dollar spent than planned.`,
        impactedElement: project.name,
        earlyWarningIndicators: [`CPI ${cpi.toFixed(2)} < 0.9 threshold`, 'Earned value below actual cost'],
        suggestedMitigation: 'Analyze cost variance sources. Implement corrective actions on highest-cost work packages.',
      });
    }
  }

  // Tasks over budget
  const overBudgetTasks = tasks.filter(t =>
    t.budgetAllocated && t.actualCost && t.actualCost > t.budgetAllocated && t.status !== 'cancelled'
  );
  if (overBudgetTasks.length > 0) {
    risks.push({
      category: 'budget',
      severity: overBudgetTasks.length > 5 ? 'high' : 'medium',
      riskStatement: `${overBudgetTasks.length} task(s) have exceeded their allocated budget.`,
      impactedElement: overBudgetTasks.slice(0, 3).map(t => t.name).join(', '),
      earlyWarningIndicators: ['Individual task costs exceeding estimates'],
      suggestedMitigation: 'Review estimation accuracy. Apply lessons to remaining task estimates.',
    });
  }

  return risks;
}

// ---------------------------------------------------------------------------
// AI Enhancement
// ---------------------------------------------------------------------------

async function enhanceWithAI(result: StrategicRiskAnalysisResult): Promise<StrategicRiskAnalysisResult> {
  if (!claudeService.isAvailable()) return result;

  const allRisks = [
    ...result.categories.schedule,
    ...result.categories.resource,
    ...result.categories.dependency,
    ...result.categories.milestone,
    ...result.categories.budget,
  ];

  if (allRisks.length === 0) return result;

  // Cap at 20 risks for prompt size
  const risksForAI = allRisks.slice(0, 20).map(r => ({
    category: r.category,
    severity: r.severity,
    statement: r.riskStatement,
    element: r.impactedElement,
  }));

  const prompt = `You are a senior project risk analyst. Review the following algorithmically-detected structural risks for the project "${result.projectName}" and:

1. Polish each risk statement to be clearer and more actionable (keep the same meaning).
2. Identify 2-4 cross-category insights — patterns that emerge when looking across schedule, resource, dependency, milestone, and budget risks together.

Return a JSON object with:
- "polishedStatements": array of objects { "index": number (0-based matching input order), "statement": "polished text" }
- "crossCategoryInsights": array of strings (2-4 insights)

Input risks:
${JSON.stringify(risksForAI, null, 2)}

Return ONLY valid JSON.`;

  try {
    const aiResult = await claudeService.complete({
      systemPrompt: 'You are a senior project risk analyst. Return only valid JSON.',
      userMessage: prompt,
      maxTokens: 1500,
      temperature: 0.3,
      responseFormat: 'json',
    });

    const parsed = JSON.parse(aiResult.content);

    // Apply polished statements
    if (Array.isArray(parsed.polishedStatements)) {
      for (const ps of parsed.polishedStatements) {
        if (typeof ps.index === 'number' && typeof ps.statement === 'string' && ps.index < allRisks.length) {
          allRisks[ps.index].riskStatement = ps.statement;
        }
      }
    }

    // Add cross-category insights
    if (Array.isArray(parsed.crossCategoryInsights)) {
      result.crossCategoryInsights = parsed.crossCategoryInsights.filter((s: unknown) => typeof s === 'string').slice(0, 4);
    }

    result.summary.aiEnhanced = true;
  } catch (err: any) {
    logger.warn('AI enhancement for strategic risk scan failed — returning algorithmic results', { error: err.message });
  }

  return result;
}

// ---------------------------------------------------------------------------
// Main Service
// ---------------------------------------------------------------------------

class StrategicRiskAnalysisService {
  async analyze(projectId: string, _userId: string): Promise<StrategicRiskAnalysisResult> {
    const project = await projectService.findById(projectId);
    if (!project) throw new Error(`Project not found: ${projectId}`);

    // Step 1 — Parallel data gathering
    const schedules = await scheduleService.findByProjectId(projectId);
    if (schedules.length === 0) {
      return this.emptyResult(projectId, project.name);
    }

    const primaryScheduleId = schedules[0].id;
    const taskIds = schedules.map(s => s.id);

    const [tasks, cpm, resources, evm] = await Promise.all([
      scheduleService.findTasksByScheduleIds(taskIds),
      criticalPathService.calculateCriticalPath(primaryScheduleId).catch(err => {
        logger.warn('CPM calculation failed for risk scan', { error: err.message, scheduleId: primaryScheduleId });
        return null;
      }),
      resourceService.findAllResources(),
      evmForecastService.generateForecast(projectId).catch(err => {
        logger.warn('EVM forecast failed for risk scan', { error: err.message, projectId });
        return null;
      }),
    ]);

    // Get assignments for all task IDs
    const allTaskIds = tasks.map(t => t.id);
    const assignmentMap = allTaskIds.length > 0
      ? await taskAssignmentService.getForTasks(allTaskIds)
      : new Map<string, TaskAssignment[]>();

    // Step 2 — Run 5 algorithmic detectors
    const scheduleRisks = detectScheduleRisks(tasks, cpm);
    const resourceRisks = detectResourceRisks(tasks, assignmentMap, resources, cpm);
    const dependencyRisks = detectDependencyRisks(tasks, cpm);
    const milestoneRisks = detectMilestoneRisks(tasks, cpm);
    const budgetRisks = detectBudgetRisks(project, tasks, evm);

    const allRisks = [...scheduleRisks, ...resourceRisks, ...dependencyRisks, ...milestoneRisks, ...budgetRisks];
    const bySeverity: Record<string, number> = {};
    for (const r of allRisks) {
      bySeverity[r.severity] = (bySeverity[r.severity] || 0) + 1;
    }

    let result: StrategicRiskAnalysisResult = {
      projectId,
      projectName: project.name,
      scanDate: new Date().toISOString(),
      categories: {
        schedule: scheduleRisks,
        resource: resourceRisks,
        dependency: dependencyRisks,
        milestone: milestoneRisks,
        budget: budgetRisks,
      },
      summary: { totalRisks: allRisks.length, bySeverity, aiEnhanced: false },
    };

    // Step 3 — AI enhancement (optional)
    result = await enhanceWithAI(result);

    return result;
  }

  generateSample(projectId: string): StrategicRiskAnalysisResult {
    return {
      projectId,
      projectName: 'Sample Project',
      scanDate: new Date().toISOString(),
      categories: {
        schedule: [{
          category: 'schedule', severity: 'high',
          riskStatement: '3 critical-path tasks are past due or stalled (25% of critical tasks).',
          impactedElement: 'Foundation Work, Electrical Install',
          earlyWarningIndicators: ['Tasks past their end date'],
          suggestedMitigation: 'Fast-track critical-path activities.',
        }],
        resource: [{
          category: 'resource', severity: 'critical',
          riskStatement: '2 critical-path tasks have no resource assigned.',
          impactedElement: 'HVAC Installation, Plumbing',
          earlyWarningIndicators: ['Critical tasks without assignments'],
          suggestedMitigation: 'Assign resources immediately.',
        }],
        dependency: [],
        milestone: [{
          category: 'milestone', severity: 'medium',
          riskStatement: '70% of milestones are in the last 25% of the timeline.',
          impactedElement: '7 of 10 milestones',
          earlyWarningIndicators: ['Back-loaded milestone distribution'],
          suggestedMitigation: 'Add intermediate checkpoints.',
        }],
        budget: [],
      },
      summary: { totalRisks: 3, bySeverity: { critical: 1, high: 1, medium: 1 }, aiEnhanced: false },
    };
  }

  private emptyResult(projectId: string, projectName: string): StrategicRiskAnalysisResult {
    return {
      projectId,
      projectName,
      scanDate: new Date().toISOString(),
      categories: { schedule: [], resource: [], dependency: [], milestone: [], budget: [] },
      summary: { totalRisks: 0, bySeverity: {}, aiEnhanced: false },
    };
  }
}

export const strategicRiskAnalysisService = new StrategicRiskAnalysisService();

// Export detectors for unit testing
export const _detectors = {
  detectScheduleRisks,
  detectResourceRisks,
  detectDependencyRisks,
  detectMilestoneRisks,
  detectBudgetRisks,
};
