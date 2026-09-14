import { describe, it, expect, vi, beforeEach } from 'vitest';

// ── Mocks ────────────────────────────────────────────────────────────

const mockComputeWorkload = vi.fn();
const mockFindAllResources = vi.fn();
const mockFindAssignmentsBySchedule = vi.fn();
vi.mock('../../services/ResourceService', () => ({
  resourceService: {
    computeWorkload: (...args: any[]) => mockComputeWorkload(...args),
    findAllResources: (...args: any[]) => mockFindAllResources(...args),
    findAssignmentsBySchedule: (...args: any[]) => mockFindAssignmentsBySchedule(...args),
  },
}));

const mockFindTaskById = vi.fn();
const mockFindByProjectId = vi.fn();
vi.mock('../../services/ScheduleService', () => ({
  scheduleService: {
    findTaskById: (...args: any[]) => mockFindTaskById(...args),
    findByProjectId: (...args: any[]) => mockFindByProjectId(...args),
  },
}));

const mockIsAvailable = vi.fn();
const mockCompleteWithJsonSchema = vi.fn();
vi.mock('../../services/claudeService', () => ({
  claudeService: {
    isAvailable: (...args: any[]) => mockIsAvailable(...args),
    completeWithJsonSchema: (...args: any[]) => mockCompleteWithJsonSchema(...args),
  },
}));

vi.mock('../../config', () => ({
  config: {
    AI_ENABLED: false,
  },
}));

vi.mock('../../utils/logger', () => ({
  default: {
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
  },
}));

import { ResourceOptimizerService } from '../../services/ResourceOptimizerService';
import { config } from '../../config';

// ── Helpers ──────────────────────────────────────────────────────────

function futureWeekStart(weeksFromNow: number): string {
  const d = new Date();
  d.setDate(d.getDate() + weeksFromNow * 7);
  // Align to Monday
  const day = d.getDay();
  const diff = d.getDate() - day + (day === 0 ? -6 : 1);
  d.setDate(diff);
  return d.toISOString().slice(0, 10);
}

function makeWorkload(
  resourceId: string,
  resourceName: string,
  weeks: Array<{
    weekStart: string;
    utilization: number;
    allocated?: number;
    capacity?: number;
  }>,
  overrides: Partial<{
    role: string;
    averageUtilization: number;
    isOverAllocated: boolean;
  }> = {},
) {
  const avgUtil =
    overrides.averageUtilization ??
    (weeks.length > 0
      ? Math.round(weeks.reduce((s, w) => s + w.utilization, 0) / weeks.length)
      : 0);

  return {
    resourceId,
    resourceName,
    role: overrides.role ?? 'Developer',
    costRateHourly: 50,
    totalCost: 0,
    weeks: weeks.map((w) => ({
      weekStart: w.weekStart,
      allocated: w.allocated ?? (w.utilization / 100) * 40,
      actual: 0,
      capacity: w.capacity ?? 40,
      utilization: w.utilization,
      cost: 0,
    })),
    averageUtilization: avgUtil,
    isOverAllocated: overrides.isOverAllocated ?? avgUtil > 100,
  };
}

function makeResource(
  id: string,
  name: string,
  overrides: Partial<{
    role: string;
    skills: Array<string | { name: string; level: number }>;
    isActive: boolean;
    capacityHoursPerWeek: number;
  }> = {},
) {
  return {
    id,
    name,
    role: overrides.role ?? 'Developer',
    email: `${id}@test.com`,
    capacityHoursPerWeek: overrides.capacityHoursPerWeek ?? 40,
    skills: overrides.skills ?? [],
    isActive: overrides.isActive ?? true,
    costRateHourly: 50,
    overtimeRateHourly: null,
    resourceGroup: null,
    userId: null,
    calendarTemplateId: null,
  };
}

// ── Tests ────────────────────────────────────────────────────────────

