import { resourceService, ResourceWorkload, WeeklyUtilization } from './ResourceService';
import { scheduleService, Task } from './ScheduleService';
import { claudeService } from './claudeService';
import { config } from '../config';
import logger from '../utils/logger';
import {
  ResourceForecastResult,
  ResourceForecastResultSchema,
  BottleneckPrediction,
  BurnoutRisk,
  CapacityWeek,
  RebalanceSuggestion,
  RebalanceSuggestionSchema,
  SkillMatch,
} from '../schemas/resourceOptimizerSchemas';
import { z } from 'zod';

export class ResourceOptimizerService {

  // ---------------------------------------------------------------------------
  // predictBottlenecks
  // ---------------------------------------------------------------------------

  async predictBottlenecks(
    projectId: string,
    weeksAhead: number = 8,
    userId?: string,
  ): Promise<ResourceForecastResult> {
    // 1. Get workloads from ResourceService
    const workloads = await resourceService.computeWorkload(projectId);
    const allResources = await resourceService.findAllResources();

    // 2. Detect upcoming bottlenecks: weeks where utilization > 100%
    const bottlenecks: BottleneckPrediction[] = [];

    for (const workload of workloads) {
      // Limit to the requested number of weeks ahead from now
      const now = new Date();
      const futureWeeks = workload.weeks.filter((w) => {
        const weekDate = new Date(w.weekStart);
        const weeksFromNow = Math.ceil(
          (weekDate.getTime() - now.getTime()) / (7 * 24 * 60 * 60 * 1000),
        );
        return weeksFromNow >= 0 && weeksFromNow < weeksAhead;
      });

      for (const week of futureWeeks) {
        if (week.utilization > 100) {
          // Determine severity based on how far over capacity
          let severity: 'warning' | 'critical' | 'severe';
          if (week.utilization > 150) {
            severity = 'severe';
          } else if (week.utilization > 125) {
            severity = 'critical';
          } else {
            severity = 'warning';
          }

          // Get contributing tasks from assignments for this resource during this week
          const contributingTasks = await this.getContributingTasks(
            workload.resourceId,
            projectId,
            week.weekStart,
          );

          bottlenecks.push({
            resourceId: workload.resourceId,
            resourceName: workload.resourceName,
            week: week.weekStart,
            utilization: week.utilization,
            contributingTasks,
            severity,
          });
        }
      }
    }

    // 3. Assess burnout risk: resources with 3+ consecutive overload weeks
    const burnoutRisks: BurnoutRisk[] = [];

    for (const workload of workloads) {
      let consecutiveOverload = 0;
      let maxConsecutive = 0;

      for (const week of workload.weeks) {
        if (week.utilization > 100) {
          consecutiveOverload++;
          maxConsecutive = Math.max(maxConsecutive, consecutiveOverload);
        } else {
          consecutiveOverload = 0;
        }
      }

      if (maxConsecutive >= 3) {
        let riskLevel: 'low' | 'medium' | 'high' | 'critical';
        if (maxConsecutive >= 8) {
          riskLevel = 'critical';
        } else if (maxConsecutive >= 6) {
          riskLevel = 'high';
        } else if (maxConsecutive >= 4) {
          riskLevel = 'medium';
        } else {
          riskLevel = 'low';
        }

        burnoutRisks.push({
          resourceId: workload.resourceId,
          resourceName: workload.resourceName,
          consecutiveOverloadWeeks: maxConsecutive,
          averageUtilization: workload.averageUtilization,
          riskLevel,
        });
      }
    }

    // 4. Build capacity forecast: weekly surplus/deficit across all resources
    const capacityForecast = this.buildCapacityForecast(workloads, weeksAhead);

    // 5. Summary
    const totalResources = workloads.length;
    const overAllocatedCount = workloads.filter((w) => w.isOverAllocated).length;
    const averageUtilization =
      totalResources > 0
        ? Math.round(
            workloads.reduce((sum, w) => sum + w.averageUtilization, 0) / totalResources,
          )
        : 0;

    // 6. Optionally generate AI rebalancing suggestions
    let rebalanceSuggestions: RebalanceSuggestion[] | undefined;

    if (config.AI_ENABLED && claudeService.isAvailable() && bottlenecks.length > 0) {
      try {
        rebalanceSuggestions = await this.generateRebalanceSuggestions(
          workloads,
          bottlenecks,
          burnoutRisks,
          allResources.map((r) => ({ id: r.id, name: r.name, role: r.role, skills: r.skills })),
        );
      } catch (err) {
        logger.error('[ResourceOptimizerService] AI rebalance suggestion failed:', err);
        // Continue without AI suggestions
      }
    }

    return {
      bottlenecks,
      burnoutRisks,
      capacityForecast,
      rebalanceSuggestions,
      summary: {
        totalResources,
        overAllocatedCount,
        averageUtilization,
      },
    };
  }

