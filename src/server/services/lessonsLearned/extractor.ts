import { claudeService } from '../claudeService';
import { projectService } from '../ProjectService';
import { scheduleService } from '../ScheduleService';
import { riskService } from '../RiskService';
import { config } from '../../config';
import {
  LessonsExtractionAISchema,
  type LessonLearned,
} from '../../schemas/lessonsLearnedSchemas';
import { lessonsExtractionPrompt } from './prompts';
// NOTE: compares calendar days against today in UTC. These are sync helpers with no
// project in scope, so they do not yet use the project's status date
// (services/StatusDateService.ts). Still correct in the way that mattered: something due
// today is no longer 'late' from the previous evening.
import { isOverdue } from '../../utils/calendarDate';
import { limitGrouped } from '../aiToolLimits';

/** Most tasks put in the extraction prompt (it was every task, pretty-printed — audit 2026-10-10 L3) */
const LESSON_PROMPT_TASK_LIMIT = 300;

export async function extractLessons(
  projectId: string,
  persistLessons: (lessons: LessonLearned[]) => Promise<void>,
  createdBy?: string,
  /** Whose AI budget pays; null = no one to bill, so rules only. Undefined = the request's user. */
  billTo?: string | null,
): Promise<LessonLearned[]> {
  const project = await projectService.findById(projectId);
  if (!project) {
    throw new Error(`Project ${projectId} not found`);
  }

  const schedules = await scheduleService.findByProjectId(projectId);
  const allTasks = await scheduleService.findTasksByScheduleIds(schedules.map(s => s.id));
  const tasksBySchedule = new Map<string, typeof allTasks>();
  for (const t of allTasks) {
    const list = tasksBySchedule.get(t.scheduleId) ?? [];
    list.push(t);
    tasksBySchedule.set(t.scheduleId, list);
  }
  const scheduleData: Array<{ scheduleName: string; tasks: any[] }> = schedules.map((schedule) => ({
    scheduleName: schedule.name,
    tasks: (tasksBySchedule.get(schedule.id) ?? []).map((t) => ({
      name: t.name,
      status: t.status,
      priority: t.priority,
      progress: t.progressPercentage ?? 0,
      startDate: t.startDate ?? null,
      endDate: t.endDate ?? null,
      dueDate: t.dueDate ?? null,
      dependency: t.dependency ?? null,
      dependencies: t.dependencies.map(d => ({ id: d.dependencyId, type: d.dependencyType, lag: d.lagDays })),
    })),
  }));
  // The AI sees at most LESSON_PROMPT_TASK_LIMIT of them; the rules-based fallback uses all
  const shownPerPlan = limitGrouped(scheduleData.map((sd) => sd.tasks), LESSON_PROMPT_TASK_LIMIT);
  const promptScheduleData = scheduleData.map((sd, i) => ({ scheduleName: sd.scheduleName, taskCount: sd.tasks.length, tasks: shownPerPlan[i] }));

  // Fetch RAID items (risks + issues) for richer extraction
  let raidData: any[] = [];
  try {
    const raidItems = await riskService.findByProject(projectId);
    raidData = raidItems
      .filter(r => r.type === 'risk' || r.type === 'issue')
      .slice(0, 20) // cap to avoid huge prompts
      .map(r => ({
        type: r.type,
        title: r.title,
        status: r.status,
        severity: r.severity,
        category: r.category,
        mitigationPlan: r.mitigationPlan ?? null,
        responsePlan: r.responsePlan ?? null,
        rootCause: r.rootCause ?? null,
      }));
  } catch {
    // RAID data is optional — extraction still works without it
  }

  const projectDataStr = JSON.stringify(
    {
      name: project.name,
      type: project.projectType,
      status: project.status,
      priority: project.priority,
      budgetAllocated: project.budgetAllocated,
      budgetSpent: project.budgetSpent,
      startDate: project.startDate ?? null,
      endDate: project.endDate ?? null,
    },
  );

  const scheduleDataStr = JSON.stringify(promptScheduleData)
    + (allTasks.length > LESSON_PROMPT_TASK_LIMIT ? `\n(${LESSON_PROMPT_TASK_LIMIT} of ${allTasks.length} tasks shown; taskCount gives each plan's total)` : '');
  const raidDataStr = raidData.length > 0 ? `Risks & issues (RAID log):\n${JSON.stringify(raidData)}` : '';

  if (billTo !== null && config.AI_ENABLED && claudeService.isAvailable()) {
    try {
      const systemPrompt = lessonsExtractionPrompt.render({
        projectData: projectDataStr,
        scheduleData: scheduleDataStr,
        raidData: raidDataStr,
      });

      const result = await claudeService.completeWithJsonSchema({
        systemPrompt,
        userMessage: 'Extract lessons learned from this project data and return the JSON.',
        schema: LessonsExtractionAISchema,
        maxTokens: 4096,
        ...(billTo ? { userId: billTo } : {}),
      });

      // Build source artifacts from the extraction context
      const sourceArtifacts: Array<{ type: string; id: string }> = [
        { type: 'project', id: projectId },
      ];
      for (const s of schedules) {
        sourceArtifacts.push({ type: 'schedule', id: s.id });
      }
      for (const r of raidData) {
        if (r.type && r.title) sourceArtifacts.push({ type: r.type, id: r.title });
      }

      const newLessons: LessonLearned[] = result.data.lessons.map((l, i) => ({
        id: `ll-${projectId}-${Date.now()}-${i}`,
        projectId,
        projectName: project.name,
        projectType: project.projectType,
        category: l.category,
        title: l.title,
        description: l.description,
        impact: l.impact,
        recommendation: l.recommendation,
        rootCause: l.rootCause ?? null,
        severity: l.severity ?? null,
        recurrenceScore: 0,
        isElevated: false,
        sourceArtifacts,
        confidence: l.confidence,
        status: 'draft' as const,
        createdBy: createdBy ?? null,
        sourceType: 'ai_extracted' as const,
        tags: null,
        appliedCount: 0,
        effectivenessRating: null,
        helpfulCount: 0,
        dismissedCount: 0,
        createdAt: new Date().toISOString(),
      }));

      await persistLessons(newLessons);

      return newLessons;
    } catch {
      // Fall through to deterministic extraction
    }
  }

  return extractLessonsDeterministic(project, scheduleData, persistLessons, createdBy);
}

