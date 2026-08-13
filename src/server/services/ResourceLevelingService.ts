import { criticalPathService, CriticalPathResult, CPMTaskResult } from './CriticalPathService';
import { scheduleService, Task } from './ScheduleService';
import { resourceService } from './ResourceService';
import type { Resource } from './ResourceService';
import logger from '../utils/logger';

// --- Interfaces ---

export interface DailyDemand {
  date: string;
  hours: number;
}

export interface ResourceDemand {
  resourceName: string;
  demand: DailyDemand[];
}

export interface OverAllocation {
  resourceName: string;
  date: string;
  demand: number;
  capacity: number;
}

export interface ResourceHistogram {
  resources: ResourceDemand[];
  overAllocations: OverAllocation[];
}

export interface TaskAdjustment {
  taskId: string;
  taskName: string;
  originalStart: string;
  originalEnd: string;
  newStart: string;
  newEnd: string;
  reason: string;
}

export interface ReassignmentSuggestion {
  taskId: string;
  taskName: string;
  currentResource: string;
  suggestedResource: string;
  suggestedResourceId: string;
  matchScore: number;
  reason: string;
}

export interface LevelingResult {
  originalDemand: ResourceDemand[];
  leveledDemand: ResourceDemand[];
  adjustedTasks: TaskAdjustment[];
  overAllocations: OverAllocation[];
  reassignmentSuggestions: ReassignmentSuggestion[];
}

// --- Service ---

const DAY_MS = 86_400_000;
const DEFAULT_CAPACITY_HOURS = 8;

function toDateStr(d: Date): string {
  return d.toISOString().slice(0, 10);
}

function fromDateStr(s: string): Date {
  const d = new Date(s + 'T00:00:00Z');
  d.setUTCHours(0, 0, 0, 0);
  return d;
}

function addDays(d: Date, days: number): Date {
  return new Date(d.getTime() + days * DAY_MS);
}

function daysBetween(a: Date, b: Date): number {
  return Math.round((b.getTime() - a.getTime()) / DAY_MS);
}

export class ResourceLevelingService {

  /**
   * Calculate daily resource demand per resource for a schedule.
   * Each task contributes 1 unit (8 hours) per day to its assigned resource.
   */
  async getResourceHistogram(scheduleId: string): Promise<ResourceHistogram> {
    const tasks = await scheduleService.findTasksByScheduleId(scheduleId);

    // Build demand map: resourceName -> date -> hours
    const demandMap = new Map<string, Map<string, number>>();

    for (const task of tasks) {
      if (!task.assignedTo || !task.startDate || !task.endDate) continue;
      if (task.status === 'cancelled' || task.status === 'completed') continue;

      const resourceName = task.assignedTo;
      const start = new Date(task.startDate);
      const end = new Date(task.endDate);

      if (!demandMap.has(resourceName)) {
        demandMap.set(resourceName, new Map());
      }
      const resourceDemand = demandMap.get(resourceName)!;

      // Add 8 hours per day for the duration of this task
      const numDays = Math.max(1, daysBetween(start, end));
      for (let d = 0; d < numDays; d++) {
        const dateStr = toDateStr(addDays(start, d));
        const current = resourceDemand.get(dateStr) || 0;
        resourceDemand.set(dateStr, current + DEFAULT_CAPACITY_HOURS);
      }
    }

    // Convert to output format
    const resources: ResourceDemand[] = [];
    const overAllocations: OverAllocation[] = [];

    for (const [resourceName, dateDemand] of demandMap) {
      const sortedDates = [...dateDemand.keys()].sort();
      const demand: DailyDemand[] = sortedDates.map(date => ({
        date,
        hours: dateDemand.get(date)!,
      }));

      resources.push({ resourceName, demand });

      // Check for over-allocations (demand > capacity)
      for (const { date, hours } of demand) {
        if (hours > DEFAULT_CAPACITY_HOURS) {
          overAllocations.push({
            resourceName,
            date,
            demand: hours,
            capacity: DEFAULT_CAPACITY_HOURS,
          });
        }
      }
    }

    return { resources, overAllocations };
  }

