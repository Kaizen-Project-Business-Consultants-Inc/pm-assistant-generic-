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

export async function extractLessons(
  projectId: string,
  persistLesson: (lesson: LessonLearned) => Promise<void>,
  createdBy?: number,
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
  const scheduleData: Array<{ scheduleName: string; tasks: any[] }> = schedules.map(schedule => ({
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
    null,
    2,
  );

  const scheduleDataStr = JSON.stringify(scheduleData, null, 2);
  const raidDataStr = raidData.length > 0 ? `Risks & issues (RAID log):\n${JSON.stringify(raidData, null, 2)}` : '';

  if (config.AI_ENABLED && claudeService.isAvailable()) {
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
      });

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
        confidence: l.confidence,
        status: 'draft' as const,
        createdBy: createdBy ?? null,
        sourceType: 'ai_extracted' as const,
        tags: null,
        appliedCount: 0,
        effectivenessRating: null,
        createdAt: new Date().toISOString(),
      }));

      for (const lesson of newLessons) {
        await persistLesson(lesson);
      }

      return newLessons;
    } catch {
      // Fall through to deterministic extraction
    }
  }

  return extractLessonsDeterministic(project, scheduleData, persistLesson, createdBy);
}

/** Creates a deterministic lesson with new fields pre-filled */
function makeDeterministicLesson(
  base: { id: string; projectId: string; projectName: string; projectType: string; category: LessonLearned['category']; title: string; description: string; impact: LessonLearned['impact']; recommendation: string; confidence: number },
  createdBy?: number,
): LessonLearned {
  return {
    ...base,
    status: 'draft',
    createdBy: createdBy ?? null,
    sourceType: 'ai_extracted',
    tags: null,
    appliedCount: 0,
    effectivenessRating: null,
    createdAt: new Date().toISOString(),
  };
}

async function extractLessonsDeterministic(
  project: { id: string; name: string; projectType: string; budgetAllocated?: number; budgetSpent: number; startDate?: string; endDate?: string; status: string },
  scheduleData: Array<{ scheduleName: string; tasks: any[] }>,
  persistLesson: (lesson: LessonLearned) => Promise<void>,
  createdBy?: number,
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
      (t: any) => t.status !== 'completed' && t.dueDate && new Date(t.dueDate) < new Date(),
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

  for (const lesson of newLessons) {
    await persistLesson(lesson);
  }

  return newLessons;
}
