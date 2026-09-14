import { describe, it, expect, vi, beforeEach } from 'vitest';
import { ProjectAnalysis } from '../../services/aiTaskBreakdown';

// Declare mock functions via vi.hoisted so they're available when vi.mock factories run
const {
  mockAnalyzeProject,
  mockProjectCreate,
  mockScheduleCreate,
  mockCreateTask,
  mockLogAIUsage,
} = vi.hoisted(() => ({
  mockAnalyzeProject: vi.fn(),
  mockProjectCreate: vi.fn(),
  mockScheduleCreate: vi.fn(),
  mockCreateTask: vi.fn(),
  mockLogAIUsage: vi.fn(),
}));

vi.mock('../../services/aiTaskBreakdownClaude', () => ({
  ClaudeTaskBreakdownService: vi.fn().mockImplementation(() => ({
    analyzeProject: mockAnalyzeProject,
  })),
}));

vi.mock('../../services/ProjectService', () => ({
  ProjectService: vi.fn().mockImplementation(() => ({
    create: mockProjectCreate,
  })),
}));

vi.mock('../../services/ScheduleService', () => ({
  ScheduleService: vi.fn().mockImplementation(() => ({
    create: mockScheduleCreate,
    createTask: mockCreateTask,
  })),
}));

vi.mock('../../services/aiUsageLogger', () => ({
  logAIUsage: mockLogAIUsage,
}));

import { AIProjectCreatorService } from '../../services/aiProjectCreator';

function createMockFastify() {
  return {
    log: { info: vi.fn(), error: vi.fn(), warn: vi.fn(), debug: vi.fn() },
  } as any;
}

function createMockAnalysis(overrides: Partial<ProjectAnalysis> = {}): ProjectAnalysis {
  return {
    projectType: 'software',
    complexity: 'medium',
    estimatedDuration: 60,
    riskLevel: 50,
    suggestedPhases: [],
    taskSuggestions: [],
    criticalPath: [],
    resourceRequirements: {},
    ...overrides,
  };
}

