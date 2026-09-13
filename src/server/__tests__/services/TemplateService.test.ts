import { describe, it, expect, vi, beforeEach } from 'vitest';

// Mock ProjectService
const mockProjectCreate = vi.fn();
const mockProjectFindById = vi.fn();
vi.mock('../../services/ProjectService', () => ({
  projectService: {
    create: (...args: any[]) => mockProjectCreate(...args),
    findById: (...args: any[]) => mockProjectFindById(...args),
  },
}));

// Mock ScheduleService
const mockScheduleCreate = vi.fn();
const mockScheduleCreateTask = vi.fn();
const mockScheduleFindByProjectId = vi.fn();
const mockScheduleFindTasksByScheduleIds = vi.fn();
vi.mock('../../services/ScheduleService', () => ({
  scheduleService: {
    create: (...args: any[]) => mockScheduleCreate(...args),
    createTask: (...args: any[]) => mockScheduleCreateTask(...args),
    findByProjectId: (...args: any[]) => mockScheduleFindByProjectId(...args),
    findTasksByScheduleIds: (...args: any[]) => mockScheduleFindTasksByScheduleIds(...args),
  },
}));

import { TemplateService } from '../../services/TemplateService';

describe('TemplateService', () => {
  let service: TemplateService;

  beforeEach(() => {
    service = new TemplateService();
    vi.clearAllMocks();
  });

  // ── findAll ──────────────────────────────────────────────────────────────

  describe('findAll', () => {
    it('returns all built-in templates when no filters', async () => {
      const templates = await service.findAll();
      expect(templates.length).toBeGreaterThanOrEqual(14);
      expect(templates.every(t => t.id && t.name)).toBe(true);
    });

    it('filters by projectType', async () => {
      const itTemplates = await service.findAll('it');
      expect(itTemplates.length).toBeGreaterThan(0);
      expect(itTemplates.every(t => t.projectType === 'it')).toBe(true);
    });

    it('filters by category', async () => {
      const result = await service.findAll(undefined, 'residential');
      expect(result.length).toBe(1);
      expect(result[0].category).toBe('residential');
    });

    it('filters by both projectType and category', async () => {
      const result = await service.findAll('it', 'cloud_migration');
      expect(result.length).toBe(1);
      expect(result[0].id).toBe('tpl-it-cloud');
    });

    it('returns empty array when no templates match', async () => {
      const result = await service.findAll('nonexistent_type');
      expect(result).toEqual([]);
    });
  });

  // ── findAllPaginated ─────────────────────────────────────────────────────

  describe('findAllPaginated', () => {
    it('returns paginated results with total count', async () => {
      const result = await service.findAllPaginated(5, 0);
      expect(result.rows.length).toBe(5);
      expect(result.total).toBeGreaterThanOrEqual(14);
    });

    it('respects offset', async () => {
      const page1 = await service.findAllPaginated(3, 0);
      const page2 = await service.findAllPaginated(3, 3);
      expect(page1.rows[0].id).not.toBe(page2.rows[0].id);
      expect(page1.total).toBe(page2.total);
    });

    it('returns empty rows when offset exceeds total', async () => {
      const result = await service.findAllPaginated(5, 999);
      expect(result.rows).toEqual([]);
      expect(result.total).toBeGreaterThan(0);
    });

    it('applies filters before pagination', async () => {
      const result = await service.findAllPaginated(100, 0, 'construction');
      expect(result.rows.every(t => t.projectType === 'construction')).toBe(true);
      expect(result.total).toBe(result.rows.length);
    });
  });

  // ── findById ─────────────────────────────────────────────────────────────

  describe('findById', () => {
    it('returns template when found', async () => {
      const template = await service.findById('tpl-it-webapp');
      expect(template).not.toBeNull();
      expect(template!.name).toBe('Web Application Development');
      expect(template!.tasks.length).toBeGreaterThan(0);
    });

    it('returns null when not found', async () => {
      const result = await service.findById('nonexistent');
      expect(result).toBeNull();
    });
  });

  // ── create ───────────────────────────────────────────────────────────────

  describe('create', () => {
    it('creates a new template with generated id and zero usage count', async () => {
      const data = {
        name: 'Test Template',
        description: 'A test template',
        projectType: 'it' as const,
        category: 'test',
        isBuiltIn: false,
        createdBy: 'user-1',
        estimatedDurationDays: 30,
        tasks: [
          { refId: 't1', name: 'Task 1', description: '', estimatedDays: 5, priority: 'medium' as const, parentRefId: null, dependencyRefId: null, dependencyType: 'FS' as const, offsetDays: 0, skills: [], isSummary: false },
        ],
        tags: ['test'],
      };

      const created = await service.create(data);
      expect(created.id).toMatch(/^tpl-/);
      expect(created.usageCount).toBe(0);
      expect(created.name).toBe('Test Template');

      // Verify it's retrievable
      const found = await service.findById(created.id);
      expect(found).not.toBeNull();
      expect(found!.name).toBe('Test Template');
    });
  });

  // ── update ───────────────────────────────────────────────────────────────

  describe('update', () => {
    it('updates a custom template', async () => {
      const created = await service.create({
        name: 'Updatable',
        description: 'desc',
        projectType: 'other' as const,
        category: 'custom',
        isBuiltIn: false,
        createdBy: 'user-1',
        estimatedDurationDays: 10,
        tasks: [],
        tags: [],
      });

      const updated = await service.update(created.id, { name: 'Renamed' });
      expect(updated).not.toBeNull();
      expect(updated!.name).toBe('Renamed');
      expect(updated!.description).toBe('desc'); // unchanged fields preserved
    });

    it('returns null for non-existent template', async () => {
      const result = await service.update('nonexistent', { name: 'X' });
      expect(result).toBeNull();
    });

    it('returns null when trying to update a built-in template', async () => {
      const result = await service.update('tpl-it-webapp', { name: 'Hacked' });
      expect(result).toBeNull();

      // Verify it was not changed
      const original = await service.findById('tpl-it-webapp');
      expect(original!.name).toBe('Web Application Development');
    });
  });

  // ── delete ───────────────────────────────────────────────────────────────

  describe('delete', () => {
    it('deletes a custom template', async () => {
      const created = await service.create({
        name: 'Deletable',
        description: 'will be deleted',
        projectType: 'other' as const,
        category: 'custom',
        isBuiltIn: false,
        createdBy: 'user-1',
        estimatedDurationDays: 5,
        tasks: [],
        tags: [],
      });

      const deleted = await service.delete(created.id);
      expect(deleted).toBe(true);

      const found = await service.findById(created.id);
      expect(found).toBeNull();
    });

    it('returns false for non-existent template', async () => {
      const result = await service.delete('nonexistent');
      expect(result).toBe(false);
    });

    it('returns false when trying to delete a built-in template', async () => {
      const result = await service.delete('tpl-it-webapp');
      expect(result).toBe(false);

      // Verify it still exists
      const found = await service.findById('tpl-it-webapp');
      expect(found).not.toBeNull();
    });
  });

  // ── applyTemplate ────────────────────────────────────────────────────────

  describe('applyTemplate', () => {
    const baseInput = {
      templateId: 'tpl-generic-pmi',
      projectName: 'My Project',
      startDate: '2026-06-01',
      priority: 'high' as const,
      userId: 'user-1',
    };

    beforeEach(() => {
      mockProjectCreate.mockResolvedValue({ id: 'proj-1', name: 'My Project' });
      mockScheduleCreate.mockResolvedValue({ id: 'sched-1', name: 'My Project Schedule' });
      let taskCounter = 0;
      mockScheduleCreateTask.mockImplementation(async (data: any) => ({
        id: `task-${taskCounter++}`,
        name: data.name,
        startDate: data.startDate,
        endDate: data.endDate,
        scheduleId: data.scheduleId,
        dependencies: data.dependencies,
      }));
    });

    it('creates project, schedule, and tasks from template', async () => {
      const result = await service.applyTemplate(baseInput);

      expect(result.project.id).toBe('proj-1');
      expect(result.schedule.id).toBe('sched-1');
      expect(result.tasks.length).toBeGreaterThan(0);

      // Check project was created with template metadata
      expect(mockProjectCreate).toHaveBeenCalledWith(
        expect.objectContaining({
          name: 'My Project',
          projectType: 'other',
          status: 'planning',
          priority: 'high',
          userId: 'user-1',
        }),
      );

      // Check schedule was created
      expect(mockScheduleCreate).toHaveBeenCalledWith(
        expect.objectContaining({
          projectId: 'proj-1',
          createdBy: 'user-1',
        }),
      );
    });

    it('throws when template not found', async () => {
      await expect(
        service.applyTemplate({ ...baseInput, templateId: 'nonexistent' }),
      ).rejects.toThrow('Template not found');
    });

    it('increments usage count on apply', async () => {
      const before = await service.findById('tpl-generic-pmi');
      const usageBefore = before!.usageCount;

      await service.applyTemplate(baseInput);

      const after = await service.findById('tpl-generic-pmi');
      expect(after!.usageCount).toBe(usageBefore + 1);
    });

    it('passes optional budget and methodology', async () => {
      await service.applyTemplate({
        ...baseInput,
        budget: 100000,
        methodology: 'agile',
        location: 'NYC',
      });

      expect(mockProjectCreate).toHaveBeenCalledWith(
        expect.objectContaining({
          budgetAllocated: 100000,
          methodology: 'agile',
          location: 'NYC',
        }),
      );
    });

    it('filters tasks by selectedTaskRefIds while keeping mandatory tasks', async () => {
      // Generic PMI template has mandatory tasks: init-charter, close-deliver, and their parents
      // Let's select only some optional tasks plus the mandatory ones
      const template = await service.findById('tpl-generic-pmi');
      const mandatoryRefIds = template!.tasks
        .filter(t => t.mandatory)
        .map(t => t.refId);
      const selectedRefIds = [...mandatoryRefIds, 'plan-scope'];

      await service.applyTemplate({
        ...baseInput,
        selectedTaskRefIds: selectedRefIds,
      });

      // Tasks should be created — fewer than the full template
      const totalTemplateTasks = template!.tasks.length;
      expect(mockScheduleCreateTask.mock.calls.length).toBeLessThan(totalTemplateTasks);
      expect(mockScheduleCreateTask.mock.calls.length).toBeGreaterThan(0);
    });

    it('throws when mandatory tasks are excluded from selectedTaskRefIds', async () => {
      // Only select non-mandatory tasks, excluding mandatory ones
      await expect(
        service.applyTemplate({
          ...baseInput,
          selectedTaskRefIds: ['plan-scope', 'plan-schedule'],
        }),
      ).rejects.toThrow('Mandatory tasks cannot be excluded');
    });

    it('auto-includes parent summary tasks when child is selected', async () => {
      // Select a child task (init-charter has parent init) plus all mandatory
      const template = await service.findById('tpl-generic-pmi');
      const mandatoryRefIds = template!.tasks
        .filter(t => t.mandatory)
        .map(t => t.refId);

      // init-charter is mandatory and has parent 'init', which should be auto-included
      await service.applyTemplate({
        ...baseInput,
        selectedTaskRefIds: mandatoryRefIds,
      });

      // Check that 'init' (parent of init-charter) was created
      const createdTaskNames = mockScheduleCreateTask.mock.calls.map(
        (c: any[]) => c[0].name,
      );
      expect(createdTaskNames).toContain('Initiation');
    });

    it('creates tasks with correct dependency references', async () => {
      await service.applyTemplate(baseInput);

      // Find a task that should have a dependency
      const callsWithDeps = mockScheduleCreateTask.mock.calls.filter(
        (c: any[]) => c[0].dependencies && c[0].dependencies.length > 0,
      );
      expect(callsWithDeps.length).toBeGreaterThan(0);

      // Each dependency should reference a valid task id
      for (const call of callsWithDeps) {
        const deps = call[0].dependencies;
        for (const dep of deps) {
          expect(dep.dependencyId).toMatch(/^task-/);
        }
      }
    });
  });

  // ── saveFromProject ──────────────────────────────────────────────────────

  describe('saveFromProject', () => {
    it('creates a template from an existing project', async () => {
      mockProjectFindById.mockResolvedValue({
        id: 'proj-1',
        name: 'Source Project',
        projectType: 'it',
        category: 'web_development',
      });

      mockScheduleFindByProjectId.mockResolvedValue([
        { id: 'sched-1', startDate: '2026-06-01' },
      ]);

      mockScheduleFindTasksByScheduleIds.mockResolvedValue([
        {
          id: 'task-a',
          scheduleId: 'sched-1',
          name: 'Task A',
          description: 'First task',
          priority: 'high',
          estimatedDays: 5,
          startDate: '2026-06-01',
          endDate: '2026-06-06',
          parentTaskId: null,
          dependencies: [],
        },
        {
          id: 'task-b',
          scheduleId: 'sched-1',
          name: 'Task B',
          description: 'Second task',
          priority: 'medium',
          estimatedDays: 10,
          startDate: '2026-06-06',
          endDate: '2026-06-16',
          parentTaskId: null,
          dependencies: [{ dependencyId: 'task-a', dependencyType: 'FS' }],
        },
      ]);

      const template = await service.saveFromProject({
        projectId: 'proj-1',
        templateName: 'Saved Template',
        description: 'From project',
        tags: ['saved'],
        userId: 'user-1',
      });

      expect(template.name).toBe('Saved Template');
      expect(template.description).toBe('From project');
      expect(template.projectType).toBe('it');
      expect(template.category).toBe('web_development');
      expect(template.isBuiltIn).toBe(false);
      expect(template.createdBy).toBe('user-1');
      expect(template.tasks.length).toBe(2);
      expect(template.tags).toEqual(['saved']);

      // Verify dependency mapping
      const taskB = template.tasks.find(t => t.name === 'Task B');
      expect(taskB!.dependencyRefId).toBe('saved-0'); // task-a mapped to saved-0
    });

    it('throws when project not found', async () => {
      mockProjectFindById.mockResolvedValue(null);

      await expect(
        service.saveFromProject({
          projectId: 'nonexistent',
          templateName: 'Bad',
          description: '',
          tags: [],
          userId: 'user-1',
        }),
      ).rejects.toThrow('Project not found');
    });

    it('handles project with no tasks', async () => {
      mockProjectFindById.mockResolvedValue({
        id: 'proj-2',
        name: 'Empty Project',
        projectType: 'other',
        category: 'generic',
      });
      mockScheduleFindByProjectId.mockResolvedValue([
        { id: 'sched-2', startDate: '2026-07-01' },
      ]);
      mockScheduleFindTasksByScheduleIds.mockResolvedValue([]);

      const template = await service.saveFromProject({
        projectId: 'proj-2',
        templateName: 'Empty Template',
        description: '',
        tags: [],
        userId: 'user-1',
      });

      expect(template.tasks).toEqual([]);
      expect(template.estimatedDurationDays).toBe(30); // fallback
    });

    it('calculates estimatedDurationDays from max task offsets', async () => {
      mockProjectFindById.mockResolvedValue({
        id: 'proj-3',
        name: 'Long Project',
        projectType: 'it',
        category: 'custom',
      });
      mockScheduleFindByProjectId.mockResolvedValue([
        { id: 'sched-3', startDate: '2026-01-01' },
      ]);
      mockScheduleFindTasksByScheduleIds.mockResolvedValue([
        {
          id: 't1',
          scheduleId: 'sched-3',
          name: 'Task 1',
          description: '',
          priority: 'medium',
          estimatedDays: 10,
          startDate: '2026-01-01',
          endDate: '2026-01-11',
          parentTaskId: null,
          dependencies: [],
        },
        {
          id: 't2',
          scheduleId: 'sched-3',
          name: 'Task 2',
          description: '',
          priority: 'medium',
          estimatedDays: 20,
          startDate: '2026-02-01',
          endDate: '2026-02-21',
          parentTaskId: null,
          dependencies: [],
        },
      ]);

      const template = await service.saveFromProject({
        projectId: 'proj-3',
        templateName: 'Long',
        description: '',
        tags: [],
        userId: 'user-1',
      });

      // Task 2 starts ~31 days after schedule start + 20 days = ~51
      expect(template.estimatedDurationDays).toBeGreaterThan(30);
    });

    it('correctly maps parent-child relationships', async () => {
      mockProjectFindById.mockResolvedValue({
        id: 'proj-4',
        name: 'Hierarchical',
        projectType: 'construction',
        category: 'residential',
      });
      mockScheduleFindByProjectId.mockResolvedValue([
        { id: 'sched-4', startDate: '2026-01-01' },
      ]);
      mockScheduleFindTasksByScheduleIds.mockResolvedValue([
        {
          id: 'parent-1',
          scheduleId: 'sched-4',
          name: 'Parent Task',
          description: '',
          priority: 'high',
          estimatedDays: 20,
          startDate: '2026-01-01',
          endDate: '2026-01-21',
          parentTaskId: null,
          dependencies: [],
        },
        {
          id: 'child-1',
          scheduleId: 'sched-4',
          name: 'Child Task',
          description: '',
          priority: 'medium',
          estimatedDays: 10,
          startDate: '2026-01-01',
          endDate: '2026-01-11',
          parentTaskId: 'parent-1',
          dependencies: [],
        },
      ]);

      const template = await service.saveFromProject({
        projectId: 'proj-4',
        templateName: 'Hierarchy Template',
        description: '',
        tags: [],
        userId: 'user-1',
      });

      const parent = template.tasks.find(t => t.name === 'Parent Task');
      const child = template.tasks.find(t => t.name === 'Child Task');
      expect(parent!.isSummary).toBe(true);
      expect(child!.parentRefId).toBe(parent!.refId);
      expect(parent!.parentRefId).toBeNull();
    });

    it('uses default description when none provided', async () => {
      mockProjectFindById.mockResolvedValue({
        id: 'proj-5',
        name: 'My Project',
        projectType: 'other',
        category: null,
      });
      mockScheduleFindByProjectId.mockResolvedValue([]);
      mockScheduleFindTasksByScheduleIds.mockResolvedValue([]);

      const template = await service.saveFromProject({
        projectId: 'proj-5',
        templateName: 'No Desc',
        description: '',
        tags: [],
        userId: 'user-1',
      });

      // Empty string is falsy, so falls back to the generated description
      expect(template.description).toContain('Template created from project');
    });
  });

  // ── Built-in template integrity ──────────────────────────────────────────

  describe('built-in template integrity', () => {
    it('all built-in templates have isBuiltIn=true', async () => {
      const templates = await service.findAll();
      const builtIn = templates.filter(t => t.isBuiltIn);
      expect(builtIn.length).toBeGreaterThanOrEqual(14);
    });

    it('all built-in templates have tasks with valid refIds', async () => {
      const templates = await service.findAll();
      for (const t of templates.filter(t => t.isBuiltIn)) {
        const refIds = new Set(t.tasks.map(task => task.refId));
        for (const task of t.tasks) {
          if (task.parentRefId) {
            expect(refIds.has(task.parentRefId)).toBe(true);
          }
          if (task.dependencyRefId) {
            expect(refIds.has(task.dependencyRefId)).toBe(true);
          }
        }
      }
    });

    it('covers all expected project types', async () => {
      const templates = await service.findAll();
      const types = new Set(templates.map(t => t.projectType));
      expect(types).toContain('it');
      expect(types).toContain('construction');
      expect(types).toContain('infrastructure');
      expect(types).toContain('roads');
      expect(types).toContain('other');
    });
  });
});