/** Creates a deterministic lesson with new fields pre-filled */
function makeDeterministicLesson(
  base: { id: string; projectId: string; projectName: string; projectType: string; category: LessonLearned['category']; title: string; description: string; impact: LessonLearned['impact']; recommendation: string; confidence: number },
  createdBy?: string,
): LessonLearned {
  return {
    ...base,
    rootCause: null,
    severity: null,
    recurrenceScore: 0,
    isElevated: false,
    sourceArtifacts: null,
    status: 'draft',
    createdBy: createdBy ?? null,
    sourceType: 'ai_extracted',
    tags: null,
    appliedCount: 0,
    effectivenessRating: null,
    helpfulCount: 0,
    dismissedCount: 0,
    createdAt: new Date().toISOString(),
  };
}

async function extractLessonsDeterministic(
  project: { id: string; name: string; projectType: string; budgetAllocated?: number; budgetSpent: number; startDate?: string; endDate?: string; status: string },
  scheduleData: Array<{ scheduleName: string; tasks: any[] }>,
  persistLessons: (lessons: LessonLearned[]) => Promise<void>,
  createdBy?: string,
): Promise<LessonLearned[]> {
  const newLessons: LessonLearned[] = [];
  const allTasks = scheduleData.flatMap((s) => s.tasks);
  const totalTasks = allTasks.length;
  const completedTasks = allTasks.filter((t: any) => t.status === 'completed').length;
  const completionRate = totalTasks > 0 ? (completedTasks / totalTasks) * 100 : 0;

  const budgetAllocated = project.budgetAllocated || 0;
  const budgetUtilization = budgetAllocated > 0 ? (project.budgetSpent / budgetAllocated) * 100 : 0;

  let counter = 0;

  if (budgetUtilization > 90) {
    newLessons.push(makeDeterministicLesson({
      id: `ll-${project.id}-det-${++counter}`,
      projectId: project.id, projectName: project.name, projectType: project.projectType,
      category: 'budget',
      title: 'Budget nearing or exceeding limit',
      description: `Budget utilization is at ${Math.round(budgetUtilization)}%. This project requires close budget monitoring.`,
      impact: budgetUtilization > 100 ? 'negative' : 'neutral',
      recommendation: 'Implement weekly budget reviews and stricter change control processes.',
      confidence: 70,
    }, createdBy));
  }

  if (totalTasks > 0) {
    const overdueTasks = allTasks.filter(
      (t: any) => t.status !== 'completed' && t.dueDate && isOverdue(t.dueDate),
    );
    if (overdueTasks.length > 0) {
      newLessons.push(makeDeterministicLesson({
        id: `ll-${project.id}-det-${++counter}`,
        projectId: project.id, projectName: project.name, projectType: project.projectType,
        category: 'schedule',
        title: 'Overdue tasks detected',
        description: `${overdueTasks.length} task(s) are past their due dates. This may cascade to downstream activities.`,
        impact: 'negative',
        recommendation: 'Prioritize overdue tasks and review dependency chains for cascading delays.',
        confidence: 75,
      }, createdBy));
    }
  }

  if (completionRate > 70 && budgetUtilization < 80) {
    newLessons.push(makeDeterministicLesson({
      id: `ll-${project.id}-det-${++counter}`,
      projectId: project.id, projectName: project.name, projectType: project.projectType,
      category: 'quality',
      title: 'Good progress-to-budget ratio',
      description: `Project is ${Math.round(completionRate)}% complete while only ${Math.round(budgetUtilization)}% of the budget has been utilized.`,
      impact: 'positive',
      recommendation: 'Document current management approach as a best practice for similar projects.',
      confidence: 65,
    }, createdBy));
  }

  if (newLessons.length === 0) {
    newLessons.push(makeDeterministicLesson({
      id: `ll-${project.id}-det-${++counter}`,
      projectId: project.id, projectName: project.name, projectType: project.projectType,
      category: 'communication',
      title: 'General project status review',
      description: `Project "${project.name}" (${project.projectType}) is in ${project.status} status with ${totalTasks} tasks (${Math.round(completionRate)}% complete).`,
      impact: 'neutral',
      recommendation: 'Continue regular status reporting and stakeholder communication.',
      confidence: 50,
    }, createdBy));
  }

  await persistLessons(newLessons);

  return newLessons;
}
