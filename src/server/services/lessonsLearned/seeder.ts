import { databaseService } from '../../database/connection';
import { projectService } from '../ProjectService';
import { scheduleService } from '../ScheduleService';
import { type LessonLearned } from '../../schemas/lessonsLearnedSchemas';

/** Creates a seed lesson with common fields pre-filled */
function seedLesson(base: Omit<LessonLearned, 'status' | 'sourceType' | 'createdBy' | 'tags' | 'appliedCount' | 'effectivenessRating'>): LessonLearned {
  return { ...base, status: 'approved', sourceType: 'seeded', createdBy: null, tags: null, appliedCount: 0, effectivenessRating: null };
}

export async function seedFromProjects(persistLesson: (lesson: LessonLearned) => Promise<void>): Promise<number> {
  const existing = await databaseService.query<{ cnt: number }>(
    'SELECT COUNT(*) as cnt FROM lessons_learned WHERE id LIKE ?',
    ['ll-seed-%'],
  );
  if (existing[0]?.cnt > 0) {
    return 0;
  }

  const projects = await projectService.findAll();
  const allSchedules = await scheduleService.findByProjectIds(projects.map(p => p.id));
  const allTasks = await scheduleService.findTasksByScheduleIds(allSchedules.map(s => s.id));

  // Group schedules and tasks by project
  const schedulesByProject = new Map<string, typeof allSchedules>();
  for (const s of allSchedules) {
    const list = schedulesByProject.get(s.projectId) ?? [];
    list.push(s);
    schedulesByProject.set(s.projectId, list);
  }
  const tasksBySchedule = new Map<string, typeof allTasks>();
  for (const t of allTasks) {
    const list = tasksBySchedule.get(t.scheduleId) ?? [];
    list.push(t);
    tasksBySchedule.set(t.scheduleId, list);
  }

  const seededLessons: LessonLearned[] = [];
  let counter = 0;

  for (const project of projects) {
    const schedules = schedulesByProject.get(project.id) ?? [];
    const projectTasks = schedules.flatMap(s => tasksBySchedule.get(s.id) ?? []);

    const totalTasks = projectTasks.length;
    const completedTasks = projectTasks.filter((t) => t.status === 'completed').length;
    const overdueTasks = projectTasks.filter(
      (t) => t.status !== 'completed' && t.dueDate && new Date(t.dueDate) < new Date(),
    ).length;
    const completionRate = totalTasks > 0 ? (completedTasks / totalTasks) * 100 : 0;

    const budgetAllocated = project.budgetAllocated || 0;
    const budgetSpent = project.budgetSpent || 0;
    const budgetUtilization = budgetAllocated > 0 ? (budgetSpent / budgetAllocated) * 100 : 0;

    // Schedule variance analysis
    if (project.startDate && project.endDate) {
      const now = new Date();
      const totalDuration = new Date(project.endDate).getTime() - new Date(project.startDate).getTime();
      const elapsed = Math.max(0, now.getTime() - new Date(project.startDate).getTime());
      const expectedPercent = totalDuration > 0 ? Math.min(100, (elapsed / totalDuration) * 100) : 0;
      const scheduleVariance = completionRate - expectedPercent;

      if (scheduleVariance < -15) {
        seededLessons.push(seedLesson({
          id: `ll-seed-${++counter}`,
          projectId: project.id, projectName: project.name, projectType: project.projectType,
          category: 'schedule',
          title: 'Significant schedule delay detected',
          description: `Project is ${Math.abs(Math.round(scheduleVariance))}% behind the expected completion rate. Completion is at ${Math.round(completionRate)}% while ${Math.round(expectedPercent)}% was expected by this point.`,
          impact: 'negative',
          recommendation: 'Review critical path tasks and consider adding resources or re-negotiating timelines. Implement more frequent schedule check-ins.',
          confidence: 75,
          createdAt: new Date().toISOString(),
        }));
      } else if (scheduleVariance > 10) {
        seededLessons.push(seedLesson({
          id: `ll-seed-${++counter}`,
          projectId: project.id, projectName: project.name, projectType: project.projectType,
          category: 'schedule',
          title: 'Project ahead of schedule',
          description: `Project is ${Math.round(scheduleVariance)}% ahead of the expected completion rate. Good scheduling practices are in effect.`,
          impact: 'positive',
          recommendation: 'Document the scheduling approach and resource allocation strategy for reuse on future projects.',
          confidence: 80,
          createdAt: new Date().toISOString(),
        }));
      }
    }

    // Budget analysis
    if (budgetAllocated > 0) {
      if (budgetUtilization > 100) {
        seededLessons.push(seedLesson({
          id: `ll-seed-${++counter}`,
          projectId: project.id, projectName: project.name, projectType: project.projectType,
          category: 'budget',
          title: 'Budget overrun detected',
          description: `Budget utilization at ${Math.round(budgetUtilization)}%. Spent $${budgetSpent.toLocaleString()} of $${budgetAllocated.toLocaleString()} allocated.`,
          impact: 'negative',
          recommendation: 'Conduct a budget review to identify cost drivers. Implement tighter change control and consider contingency reserves for future projects.',
          confidence: 85,
          createdAt: new Date().toISOString(),
        }));
      } else if (budgetUtilization < 50 && completionRate > 60) {
        seededLessons.push(seedLesson({
          id: `ll-seed-${++counter}`,
          projectId: project.id, projectName: project.name, projectType: project.projectType,
          category: 'budget',
          title: 'Strong cost performance',
          description: `Project is ${Math.round(completionRate)}% complete while only using ${Math.round(budgetUtilization)}% of the budget. Effective cost management observed.`,
          impact: 'positive',
          recommendation: 'Document cost management practices and procurement strategies for organizational knowledge base.',
          confidence: 80,
          createdAt: new Date().toISOString(),
        }));
      }
    }

    // Overdue tasks analysis
    if (overdueTasks > 0 && totalTasks > 0) {
      const overdueRatio = overdueTasks / totalTasks;
      if (overdueRatio > 0.2) {
        seededLessons.push(seedLesson({
          id: `ll-seed-${++counter}`,
          projectId: project.id, projectName: project.name, projectType: project.projectType,
          category: 'resource',
          title: 'High rate of overdue tasks',
          description: `${overdueTasks} out of ${totalTasks} tasks (${Math.round(overdueRatio * 100)}%) are overdue. This suggests resource bottlenecks or estimation issues.`,
          impact: 'negative',
          recommendation: 'Review task estimation accuracy and resource allocation. Consider breaking large tasks into smaller increments with more frequent checkpoints.',
          confidence: 70,
          createdAt: new Date().toISOString(),
        }));
      }
    }

    // Task completion quality analysis
    if (completedTasks > 0 && totalTasks > 5) {
      seededLessons.push(seedLesson({
        id: `ll-seed-${++counter}`,
        projectId: project.id, projectName: project.name, projectType: project.projectType,
        category: 'quality',
        title: `Task completion progress on ${project.projectType} project`,
        description: `${completedTasks} of ${totalTasks} tasks completed (${Math.round(completionRate)}%). Project type: ${project.projectType}.`,
        impact: completionRate > 50 ? 'positive' : 'neutral',
        recommendation: completionRate > 50
          ? 'Maintain current work practices and team coordination.'
          : 'Consider reviewing task prioritization and team workload balance.',
        confidence: 65,
        createdAt: new Date().toISOString(),
      }));
    }
  }

  for (const lesson of seededLessons) {
    await persistLesson(lesson);
  }

  return seededLessons.length;
}