  // ---------------------------------------------------------------------------
  // findBestResourceForTask
  // ---------------------------------------------------------------------------

  async findBestResourceForTask(
    taskId: string,
    scheduleId: string,
  ): Promise<SkillMatch[]> {
    // Get the task
    const task = await scheduleService.findTaskById(taskId);
    if (!task) {
      throw new Error(`Task not found: ${taskId}`);
    }

    // Get all active resources
    const allResources = await resourceService.findAllResources();
    const activeResources = allResources.filter((r) => r.isActive);

    // Build keyword set from task name and description
    const taskText = `${task.name} ${task.description || ''}`.toLowerCase();
    const taskKeywords = this.extractKeywords(taskText);

    // Get assignments for this schedule to compute available capacity
    const assignments = await resourceService.findAssignmentsBySchedule(scheduleId);

    const matches: SkillMatch[] = [];

    for (const resource of activeResources) {
      // Keyword match: compare resource skills against task keywords
      const matchedSkills: string[] = [];
      let matchScore = 0;
      let proficiencySum = 0;

      for (const skill of resource.skills) {
        const skillName = typeof skill === 'string' ? skill : skill.name;
        const skillLevel = typeof skill === 'string' ? 3 : (skill.level || 3);
        const skillLower = skillName.toLowerCase();
        const skillWords = this.extractKeywords(skillLower);

        // Check if any skill keyword appears in the task text
        let skillMatched = false;
        for (const skillWord of skillWords) {
          if (taskText.includes(skillWord)) {
            skillMatched = true;
            break;
          }
        }

        // Also check if any task keyword appears in the skill
        if (!skillMatched) {
          for (const taskKeyword of taskKeywords) {
            if (skillLower.includes(taskKeyword)) {
              skillMatched = true;
              break;
            }
          }
        }

        if (skillMatched) {
          matchedSkills.push(skillName);
          proficiencySum += skillLevel;
        }
      }

      // Score: weighted by proficiency levels (max 5 per skill)
      if (resource.skills.length > 0) {
        matchScore = Math.round((proficiencySum / (resource.skills.length * 5)) * 100);
      }

      // Calculate available capacity during the task period
      const resourceAssignments = assignments.filter((a) => a.resourceId === resource.id);
      let currentAllocated = 0;

      if (task.startDate && task.endDate) {
        const taskStart = new Date(task.startDate).getTime();
        const taskEnd = new Date(task.endDate).getTime();

        for (const a of resourceAssignments) {
          const aStart = new Date(a.startDate).getTime();
          const aEnd = new Date(a.endDate).getTime();
          // Check overlap
          if (aStart < taskEnd && aEnd >= taskStart) {
            currentAllocated += a.hoursPerWeek;
          }
        }
      }

      const availableCapacity = Math.max(0, resource.capacityHoursPerWeek - currentAllocated);

      matches.push({
        resourceId: resource.id,
        resourceName: resource.name,
        matchScore,
        matchedSkills,
        availableCapacity,
      });
    }

    // Sort by matchScore descending, then by availableCapacity descending
    matches.sort((a, b) => {
      if (b.matchScore !== a.matchScore) return b.matchScore - a.matchScore;
      return b.availableCapacity - a.availableCapacity;
    });

    return matches;
  }

  // ---------------------------------------------------------------------------
  // Private helpers
  // ---------------------------------------------------------------------------

  private async getContributingTasks(
    resourceId: string,
    projectId: string,
    weekStart: string,
  ): Promise<Array<{ taskId: string; taskName: string; hoursPerWeek: number }>> {
    const schedules = await scheduleService.findByProjectId(projectId);
    const contributing: Array<{ taskId: string; taskName: string; hoursPerWeek: number }> = [];

    const weekDate = new Date(weekStart).getTime();
    const weekEnd = weekDate + 7 * 24 * 60 * 60 * 1000;

    for (const schedule of schedules) {
      const assignments = await resourceService.findAssignmentsBySchedule(schedule.id);
      const resourceAssignments = assignments.filter((a) => a.resourceId === resourceId);

      for (const assignment of resourceAssignments) {
        const aStart = new Date(assignment.startDate).getTime();
        const aEnd = new Date(assignment.endDate).getTime();

        if (aStart < weekEnd && aEnd >= weekDate) {
          const task = await scheduleService.findTaskById(assignment.taskId);
          contributing.push({
            taskId: assignment.taskId,
            taskName: task?.name || assignment.taskId,
            hoursPerWeek: assignment.hoursPerWeek,
          });
        }
      }
    }

    return contributing;
  }