describe('ResourceOptimizerService', () => {
  let service: ResourceOptimizerService;

  beforeEach(() => {
    vi.clearAllMocks();
    service = new ResourceOptimizerService();
    // Default: AI disabled
    (config as any).AI_ENABLED = false;
  });

  // ── predictBottlenecks ────────────────────────────────────────────

  describe('predictBottlenecks', () => {
    it('returns empty results when no workloads exist', async () => {
      mockComputeWorkload.mockResolvedValue([]);
      mockFindAllResources.mockResolvedValue([]);

      const result = await service.predictBottlenecks('proj-1');

      expect(result.bottlenecks).toEqual([]);
      expect(result.burnoutRisks).toEqual([]);
      expect(result.capacityForecast).toEqual([]);
      expect(result.summary).toEqual({
        totalResources: 0,
        overAllocatedCount: 0,
        averageUtilization: 0,
      });
      expect(result.rebalanceSuggestions).toBeUndefined();
    });

    it('detects bottlenecks when utilization exceeds 100%', async () => {
      const week1 = futureWeekStart(1);
      const workloads = [
        makeWorkload('r-1', 'Alice', [
          { weekStart: week1, utilization: 110 },
        ]),
      ];
      mockComputeWorkload.mockResolvedValue(workloads);
      mockFindAllResources.mockResolvedValue([]);
      mockFindByProjectId.mockResolvedValue([{ id: 'sch-1' }]);
      mockFindAssignmentsBySchedule.mockResolvedValue([]);

      const result = await service.predictBottlenecks('proj-1');

      expect(result.bottlenecks).toHaveLength(1);
      expect(result.bottlenecks[0]).toMatchObject({
        resourceId: 'r-1',
        resourceName: 'Alice',
        week: week1,
        utilization: 110,
        severity: 'warning',
      });
    });

    it('assigns correct severity levels: warning, critical, severe', async () => {
      const week1 = futureWeekStart(1);
      const week2 = futureWeekStart(2);
      const week3 = futureWeekStart(3);

      const workloads = [
        makeWorkload('r-1', 'Alice', [
          { weekStart: week1, utilization: 110 },  // warning (101-125)
          { weekStart: week2, utilization: 130 },  // critical (126-150)
          { weekStart: week3, utilization: 160 },  // severe (>150)
        ]),
      ];
      mockComputeWorkload.mockResolvedValue(workloads);
      mockFindAllResources.mockResolvedValue([]);
      mockFindByProjectId.mockResolvedValue([]);
      mockFindAssignmentsBySchedule.mockResolvedValue([]);

      const result = await service.predictBottlenecks('proj-1');

      expect(result.bottlenecks).toHaveLength(3);
      expect(result.bottlenecks[0].severity).toBe('warning');
      expect(result.bottlenecks[1].severity).toBe('critical');
      expect(result.bottlenecks[2].severity).toBe('severe');
    });

    it('does not flag weeks at or below 100% utilization', async () => {
      const week1 = futureWeekStart(1);
      const workloads = [
        makeWorkload('r-1', 'Alice', [
          { weekStart: week1, utilization: 100 },
        ]),
      ];
      mockComputeWorkload.mockResolvedValue(workloads);
      mockFindAllResources.mockResolvedValue([]);

      const result = await service.predictBottlenecks('proj-1');

      expect(result.bottlenecks).toHaveLength(0);
    });

    it('ignores weeks in the past', async () => {
      // Create a week that is clearly in the past
      const pastDate = new Date();
      pastDate.setDate(pastDate.getDate() - 14);
      const pastWeek = pastDate.toISOString().slice(0, 10);

      const workloads = [
        makeWorkload('r-1', 'Alice', [
          { weekStart: pastWeek, utilization: 200 },
        ]),
      ];
      mockComputeWorkload.mockResolvedValue(workloads);
      mockFindAllResources.mockResolvedValue([]);

      const result = await service.predictBottlenecks('proj-1');

      expect(result.bottlenecks).toHaveLength(0);
    });

    it('respects the weeksAhead limit', async () => {
      const week1 = futureWeekStart(1);
      const week10 = futureWeekStart(10);

      const workloads = [
        makeWorkload('r-1', 'Alice', [
          { weekStart: week1, utilization: 120 },
          { weekStart: week10, utilization: 120 },
        ]),
      ];
      mockComputeWorkload.mockResolvedValue(workloads);
      mockFindAllResources.mockResolvedValue([]);
      mockFindByProjectId.mockResolvedValue([]);
      mockFindAssignmentsBySchedule.mockResolvedValue([]);

      // Default weeksAhead = 8, so week10 should be excluded
      const result = await service.predictBottlenecks('proj-1');

      expect(result.bottlenecks).toHaveLength(1);
      expect(result.bottlenecks[0].week).toBe(week1);
    });

    it('detects burnout risk for 3+ consecutive overload weeks', async () => {
      const weeks = Array.from({ length: 4 }, (_, i) => ({
        weekStart: futureWeekStart(i + 1),
        utilization: 110,
      }));

      const workloads = [
        makeWorkload('r-1', 'Alice', weeks, { averageUtilization: 110, isOverAllocated: true }),
      ];
      mockComputeWorkload.mockResolvedValue(workloads);
      mockFindAllResources.mockResolvedValue([]);
      mockFindByProjectId.mockResolvedValue([]);
      mockFindAssignmentsBySchedule.mockResolvedValue([]);

      const result = await service.predictBottlenecks('proj-1');

      expect(result.burnoutRisks).toHaveLength(1);
      expect(result.burnoutRisks[0]).toMatchObject({
        resourceId: 'r-1',
        resourceName: 'Alice',
        consecutiveOverloadWeeks: 4,
        riskLevel: 'medium', // 4 weeks = medium
      });
    });

    it('does not flag burnout for fewer than 3 consecutive overload weeks', async () => {
      const weeks = [
        { weekStart: futureWeekStart(1), utilization: 110 },
        { weekStart: futureWeekStart(2), utilization: 110 },
        { weekStart: futureWeekStart(3), utilization: 90 }, // breaks streak
      ];

      const workloads = [makeWorkload('r-1', 'Alice', weeks)];
      mockComputeWorkload.mockResolvedValue(workloads);
      mockFindAllResources.mockResolvedValue([]);

      const result = await service.predictBottlenecks('proj-1');

      expect(result.burnoutRisks).toHaveLength(0);
    });

    it('assigns correct burnout risk levels', async () => {
      // Test each threshold: 3=low, 4=medium, 6=high, 8=critical
      const makeWorkloadWithConsecutive = (id: string, name: string, count: number) => {
        const weeks = Array.from({ length: count }, (_, i) => ({
          weekStart: futureWeekStart(i),
          utilization: 110,
        }));
        return makeWorkload(id, name, weeks);
      };

      const workloads = [
        makeWorkloadWithConsecutive('r-1', 'Low', 3),
        makeWorkloadWithConsecutive('r-2', 'Medium', 5),
        makeWorkloadWithConsecutive('r-3', 'High', 7),
        makeWorkloadWithConsecutive('r-4', 'Critical', 9),
      ];

      mockComputeWorkload.mockResolvedValue(workloads);
      mockFindAllResources.mockResolvedValue([]);
      mockFindByProjectId.mockResolvedValue([]);
      mockFindAssignmentsBySchedule.mockResolvedValue([]);

      const result = await service.predictBottlenecks('proj-1');

      const riskMap = new Map(result.burnoutRisks.map((r) => [r.resourceName, r.riskLevel]));
      expect(riskMap.get('Low')).toBe('low');
      expect(riskMap.get('Medium')).toBe('medium');
      expect(riskMap.get('High')).toBe('high');
      expect(riskMap.get('Critical')).toBe('critical');
    });

    it('builds capacity forecast with surplus and deficit', async () => {
      const week1 = futureWeekStart(1);
      const workloads = [
        makeWorkload('r-1', 'Alice', [
          { weekStart: week1, utilization: 120, allocated: 48, capacity: 40 },
        ]),
        makeWorkload('r-2', 'Bob', [
          { weekStart: week1, utilization: 50, allocated: 20, capacity: 40 },
        ]),
      ];

      mockComputeWorkload.mockResolvedValue(workloads);
      mockFindAllResources.mockResolvedValue([]);
      mockFindByProjectId.mockResolvedValue([]);
      mockFindAssignmentsBySchedule.mockResolvedValue([]);

      const result = await service.predictBottlenecks('proj-1');

      expect(result.capacityForecast).toHaveLength(1);
      expect(result.capacityForecast[0]).toMatchObject({
        week: week1,
        totalCapacity: 80,   // 40 + 40
        totalAllocated: 68,  // 48 + 20
        surplus: 12,         // 80 - 68
        deficit: 0,
      });
    });

    it('computes correct summary statistics', async () => {
      const week1 = futureWeekStart(1);
      const workloads = [
        makeWorkload('r-1', 'Alice', [{ weekStart: week1, utilization: 120 }], {
          averageUtilization: 120,
          isOverAllocated: true,
        }),
        makeWorkload('r-2', 'Bob', [{ weekStart: week1, utilization: 80 }], {
          averageUtilization: 80,
          isOverAllocated: false,
        }),
      ];

      mockComputeWorkload.mockResolvedValue(workloads);
      mockFindAllResources.mockResolvedValue([]);
      mockFindByProjectId.mockResolvedValue([]);
      mockFindAssignmentsBySchedule.mockResolvedValue([]);

      const result = await service.predictBottlenecks('proj-1');

      expect(result.summary).toEqual({
        totalResources: 2,
        overAllocatedCount: 1,
        averageUtilization: 100, // Math.round((120 + 80) / 2)
      });
    });

    it('generates AI rebalance suggestions when enabled and bottlenecks exist', async () => {
      (config as any).AI_ENABLED = true;
      mockIsAvailable.mockReturnValue(true);

      const week1 = futureWeekStart(1);
      const workloads = [
        makeWorkload('r-1', 'Alice', [{ weekStart: week1, utilization: 120 }], {
          isOverAllocated: true,
        }),
      ];

      mockComputeWorkload.mockResolvedValue(workloads);
      mockFindAllResources.mockResolvedValue([
        makeResource('r-1', 'Alice', { skills: ['TypeScript'] }),
      ]);
      mockFindByProjectId.mockResolvedValue([]);
      mockFindAssignmentsBySchedule.mockResolvedValue([]);

      const suggestions = [
        {
          type: 'reassign' as const,
          description: 'Reassign task to Bob',
          estimatedImpact: 'Reduces Alice utilization by 20%',
          confidence: 80,
        },
      ];
      mockCompleteWithJsonSchema.mockResolvedValue({ data: suggestions });

      const result = await service.predictBottlenecks('proj-1');

      expect(result.rebalanceSuggestions).toEqual(suggestions);
      expect(mockCompleteWithJsonSchema).toHaveBeenCalledOnce();
    });

    it('skips AI suggestions when AI is disabled', async () => {
      (config as any).AI_ENABLED = false;

      const week1 = futureWeekStart(1);
      const workloads = [
        makeWorkload('r-1', 'Alice', [{ weekStart: week1, utilization: 120 }], {
          isOverAllocated: true,
        }),
      ];

      mockComputeWorkload.mockResolvedValue(workloads);
      mockFindAllResources.mockResolvedValue([]);
      mockFindByProjectId.mockResolvedValue([]);
      mockFindAssignmentsBySchedule.mockResolvedValue([]);

      const result = await service.predictBottlenecks('proj-1');

      expect(result.rebalanceSuggestions).toBeUndefined();
      expect(mockCompleteWithJsonSchema).not.toHaveBeenCalled();
    });

    it('skips AI suggestions when claude service is not available', async () => {
      (config as any).AI_ENABLED = true;
      mockIsAvailable.mockReturnValue(false);

      const week1 = futureWeekStart(1);
      const workloads = [
        makeWorkload('r-1', 'Alice', [{ weekStart: week1, utilization: 120 }], {
          isOverAllocated: true,
        }),
      ];

      mockComputeWorkload.mockResolvedValue(workloads);
      mockFindAllResources.mockResolvedValue([]);
      mockFindByProjectId.mockResolvedValue([]);
      mockFindAssignmentsBySchedule.mockResolvedValue([]);

      const result = await service.predictBottlenecks('proj-1');

      expect(result.rebalanceSuggestions).toBeUndefined();
    });

    it('skips AI suggestions when there are no bottlenecks', async () => {
      (config as any).AI_ENABLED = true;
      mockIsAvailable.mockReturnValue(true);

      const week1 = futureWeekStart(1);
      const workloads = [
        makeWorkload('r-1', 'Alice', [{ weekStart: week1, utilization: 80 }]),
      ];

      mockComputeWorkload.mockResolvedValue(workloads);
      mockFindAllResources.mockResolvedValue([]);

      const result = await service.predictBottlenecks('proj-1');

      expect(result.rebalanceSuggestions).toBeUndefined();
      expect(mockCompleteWithJsonSchema).not.toHaveBeenCalled();
    });

    it('gracefully handles AI suggestion failure', async () => {
      (config as any).AI_ENABLED = true;
      mockIsAvailable.mockReturnValue(true);
      mockCompleteWithJsonSchema.mockRejectedValue(new Error('AI timeout'));

      const week1 = futureWeekStart(1);
      const workloads = [
        makeWorkload('r-1', 'Alice', [{ weekStart: week1, utilization: 120 }], {
          isOverAllocated: true,
        }),
      ];

      mockComputeWorkload.mockResolvedValue(workloads);
      mockFindAllResources.mockResolvedValue([makeResource('r-1', 'Alice')]);
      mockFindByProjectId.mockResolvedValue([]);
      mockFindAssignmentsBySchedule.mockResolvedValue([]);

      const result = await service.predictBottlenecks('proj-1');

      // Should not throw; suggestions are undefined
      expect(result.rebalanceSuggestions).toBeUndefined();
      expect(result.bottlenecks).toHaveLength(1);
    });

    it('includes contributing tasks for bottleneck weeks', async () => {
      const week1 = futureWeekStart(1);
      const weekDate = new Date(week1);
      const weekEnd = new Date(weekDate.getTime() + 7 * 24 * 60 * 60 * 1000);

      const workloads = [
        makeWorkload('r-1', 'Alice', [{ weekStart: week1, utilization: 120 }]),
      ];

      mockComputeWorkload.mockResolvedValue(workloads);
      mockFindAllResources.mockResolvedValue([]);
      mockFindByProjectId.mockResolvedValue([{ id: 'sch-1' }]);
      mockFindAssignmentsBySchedule.mockResolvedValue([
        {
          id: 'a-1',
          resourceId: 'r-1',
          taskId: 't-1',
          scheduleId: 'sch-1',
          hoursPerWeek: 30,
          startDate: weekDate.toISOString().slice(0, 10),
          endDate: weekEnd.toISOString().slice(0, 10),
        },
      ]);
      mockFindTaskById.mockResolvedValue({ id: 't-1', name: 'Build API' });

      const result = await service.predictBottlenecks('proj-1');

      expect(result.bottlenecks[0].contributingTasks).toHaveLength(1);
      expect(result.bottlenecks[0].contributingTasks[0]).toMatchObject({
        taskId: 't-1',
        taskName: 'Build API',
        hoursPerWeek: 30,
      });
    });

    it('uses task ID as fallback name when task not found', async () => {
      const week1 = futureWeekStart(1);
      const weekDate = new Date(week1);
      const weekEnd = new Date(weekDate.getTime() + 7 * 24 * 60 * 60 * 1000);

      const workloads = [
        makeWorkload('r-1', 'Alice', [{ weekStart: week1, utilization: 120 }]),
      ];

      mockComputeWorkload.mockResolvedValue(workloads);
      mockFindAllResources.mockResolvedValue([]);
      mockFindByProjectId.mockResolvedValue([{ id: 'sch-1' }]);
      mockFindAssignmentsBySchedule.mockResolvedValue([
        {
          id: 'a-1',
          resourceId: 'r-1',
          taskId: 't-missing',
          scheduleId: 'sch-1',
          hoursPerWeek: 20,
          startDate: weekDate.toISOString().slice(0, 10),
          endDate: weekEnd.toISOString().slice(0, 10),
        },
      ]);
      mockFindTaskById.mockResolvedValue(null);

      const result = await service.predictBottlenecks('proj-1');

      expect(result.bottlenecks[0].contributingTasks[0].taskName).toBe('t-missing');
    });
  });

  // ── findBestResourceForTask ────────────────────────────────────────

  describe('findBestResourceForTask', () => {
    it('throws when task is not found', async () => {
      mockFindTaskById.mockResolvedValue(null);

      await expect(
        service.findBestResourceForTask('t-404', 'sch-1'),
      ).rejects.toThrow('Task not found: t-404');
    });

    it('returns empty array when no active resources exist', async () => {
      mockFindTaskById.mockResolvedValue({
        id: 't-1',
        name: 'Build API',
        description: 'Create REST endpoints',
      });
      mockFindAllResources.mockResolvedValue([]);
      mockFindAssignmentsBySchedule.mockResolvedValue([]);

      const result = await service.findBestResourceForTask('t-1', 'sch-1');

      expect(result).toEqual([]);
    });

    it('filters out inactive resources', async () => {
      mockFindTaskById.mockResolvedValue({
        id: 't-1',
        name: 'Build API',
      });
      mockFindAllResources.mockResolvedValue([
        makeResource('r-1', 'Alice', { isActive: true, skills: [] }),
        makeResource('r-2', 'Bob', { isActive: false, skills: [] }),
      ]);
      mockFindAssignmentsBySchedule.mockResolvedValue([]);

      const result = await service.findBestResourceForTask('t-1', 'sch-1');

      expect(result).toHaveLength(1);
      expect(result[0].resourceId).toBe('r-1');
    });

    it('matches skills from string skill format', async () => {
      mockFindTaskById.mockResolvedValue({
        id: 't-1',
        name: 'Build TypeScript API',
        description: 'Create REST endpoints',
      });
      mockFindAllResources.mockResolvedValue([
        makeResource('r-1', 'Alice', {
          skills: ['TypeScript', 'Python'],
        }),
      ]);
      mockFindAssignmentsBySchedule.mockResolvedValue([]);

      const result = await service.findBestResourceForTask('t-1', 'sch-1');

      expect(result[0].matchedSkills).toContain('TypeScript');
    });

    it('matches skills from object skill format with proficiency', async () => {
      mockFindTaskById.mockResolvedValue({
        id: 't-1',
        name: 'Build TypeScript API',
        description: '',
      });
      mockFindAllResources.mockResolvedValue([
        makeResource('r-1', 'Alice', {
          skills: [
            { name: 'TypeScript', level: 5 },
            { name: 'Python', level: 3 },
          ],
        }),
      ]);
      mockFindAssignmentsBySchedule.mockResolvedValue([]);

      const result = await service.findBestResourceForTask('t-1', 'sch-1');

      expect(result[0].matchedSkills).toContain('TypeScript');
      expect(result[0].matchScore).toBeGreaterThan(0);
    });

    it('sorts results by matchScore descending, then availableCapacity descending', async () => {
      mockFindTaskById.mockResolvedValue({
        id: 't-1',
        name: 'TypeScript development',
        description: '',
      });
      mockFindAllResources.mockResolvedValue([
        makeResource('r-1', 'Low Match', {
          skills: ['Python'],
          capacityHoursPerWeek: 40,
        }),
        makeResource('r-2', 'High Match', {
          skills: [{ name: 'TypeScript', level: 5 }],
          capacityHoursPerWeek: 40,
        }),
        makeResource('r-3', 'High Match + More Capacity', {
          skills: [{ name: 'TypeScript', level: 5 }],
          capacityHoursPerWeek: 60,
        }),
      ]);
      mockFindAssignmentsBySchedule.mockResolvedValue([]);

      const result = await service.findBestResourceForTask('t-1', 'sch-1');

      // r-3 and r-2 both match TypeScript; r-3 has more capacity
      expect(result[0].resourceId).toBe('r-3');
      expect(result[1].resourceId).toBe('r-2');
      expect(result[2].resourceId).toBe('r-1');
    });

    it('calculates available capacity based on overlapping assignments', async () => {
      const taskStart = '2026-06-01';
      const taskEnd = '2026-06-15';

      mockFindTaskById.mockResolvedValue({
        id: 't-1',
        name: 'Some task',
        startDate: taskStart,
        endDate: taskEnd,
      });
      mockFindAllResources.mockResolvedValue([
        makeResource('r-1', 'Alice', {
          skills: [],
          capacityHoursPerWeek: 40,
        }),
      ]);
      mockFindAssignmentsBySchedule.mockResolvedValue([
        {
          id: 'a-1',
          resourceId: 'r-1',
          taskId: 't-other',
          scheduleId: 'sch-1',
          hoursPerWeek: 25,
          startDate: '2026-06-01',
          endDate: '2026-06-10',
        },
      ]);

      const result = await service.findBestResourceForTask('t-1', 'sch-1');

      // 40 capacity - 25 allocated = 15 available
      expect(result[0].availableCapacity).toBe(15);
    });

    it('does not subtract non-overlapping assignments from capacity', async () => {
      mockFindTaskById.mockResolvedValue({
        id: 't-1',
        name: 'Some task',
        startDate: '2026-06-01',
        endDate: '2026-06-15',
      });
      mockFindAllResources.mockResolvedValue([
        makeResource('r-1', 'Alice', {
          skills: [],
          capacityHoursPerWeek: 40,
        }),
      ]);
      mockFindAssignmentsBySchedule.mockResolvedValue([
        {
          id: 'a-1',
          resourceId: 'r-1',
          taskId: 't-other',
          scheduleId: 'sch-1',
          hoursPerWeek: 30,
          startDate: '2026-07-01',
          endDate: '2026-07-15', // no overlap
        },
      ]);

      const result = await service.findBestResourceForTask('t-1', 'sch-1');

      expect(result[0].availableCapacity).toBe(40);
    });

    it('clamps available capacity to zero when over-allocated', async () => {
      mockFindTaskById.mockResolvedValue({
        id: 't-1',
        name: 'Some task',
        startDate: '2026-06-01',
        endDate: '2026-06-15',
      });
      mockFindAllResources.mockResolvedValue([
        makeResource('r-1', 'Alice', {
          skills: [],
          capacityHoursPerWeek: 40,
        }),
      ]);
      mockFindAssignmentsBySchedule.mockResolvedValue([
        {
          id: 'a-1',
          resourceId: 'r-1',
          taskId: 't-other',
          scheduleId: 'sch-1',
          hoursPerWeek: 50,
          startDate: '2026-06-01',
          endDate: '2026-06-15',
        },
      ]);

      const result = await service.findBestResourceForTask('t-1', 'sch-1');

      expect(result[0].availableCapacity).toBe(0);
    });

    it('returns full capacity when task has no dates', async () => {
      mockFindTaskById.mockResolvedValue({
        id: 't-1',
        name: 'Some task',
        // no startDate, no endDate
      });
      mockFindAllResources.mockResolvedValue([
        makeResource('r-1', 'Alice', {
          skills: [],
          capacityHoursPerWeek: 40,
        }),
      ]);
      mockFindAssignmentsBySchedule.mockResolvedValue([
        {
          id: 'a-1',
          resourceId: 'r-1',
          taskId: 't-other',
          scheduleId: 'sch-1',
          hoursPerWeek: 30,
          startDate: '2026-06-01',
          endDate: '2026-06-15',
        },
      ]);

      const result = await service.findBestResourceForTask('t-1', 'sch-1');

      // No overlap check since task has no dates, so currentAllocated stays 0
      expect(result[0].availableCapacity).toBe(40);
    });

    it('gives zero matchScore when resource has no skills', async () => {
      mockFindTaskById.mockResolvedValue({
        id: 't-1',
        name: 'TypeScript API',
      });
      mockFindAllResources.mockResolvedValue([
        makeResource('r-1', 'Alice', { skills: [] }),
      ]);
      mockFindAssignmentsBySchedule.mockResolvedValue([]);

      const result = await service.findBestResourceForTask('t-1', 'sch-1');

      expect(result[0].matchScore).toBe(0);
      expect(result[0].matchedSkills).toEqual([]);
    });

    it('matches task keywords in skill names (bidirectional)', async () => {
      mockFindTaskById.mockResolvedValue({
        id: 't-1',
        name: 'Frontend development',
        description: 'React components',
      });
      mockFindAllResources.mockResolvedValue([
        makeResource('r-1', 'Alice', {
          skills: ['React Development'],
        }),
      ]);
      mockFindAssignmentsBySchedule.mockResolvedValue([]);

      const result = await service.findBestResourceForTask('t-1', 'sch-1');

      // 'react' from task description matches 'React Development' skill
      expect(result[0].matchedSkills).toContain('React Development');
    });

    it('handles multiple resources with varying skills and capacity', async () => {
      mockFindTaskById.mockResolvedValue({
        id: 't-1',
        name: 'Database migration',
        description: 'MySQL schema changes',
        startDate: '2026-06-01',
        endDate: '2026-06-15',
      });
      mockFindAllResources.mockResolvedValue([
        makeResource('r-1', 'Alice', {
          skills: [
            { name: 'MySQL', level: 5 },
            { name: 'PostgreSQL', level: 3 },
          ],
          capacityHoursPerWeek: 40,
        }),
        makeResource('r-2', 'Bob', {
          skills: [{ name: 'JavaScript', level: 4 }],
          capacityHoursPerWeek: 40,
        }),
        makeResource('r-3', 'Carol', {
          skills: [
            { name: 'MySQL', level: 2 },
            { name: 'Database Admin', level: 4 },
          ],
          capacityHoursPerWeek: 40,
        }),
      ]);
      mockFindAssignmentsBySchedule.mockResolvedValue([]);

      const result = await service.findBestResourceForTask('t-1', 'sch-1');

      // Alice and Carol match MySQL/Database; Bob has no matching skill
      // The top results should be Alice or Carol (both match), Bob last
      expect(result[result.length - 1].resourceId).toBe('r-2');
    });
  });
});
