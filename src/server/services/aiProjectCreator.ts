import { FastifyInstance } from 'fastify';
import { ClaudeTaskBreakdownService } from './aiTaskBreakdownClaude';
import { ProjectService, Project } from './ProjectService';
import { ScheduleService, Schedule, Task } from './ScheduleService';
import { ProjectAnalysis } from './aiTaskBreakdown';
import { logAIUsage } from './aiUsageLogger';
import { weekdaysOnly, onOrAfterWorking, finishFor, utcDay } from '../utils/workingDays';

export interface NLProjectResult {
  project: Project;
  schedule: Schedule;
  tasks: Task[];
  analysis: ProjectAnalysis;
  aiPowered: boolean;
}

export class AIProjectCreatorService {
  private fastify: FastifyInstance;
  private taskBreakdown: ClaudeTaskBreakdownService;
  private projectService: ProjectService;
  private scheduleService: ScheduleService;

  constructor(fastify: FastifyInstance) {
    this.fastify = fastify;
    this.taskBreakdown = new ClaudeTaskBreakdownService(fastify);
    this.projectService = new ProjectService();
    this.scheduleService = new ScheduleService();
  }

  async createProjectFromDescription(
    description: string,
    userId: string = 'anonymous',
  ): Promise<NLProjectResult> {
    // 1. Get AI analysis of the description
    const { analysis, aiPowered } = await this.taskBreakdown.analyzeProject(
      description,
      undefined,
      undefined,
      userId,
    );

    // 2. Derive project name and dates from analysis
    const projectName = this.deriveProjectName(description, analysis);
    // Durations are WORKING days. The new project has no calendar of its own yet (it
    // defaults to Mon–Fri), so it starts on the first weekday on or after today.
    const now = onOrAfterWorking(utcDay(new Date()), weekdaysOnly);
    const endDate = finishFor(now, analysis.estimatedDuration || 90, weekdaysOnly);

    const project = await this.projectService.create({
      name: projectName,
      description,
      category: analysis.projectType || 'other',
      status: 'planning',
      priority: analysis.riskLevel > 70 ? 'high' : analysis.riskLevel > 40 ? 'medium' : 'low',
      startDate: now,
      endDate,
      userId,
    });

    // 3. Create a schedule
    const schedule = await this.scheduleService.create({
      projectId: project.id,
      name: `${projectName} - Main Schedule`,
      description: `Auto-generated schedule for: ${description.slice(0, 200)}`,
      startDate: now,
      endDate,
      createdBy: userId,
    });

    // 4. Create tasks from AI suggestions
    const createdTasks: Task[] = [];
    const taskSuggestions = analysis.taskSuggestions || [];

    for (const suggestion of taskSuggestions) {
      const dueDate = finishFor(now, suggestion.estimatedDays || 7, weekdaysOnly);

      // eslint-disable-next-line no-await-in-loop -- tasks are created in the AI's order; the plan sorts ties by creation time
      const task = await this.scheduleService.createTask({
        scheduleId: schedule.id,
        name: suggestion.name,
        description: suggestion.description,
        priority: suggestion.priority as 'low' | 'medium' | 'high' | 'urgent' || 'medium',
        estimatedDays: suggestion.estimatedDays,
        startDate: now,
        dueDate,
        createdBy: userId,
      });
      createdTasks.push(task);
    }

    // 5. Log usage
    logAIUsage({
      userId,
      feature: 'nl-project-creation',
      model: 'claude',
      usage: { inputTokens: 0, outputTokens: 0 },
      latencyMs: 0,
      success: true,
      requestContext: {
        projectId: project.id,
        taskCount: createdTasks.length,
        aiPowered,
      },
    });

    return {
      project,
      schedule,
      tasks: createdTasks,
      analysis,
      aiPowered,
    };
  }

  private deriveProjectName(description: string, analysis: ProjectAnalysis): string {
    const words = description.split(/\s+/).slice(0, 6).join(' ');
    const prefix = analysis.projectType
      ? analysis.projectType.charAt(0).toUpperCase() + analysis.projectType.slice(1)
      : 'Project';

    if (words.length > 50) {
      return `${prefix}: ${words.slice(0, 50)}...`;
    }
    return `${prefix}: ${words}`;
  }
}