  /**
   * Run resource leveling algorithm.
   * Identifies over-allocated resources and proposes delaying non-critical tasks
   * using available float/slack to reduce peak demand.
   */
  async levelResources(scheduleId: string): Promise<LevelingResult> {
    const tasks = await scheduleService.findTasksByScheduleId(scheduleId);
    const cpResult = await criticalPathService.calculateCriticalPath(scheduleId);
    const histogram = await this.getResourceHistogram(scheduleId);

    const originalDemand = histogram.resources.map(r => ({
      resourceName: r.resourceName,
      demand: r.demand.map(d => ({ ...d })),
    }));

    if (histogram.overAllocations.length === 0) {
      return {
        originalDemand,
        leveledDemand: originalDemand,
        adjustedTasks: [],
        overAllocations: [],
        reassignmentSuggestions: [],
      };
    }

    // Build CPM lookup
    const cpmMap = new Map<string, CPMTaskResult>();
    const criticalSet = new Set<string>(cpResult.criticalPathTaskIds);
    for (const cpm of cpResult.tasks) {
      cpmMap.set(cpm.taskId, cpm);
    }

    // Build a mutable copy of tasks with their dates for leveling
    interface LevelableTask {
      task: Task;
      currentStart: Date;
      currentEnd: Date;
      durationDays: number;
      totalFloat: number;
      isCritical: boolean;
    }

    const levelable: LevelableTask[] = [];
    for (const task of tasks) {
      if (!task.assignedTo || !task.startDate || !task.endDate) continue;
      if (task.status === 'cancelled' || task.status === 'completed') continue;

      const cpm = cpmMap.get(task.id);
      const isCritical = criticalSet.has(task.id);
      const totalFloat = cpm ? cpm.totalFloat : 0;
      const start = new Date(task.startDate);
      const end = new Date(task.endDate);
      const durationDays = Math.max(1, daysBetween(start, end));

      levelable.push({
        task,
        currentStart: start,
        currentEnd: end,
        durationDays,
        totalFloat,
        isCritical,
      });
    }

    // Build a mutable demand map for simulation
    const demandSim = new Map<string, Map<string, number>>();
    for (const r of histogram.resources) {
      const dateMap = new Map<string, number>();
      for (const d of r.demand) {
        dateMap.set(d.date, d.hours);
      }
      demandSim.set(r.resourceName, dateMap);
    }

    const adjustedTasks: TaskAdjustment[] = [];
    const MAX_LEVELING_ITERATIONS = 50_000;
    let iterationCount = 0;

    // Sort non-critical tasks by float descending (most flexible tasks first)
    const nonCritical = levelable
      .filter(lt => !lt.isCritical && lt.totalFloat > 0)
      .sort((a, b) => b.totalFloat - a.totalFloat);

    // Iteratively try to resolve over-allocations
    for (const lt of nonCritical) {
      if (iterationCount >= MAX_LEVELING_ITERATIONS) {
        logger.warn(`Resource leveling stopped after ${MAX_LEVELING_ITERATIONS} iterations for schedule ${scheduleId}`);
        break;
      }
      const resourceName = lt.task.assignedTo!;
      const resourceDemand = demandSim.get(resourceName);
      if (!resourceDemand) continue;

      // Check if this resource still has over-allocations during this task's span
      let hasOverAllocation = false;
      for (let d = 0; d < lt.durationDays; d++) {
        iterationCount++;
        const dateStr = toDateStr(addDays(lt.currentStart, d));
        const demand = resourceDemand.get(dateStr) || 0;
        if (demand > DEFAULT_CAPACITY_HOURS) {
          hasOverAllocation = true;
          break;
        }
      }

      if (!hasOverAllocation) continue;

      // Try delaying the task by 1 day at a time up to its total float
      const maxDelay = lt.totalFloat;
      let bestDelay = 0;

      for (let delay = 1; delay <= maxDelay; delay++) {
        if (iterationCount >= MAX_LEVELING_ITERATIONS) break;
        const newStart = addDays(lt.currentStart, delay);

        // Check if the new position reduces over-allocation
        let overAllocationCount = 0;
        for (let d = 0; d < lt.durationDays; d++) {
          iterationCount++;
          const dateStr = toDateStr(addDays(newStart, d));
          // Current demand at new position minus this task's contribution that would be added
          const existingDemand = resourceDemand.get(dateStr) || 0;
          // We need to account for removing old position and adding new
          const oldDateStr = toDateStr(addDays(lt.currentStart, d));
          const isOldDate = resourceDemand.has(oldDateStr);
          // If new date still exceeds capacity (considering the task hasn't moved yet in sim), skip
          if (existingDemand > DEFAULT_CAPACITY_HOURS) {
            overAllocationCount++;
          }
        }

        // Check original position over-allocation count
        let originalOverCount = 0;
        for (let d = 0; d < lt.durationDays; d++) {
          const dateStr = toDateStr(addDays(lt.currentStart, d));
          const demand = resourceDemand.get(dateStr) || 0;
          if (demand > DEFAULT_CAPACITY_HOURS) {
            originalOverCount++;
          }
        }

        if (overAllocationCount < originalOverCount) {
          bestDelay = delay;
          break; // Take the first improvement
        }
      }

      if (bestDelay > 0) {
        const originalStart = toDateStr(lt.currentStart);
        const originalEnd = toDateStr(lt.currentEnd);
        const newStart = addDays(lt.currentStart, bestDelay);
        const newEnd = addDays(lt.currentEnd, bestDelay);

        // Update the simulation demand map: remove old dates, add new dates
        for (let d = 0; d < lt.durationDays; d++) {
          const oldDateStr = toDateStr(addDays(lt.currentStart, d));
          const oldDemand = resourceDemand.get(oldDateStr) || 0;
          resourceDemand.set(oldDateStr, Math.max(0, oldDemand - DEFAULT_CAPACITY_HOURS));
        }
        for (let d = 0; d < lt.durationDays; d++) {
          const newDateStr = toDateStr(addDays(newStart, d));
          const current = resourceDemand.get(newDateStr) || 0;
          resourceDemand.set(newDateStr, current + DEFAULT_CAPACITY_HOURS);
        }

        lt.currentStart = newStart;
        lt.currentEnd = newEnd;

        adjustedTasks.push({
          taskId: lt.task.id,
          taskName: lt.task.name,
          originalStart,
          originalEnd,
          newStart: toDateStr(newStart),
          newEnd: toDateStr(newEnd),
          reason: `Delayed ${bestDelay} day(s) to resolve resource over-allocation for ${resourceName} (float: ${lt.totalFloat} days)`,
        });
      }
    }

    // Build leveled demand from simulation
    const leveledDemand: ResourceDemand[] = [];
    for (const [resourceName, dateMap] of demandSim) {
      const sortedDates = [...dateMap.keys()].sort();
      const demand: DailyDemand[] = sortedDates
        .filter(date => (dateMap.get(date) || 0) > 0)
        .map(date => ({
          date,
          hours: dateMap.get(date)!,
        }));
      leveledDemand.push({ resourceName, demand });
    }

    // Recalculate remaining over-allocations after leveling
    const remainingOverAllocations: OverAllocation[] = [];
    for (const r of leveledDemand) {
      for (const d of r.demand) {
        if (d.hours > DEFAULT_CAPACITY_HOURS) {
          remainingOverAllocations.push({
            resourceName: r.resourceName,
            date: d.date,
            demand: d.hours,
            capacity: DEFAULT_CAPACITY_HOURS,
          });
        }
      }
    }

    // --- Reassignment suggestions for remaining over-allocations ---
    const reassignmentSuggestions: ReassignmentSuggestion[] = [];

    if (remainingOverAllocations.length > 0) {
      try {
        const allResources = await resourceService.findAllResources();
        const activeResources = allResources.filter(r => r.isActive);

        // Identify still-overloaded resources
        const overloadedResources = new Set(remainingOverAllocations.map(oa => oa.resourceName));

        // Find tasks assigned to overloaded resources that could be reassigned
        for (const lt of levelable) {
          if (!lt.task.assignedTo || !overloadedResources.has(lt.task.assignedTo)) continue;

          // Check if this task's date range overlaps with remaining over-allocations
          const resourceOAs = remainingOverAllocations.filter(oa => oa.resourceName === lt.task.assignedTo);
          const taskDates = new Set<string>();
          for (let d = 0; d < lt.durationDays; d++) {
            taskDates.add(toDateStr(addDays(lt.currentStart, d)));
          }
          const overlaps = resourceOAs.some(oa => taskDates.has(oa.date));
          if (!overlaps) continue;

          // Find alternative resources based on skill matching
          const taskText = `${lt.task.name} ${lt.task.description || ''}`.toLowerCase();
          const taskWords = new Set(taskText.split(/\s+/).filter(w => w.length > 2));

          let bestMatch: { resource: Resource; score: number } | null = null;

          for (const resource of activeResources) {
            if (resource.name === lt.task.assignedTo) continue;

            // Skill-keyword match weighted by proficiency
            let proficiencySum = 0;
            for (const skill of resource.skills) {
              const skillName = typeof skill === 'string' ? skill : skill.name;
              const skillLevel = typeof skill === 'string' ? 3 : (skill.level || 3);
              const skillLower = skillName.toLowerCase();
              for (const word of taskWords) {
                if (skillLower.includes(word) || word.includes(skillLower)) {
                  proficiencySum += skillLevel;
                  break;
                }
              }
            }
            const score = resource.skills.length > 0
              ? Math.round((proficiencySum / (resource.skills.length * 5)) * 100)
              : 10; // Default low score for resources with no skills

            if (!bestMatch || score > bestMatch.score) {
              bestMatch = { resource, score };
            }
          }

          if (bestMatch && bestMatch.score > 0) {
            reassignmentSuggestions.push({
              taskId: lt.task.id,
              taskName: lt.task.name,
              currentResource: lt.task.assignedTo!,
              suggestedResource: bestMatch.resource.name,
              suggestedResourceId: bestMatch.resource.id,
              matchScore: bestMatch.score,
              reason: `${lt.task.assignedTo} is over-allocated; ${bestMatch.resource.name} has matching skills (${bestMatch.score}% match)`,
            });
          }
        }
      } catch {
        // Non-critical — return leveling results without suggestions
      }
    }

    return {
      originalDemand,
      leveledDemand,
      adjustedTasks,
      overAllocations: remainingOverAllocations,
      reassignmentSuggestions,
    };
  }

  /**
   * Apply leveled date adjustments to actual task records.
   */
  async applyLeveledDates(
    scheduleId: string,
    adjustments: TaskAdjustment[],
  ): Promise<{ applied: number; errors: string[] }> {
    let applied = 0;
    const errors: string[] = [];

    for (const adj of adjustments) {
      try {
        const task = await scheduleService.findTaskById(adj.taskId);
        if (!task) {
          errors.push(`Task ${adj.taskId} not found`);
          continue;
        }
        if (task.scheduleId !== scheduleId) {
          errors.push(`Task ${adj.taskId} does not belong to schedule ${scheduleId}`);
          continue;
        }

        await scheduleService.updateTask(adj.taskId, {
          startDate: adj.newStart,
          endDate: adj.newEnd,
        });
        applied++;
      } catch (err: any) {
        errors.push(`Failed to update task ${adj.taskId}: ${err.message || String(err)}`);
      }
    }

    return { applied, errors };
  }
}

export const resourceLevelingService = new ResourceLevelingService();