  private buildCapacityForecast(
    workloads: ResourceWorkload[],
    weeksAhead: number,
  ): CapacityWeek[] {
    if (workloads.length === 0) return [];

    // Collect all unique weeks across all workloads, limited to weeksAhead from now
    const now = new Date();
    const weekMap = new Map<
      string,
      { totalCapacity: number; totalAllocated: number }
    >();

    for (const workload of workloads) {
      for (const week of workload.weeks) {
        const weekDate = new Date(week.weekStart);
        const weeksFromNow = Math.ceil(
          (weekDate.getTime() - now.getTime()) / (7 * 24 * 60 * 60 * 1000),
        );
        if (weeksFromNow < 0 || weeksFromNow >= weeksAhead) continue;

        const existing = weekMap.get(week.weekStart) || {
          totalCapacity: 0,
          totalAllocated: 0,
        };
        existing.totalCapacity += week.capacity;
        existing.totalAllocated += week.allocated;
        weekMap.set(week.weekStart, existing);
      }
    }

    const forecast: CapacityWeek[] = [];

    for (const [week, data] of weekMap) {
      const surplus = Math.max(0, data.totalCapacity - data.totalAllocated);
      const deficit = Math.max(0, data.totalAllocated - data.totalCapacity);

      forecast.push({
        week,
        totalCapacity: data.totalCapacity,
        totalAllocated: data.totalAllocated,
        surplus,
        deficit,
      });
    }

    // Sort by week date
    forecast.sort((a, b) => new Date(a.week).getTime() - new Date(b.week).getTime());

    return forecast;
  }

  private async generateRebalanceSuggestions(
    workloads: ResourceWorkload[],
    bottlenecks: BottleneckPrediction[],
    burnoutRisks: BurnoutRisk[],
    resources: Array<{ id: string; name: string; role: string; skills: Array<string | { name: string; level: number }> }>,
  ): Promise<RebalanceSuggestion[]> {
    const systemPrompt = `You are a resource optimization AI for project management.
Analyze the resource workload data, bottlenecks, and burnout risks provided.
Generate practical rebalancing suggestions to resolve over-allocations and reduce burnout risk.
Each suggestion should be actionable with a clear type (reassign, delay, split, or hire),
a description of the change, and a confidence score from 0-100 indicating how effective the suggestion would be.`;

    const userMessage = `Here is the current resource situation:

## Resource Workloads
${JSON.stringify(workloads.map((w) => ({
  resourceId: w.resourceId,
  resourceName: w.resourceName,
  role: w.role,
  averageUtilization: w.averageUtilization,
  isOverAllocated: w.isOverAllocated,
})), null, 2)}

## Bottlenecks Detected
${JSON.stringify(bottlenecks, null, 2)}

## Burnout Risks
${JSON.stringify(burnoutRisks, null, 2)}

## Available Resources
${JSON.stringify(resources, null, 2)}

Generate 3-5 actionable rebalancing suggestions to address these issues.`;

    const schema = z.array(RebalanceSuggestionSchema);

    const result = await claudeService.completeWithJsonSchema({
      systemPrompt,
      userMessage,
      schema,
      maxTokens: 2048,
    });

    return result.data;
  }

  private extractKeywords(text: string): string[] {
    // Split on non-alphanumeric characters and filter short/stop words
    const stopWords = new Set([
      'the', 'a', 'an', 'and', 'or', 'but', 'in', 'on', 'at', 'to', 'for',
      'of', 'with', 'by', 'from', 'is', 'are', 'was', 'were', 'be', 'been',
      'has', 'have', 'had', 'do', 'does', 'did', 'will', 'would', 'could',
      'should', 'may', 'might', 'can', 'shall', 'this', 'that', 'these',
      'those', 'it', 'its', 'all', 'each', 'every', 'both', 'few', 'more',
      'most', 'other', 'some', 'such', 'no', 'not', 'only', 'own', 'same',
    ]);

    return text
      .split(/[^a-zA-Z0-9]+/)
      .map((w) => w.toLowerCase().trim())
      .filter((w) => w.length >= 3 && !stopWords.has(w));
  }
}

export const resourceOptimizerService = new ResourceOptimizerService();