describe('AIProjectCreatorService', () => {
  let service: AIProjectCreatorService;

  beforeEach(() => {
    vi.clearAllMocks();
    service = new AIProjectCreatorService(createMockFastify());
  });

  describe('createProjectFromDescription', () => {
    it('creates project, schedule, and tasks from AI analysis (happy path)', async () => {
      const analysis = createMockAnalysis({
        projectType: 'software',
        estimatedDuration: 30,
        riskLevel: 80,
        taskSuggestions: [
          {
            id: 't1',
            name: 'Setup repo',
            description: 'Initialize the repository',
            estimatedDays: 2,
            complexity: 'low',
            priority: 'high',
            dependencies: [],
            riskLevel: 10,
            category: 'setup',
            skills: [],
            deliverables: [],
          },
          {
            id: 't2',
            name: 'Build API',
            description: 'Create REST endpoints',
            estimatedDays: 10,
            complexity: 'high',
            priority: 'medium',
            dependencies: ['t1'],
            riskLevel: 60,
            category: 'development',
            skills: [],
            deliverables: [],
          },
        ],
      });

      mockAnalyzeProject.mockResolvedValue({ analysis, aiPowered: true });
      mockProjectCreate.mockResolvedValue({ id: 'proj-1', name: 'Software: Build a web app' });
      mockScheduleCreate.mockResolvedValue({ id: 'sched-1' });
      mockCreateTask
        .mockResolvedValueOnce({ id: 'task-1', name: 'Setup repo' })
        .mockResolvedValueOnce({ id: 'task-2', name: 'Build API' });

      const result = await service.createProjectFromDescription('Build a web app', 'user-1');

      // Verify AI analysis was called
      expect(mockAnalyzeProject).toHaveBeenCalledWith('Build a web app', undefined, undefined, 'user-1');

      // Verify project created with high priority (riskLevel > 70)
      expect(mockProjectCreate).toHaveBeenCalledWith(
        expect.objectContaining({
          name: expect.stringContaining('Software:'),
          description: 'Build a web app',
          category: 'software',
          status: 'planning',
          priority: 'high',
          userId: 'user-1',
        }),
      );

      // Verify schedule created
      expect(mockScheduleCreate).toHaveBeenCalledWith(
        expect.objectContaining({
          projectId: 'proj-1',
          name: expect.stringContaining('Main Schedule'),
          createdBy: 'user-1',
        }),
      );

      // Verify tasks created
      expect(mockCreateTask).toHaveBeenCalledTimes(2);
      expect(mockCreateTask).toHaveBeenCalledWith(
        expect.objectContaining({
          scheduleId: 'sched-1',
          name: 'Setup repo',
          description: 'Initialize the repository',
          priority: 'high',
          estimatedDays: 2,
          createdBy: 'user-1',
        }),
      );

      // Verify usage logged
      expect(mockLogAIUsage).toHaveBeenCalledWith(
        expect.objectContaining({
          userId: 'user-1',
          feature: 'nl-project-creation',
          model: 'claude',
          success: true,
          requestContext: expect.objectContaining({
            projectId: 'proj-1',
            taskCount: 2,
            aiPowered: true,
          }),
        }),
      );

      // Verify result shape
      expect(result.project).toEqual({ id: 'proj-1', name: 'Software: Build a web app' });
      expect(result.schedule).toEqual({ id: 'sched-1' });
      expect(result.tasks).toHaveLength(2);
      expect(result.analysis).toBe(analysis);
      expect(result.aiPowered).toBe(true);
    });

    it('uses default userId "anonymous" when not provided', async () => {
      const analysis = createMockAnalysis({ taskSuggestions: [] });
      mockAnalyzeProject.mockResolvedValue({ analysis, aiPowered: false });
      mockProjectCreate.mockResolvedValue({ id: 'proj-2' });
      mockScheduleCreate.mockResolvedValue({ id: 'sched-2' });

      await service.createProjectFromDescription('A simple project');

      expect(mockAnalyzeProject).toHaveBeenCalledWith('A simple project', undefined, undefined, 'anonymous');
      expect(mockProjectCreate).toHaveBeenCalledWith(expect.objectContaining({ userId: 'anonymous' }));
      expect(mockScheduleCreate).toHaveBeenCalledWith(expect.objectContaining({ createdBy: 'anonymous' }));
    });

    it('creates zero tasks when analysis has no task suggestions', async () => {
      const analysis = createMockAnalysis({ taskSuggestions: [] });
      mockAnalyzeProject.mockResolvedValue({ analysis, aiPowered: false });
      mockProjectCreate.mockResolvedValue({ id: 'proj-3' });
      mockScheduleCreate.mockResolvedValue({ id: 'sched-3' });

      const result = await service.createProjectFromDescription('Empty project', 'user-2');

      expect(mockCreateTask).not.toHaveBeenCalled();
      expect(result.tasks).toEqual([]);
      expect(mockLogAIUsage).toHaveBeenCalledWith(
        expect.objectContaining({
          requestContext: expect.objectContaining({ taskCount: 0 }),
        }),
      );
    });

    it('sets priority to "medium" when riskLevel is between 41 and 70', async () => {
      const analysis = createMockAnalysis({ riskLevel: 55 });
      mockAnalyzeProject.mockResolvedValue({ analysis, aiPowered: true });
      mockProjectCreate.mockResolvedValue({ id: 'proj-4' });
      mockScheduleCreate.mockResolvedValue({ id: 'sched-4' });

      await service.createProjectFromDescription('Medium risk project', 'user-3');

      expect(mockProjectCreate).toHaveBeenCalledWith(
        expect.objectContaining({ priority: 'medium' }),
      );
    });

    it('sets priority to "low" when riskLevel is 30', async () => {
      const analysis = createMockAnalysis({ riskLevel: 30 });
      mockAnalyzeProject.mockResolvedValue({ analysis, aiPowered: false });
      mockProjectCreate.mockResolvedValue({ id: 'proj-5' });
      mockScheduleCreate.mockResolvedValue({ id: 'sched-5' });

      await service.createProjectFromDescription('Low risk project', 'user-4');

      expect(mockProjectCreate).toHaveBeenCalledWith(
        expect.objectContaining({ priority: 'low' }),
      );
    });

    it('sets priority to "low" when riskLevel is exactly 40 (boundary)', async () => {
      const analysis = createMockAnalysis({ riskLevel: 40 });
      mockAnalyzeProject.mockResolvedValue({ analysis, aiPowered: false });
      mockProjectCreate.mockResolvedValue({ id: 'proj-6' });
      mockScheduleCreate.mockResolvedValue({ id: 'sched-6' });

      await service.createProjectFromDescription('Boundary risk project', 'user-5');

      expect(mockProjectCreate).toHaveBeenCalledWith(
        expect.objectContaining({ priority: 'low' }),
      );
    });

    it('sets priority to "high" when riskLevel is exactly 71 (boundary)', async () => {
      const analysis = createMockAnalysis({ riskLevel: 71 });
      mockAnalyzeProject.mockResolvedValue({ analysis, aiPowered: true });
      mockProjectCreate.mockResolvedValue({ id: 'proj-7' });
      mockScheduleCreate.mockResolvedValue({ id: 'sched-7' });

      await service.createProjectFromDescription('High risk project', 'user-6');

      expect(mockProjectCreate).toHaveBeenCalledWith(
        expect.objectContaining({ priority: 'high' }),
      );
    });

    it('sets priority to "medium" when riskLevel is exactly 70 (boundary)', async () => {
      const analysis = createMockAnalysis({ riskLevel: 70 });
      mockAnalyzeProject.mockResolvedValue({ analysis, aiPowered: true });
      mockProjectCreate.mockResolvedValue({ id: 'proj-70' });
      mockScheduleCreate.mockResolvedValue({ id: 'sched-70' });

      await service.createProjectFromDescription('Risk 70 project', 'user-70');

      expect(mockProjectCreate).toHaveBeenCalledWith(
        expect.objectContaining({ priority: 'medium' }),
      );
    });

    it('falls back to 90-day duration when estimatedDuration is 0 (falsy)', async () => {
      const analysis = createMockAnalysis({ estimatedDuration: 0 });
      mockAnalyzeProject.mockResolvedValue({ analysis, aiPowered: false });
      mockProjectCreate.mockResolvedValue({ id: 'proj-8' });
      mockScheduleCreate.mockResolvedValue({ id: 'sched-8' });

      await service.createProjectFromDescription('No duration project', 'user-7');

      const createCall = mockProjectCreate.mock.calls[0][0];
      const startDate = new Date(createCall.startDate);
      const endDate = new Date(createCall.endDate);
      const diffDays = Math.round((endDate.getTime() - startDate.getTime()) / (1000 * 60 * 60 * 24));
      expect(diffDays).toBe(90);
    });

    it('uses the actual estimatedDuration when provided', async () => {
      const analysis = createMockAnalysis({ estimatedDuration: 45 });
      mockAnalyzeProject.mockResolvedValue({ analysis, aiPowered: true });
      mockProjectCreate.mockResolvedValue({ id: 'proj-9' });
      mockScheduleCreate.mockResolvedValue({ id: 'sched-9' });

      await service.createProjectFromDescription('45 day project', 'user-8');

      const createCall = mockProjectCreate.mock.calls[0][0];
      const startDate = new Date(createCall.startDate);
      const endDate = new Date(createCall.endDate);
      const diffDays = Math.round((endDate.getTime() - startDate.getTime()) / (1000 * 60 * 60 * 24));
      expect(diffDays).toBe(45);
    });

    it('uses "other" category when projectType is falsy', async () => {
      const analysis = createMockAnalysis({ projectType: '' });
      mockAnalyzeProject.mockResolvedValue({ analysis, aiPowered: false });
      mockProjectCreate.mockResolvedValue({ id: 'proj-10' });
      mockScheduleCreate.mockResolvedValue({ id: 'sched-10' });

      await service.createProjectFromDescription('Untyped project', 'user-9');

      expect(mockProjectCreate).toHaveBeenCalledWith(
        expect.objectContaining({ category: 'other' }),
      );
    });

    it('truncates schedule description to first 200 chars of input', async () => {
      const longDescription = 'A'.repeat(300);
      const analysis = createMockAnalysis();
      mockAnalyzeProject.mockResolvedValue({ analysis, aiPowered: false });
      mockProjectCreate.mockResolvedValue({ id: 'proj-11' });
      mockScheduleCreate.mockResolvedValue({ id: 'sched-11' });

      await service.createProjectFromDescription(longDescription, 'user-10');

      const scheduleCall = mockScheduleCreate.mock.calls[0][0];
      expect(scheduleCall.description).toBe(`Auto-generated schedule for: ${'A'.repeat(200)}`);
    });

    it('propagates error when analyzeProject fails', async () => {
      mockAnalyzeProject.mockRejectedValue(new Error('AI service unavailable'));

      await expect(
        service.createProjectFromDescription('Failing project', 'user-11'),
      ).rejects.toThrow('AI service unavailable');

      expect(mockProjectCreate).not.toHaveBeenCalled();
      expect(mockScheduleCreate).not.toHaveBeenCalled();
      expect(mockLogAIUsage).not.toHaveBeenCalled();
    });

    it('propagates error when project creation fails', async () => {
      const analysis = createMockAnalysis();
      mockAnalyzeProject.mockResolvedValue({ analysis, aiPowered: true });
      mockProjectCreate.mockRejectedValue(new Error('DB constraint violation'));

      await expect(
        service.createProjectFromDescription('Bad project', 'user-12'),
      ).rejects.toThrow('DB constraint violation');

      expect(mockScheduleCreate).not.toHaveBeenCalled();
      expect(mockLogAIUsage).not.toHaveBeenCalled();
    });

    it('propagates error when schedule creation fails', async () => {
      const analysis = createMockAnalysis();
      mockAnalyzeProject.mockResolvedValue({ analysis, aiPowered: true });
      mockProjectCreate.mockResolvedValue({ id: 'proj-13' });
      mockScheduleCreate.mockRejectedValue(new Error('Schedule creation failed'));

      await expect(
        service.createProjectFromDescription('Sched fail project', 'user-13'),
      ).rejects.toThrow('Schedule creation failed');

      expect(mockLogAIUsage).not.toHaveBeenCalled();
    });

    it('propagates error when task creation fails mid-way', async () => {
      const analysis = createMockAnalysis({
        taskSuggestions: [
          {
            id: 't1',
            name: 'Task 1',
            description: 'First',
            estimatedDays: 3,
            complexity: 'low',
            priority: 'medium',
            dependencies: [],
            riskLevel: 10,
            category: 'dev',
            skills: [],
            deliverables: [],
          },
          {
            id: 't2',
            name: 'Task 2',
            description: 'Second',
            estimatedDays: 5,
            complexity: 'medium',
            priority: 'high',
            dependencies: [],
            riskLevel: 20,
            category: 'dev',
            skills: [],
            deliverables: [],
          },
        ],
      });
      mockAnalyzeProject.mockResolvedValue({ analysis, aiPowered: true });
      mockProjectCreate.mockResolvedValue({ id: 'proj-14' });
      mockScheduleCreate.mockResolvedValue({ id: 'sched-14' });
      mockCreateTask
        .mockResolvedValueOnce({ id: 'task-1' })
        .mockRejectedValueOnce(new Error('Task creation failed'));

      await expect(
        service.createProjectFromDescription('Partial task fail', 'user-14'),
      ).rejects.toThrow('Task creation failed');

      expect(mockCreateTask).toHaveBeenCalledTimes(2);
      expect(mockLogAIUsage).not.toHaveBeenCalled();
    });

    it('uses default estimatedDays of 7 when task suggestion has estimatedDays=0', async () => {
      const analysis = createMockAnalysis({
        taskSuggestions: [
          {
            id: 't1',
            name: 'Vague task',
            description: 'No estimate',
            estimatedDays: 0,
            complexity: 'low',
            priority: 'medium',
            dependencies: [],
            riskLevel: 10,
            category: 'misc',
            skills: [],
            deliverables: [],
          },
        ],
      });
      mockAnalyzeProject.mockResolvedValue({ analysis, aiPowered: false });
      mockProjectCreate.mockResolvedValue({ id: 'proj-15' });
      mockScheduleCreate.mockResolvedValue({ id: 'sched-15' });
      mockCreateTask.mockResolvedValue({ id: 'task-1' });

      await service.createProjectFromDescription('Vague project', 'user-15');

      const taskCall = mockCreateTask.mock.calls[0][0];
      const now = new Date();
      const dueDate = new Date(taskCall.dueDate);
      const diffDays = Math.round((dueDate.getTime() - now.getTime()) / (1000 * 60 * 60 * 24));
      expect(diffDays).toBe(7);
    });

    it('reports aiPowered=false in result and log when AI was not used', async () => {
      const analysis = createMockAnalysis();
      mockAnalyzeProject.mockResolvedValue({ analysis, aiPowered: false });
      mockProjectCreate.mockResolvedValue({ id: 'proj-16' });
      mockScheduleCreate.mockResolvedValue({ id: 'sched-16' });

      const result = await service.createProjectFromDescription('Fallback project', 'user-16');

      expect(result.aiPowered).toBe(false);
      expect(mockLogAIUsage).toHaveBeenCalledWith(
        expect.objectContaining({
          requestContext: expect.objectContaining({ aiPowered: false }),
        }),
      );
    });
  });

  describe('deriveProjectName (via createProjectFromDescription)', () => {
    it('uses first 6 words of description with capitalized projectType prefix', async () => {
      const analysis = createMockAnalysis({ projectType: 'marketing' });
      mockAnalyzeProject.mockResolvedValue({ analysis, aiPowered: false });
      mockProjectCreate.mockResolvedValue({ id: 'proj-name-1' });
      mockScheduleCreate.mockResolvedValue({ id: 'sched-name-1' });

      await service.createProjectFromDescription('Launch the new product in Q4 and beyond', 'user-n1');

      expect(mockProjectCreate).toHaveBeenCalledWith(
        expect.objectContaining({
          name: 'Marketing: Launch the new product in Q4',
        }),
      );
    });

    it('uses "Project" prefix when projectType is empty', async () => {
      const analysis = createMockAnalysis({ projectType: '' });
      mockAnalyzeProject.mockResolvedValue({ analysis, aiPowered: false });
      mockProjectCreate.mockResolvedValue({ id: 'proj-name-2' });
      mockScheduleCreate.mockResolvedValue({ id: 'sched-name-2' });

      await service.createProjectFromDescription('Do something quick', 'user-n2');

      expect(mockProjectCreate).toHaveBeenCalledWith(
        expect.objectContaining({
          name: 'Project: Do something quick',
        }),
      );
    });

    it('truncates to 50 chars and adds ellipsis for long word sequences', async () => {
      const longWords = 'Supercalifragilistic Expialidocious Extraordinary Phenomenal Outstanding Magnificent';
      const analysis = createMockAnalysis({ projectType: 'software' });
      mockAnalyzeProject.mockResolvedValue({ analysis, aiPowered: false });
      mockProjectCreate.mockResolvedValue({ id: 'proj-name-3' });
      mockScheduleCreate.mockResolvedValue({ id: 'sched-name-3' });

      await service.createProjectFromDescription(longWords, 'user-n3');

      const nameArg = mockProjectCreate.mock.calls[0][0].name;
      // The 6 words joined exceed 50 chars, so it gets sliced to 50 + "..."
      expect(nameArg).toContain('...');
      // The part after "Software: " should be exactly 53 chars (50 + "...")
      const wordsPartWithEllipsis = nameArg.replace('Software: ', '');
      expect(wordsPartWithEllipsis.length).toBe(53);
    });

    it('does not add ellipsis when words fit within 50 chars', async () => {
      const analysis = createMockAnalysis({ projectType: 'design' });
      mockAnalyzeProject.mockResolvedValue({ analysis, aiPowered: false });
      mockProjectCreate.mockResolvedValue({ id: 'proj-name-4' });
      mockScheduleCreate.mockResolvedValue({ id: 'sched-name-4' });

      await service.createProjectFromDescription('Short name', 'user-n4');

      expect(mockProjectCreate).toHaveBeenCalledWith(
        expect.objectContaining({
          name: 'Design: Short name',
        }),
      );
    });

    it('handles single-word description', async () => {
      const analysis = createMockAnalysis({ projectType: 'research' });
      mockAnalyzeProject.mockResolvedValue({ analysis, aiPowered: false });
      mockProjectCreate.mockResolvedValue({ id: 'proj-name-5' });
      mockScheduleCreate.mockResolvedValue({ id: 'sched-name-5' });

      await service.createProjectFromDescription('Migration', 'user-n5');

      expect(mockProjectCreate).toHaveBeenCalledWith(
        expect.objectContaining({
          name: 'Research: Migration',
        }),
      );
    });
  });
});
