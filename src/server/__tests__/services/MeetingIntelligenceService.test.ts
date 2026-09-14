import { describe, it, expect, vi, beforeEach } from 'vitest';

// ---------------------------------------------------------------------------
// Mocks (must be before imports)
// ---------------------------------------------------------------------------

vi.mock('../../database/MeetingAnalysisRepository', () => {
  const mockRepo = {
    upsert: vi.fn().mockResolvedValue(undefined),
    findById: vi.fn().mockResolvedValue(null),
    findByProject: vi.fn().mockResolvedValue([]),
    updateAppliedItems: vi.fn().mockResolvedValue(undefined),
    updateMeetingId: vi.fn().mockResolvedValue(undefined),
  };
  return { meetingAnalysisRepository: mockRepo };
});

vi.mock('../../services/claudeService', () => ({
  claudeService: {
    isAvailable: vi.fn().mockReturnValue(true),
    completeWithJsonSchema: vi.fn().mockResolvedValue({ data: {} }),
  },
}));

vi.mock('../../services/ScheduleService', () => ({
  scheduleService: {
    findTasksByScheduleId: vi.fn().mockResolvedValue([]),
    findById: vi.fn().mockResolvedValue(null),
    findTaskById: vi.fn().mockResolvedValue(null),
    createTask: vi.fn().mockResolvedValue({}),
    updateTask: vi.fn().mockResolvedValue({}),
    logActivity: vi.fn().mockResolvedValue(undefined),
  },
  Task: {},
}));

vi.mock('../../services/ResourceService', () => ({
  resourceService: {
    findAllResources: vi.fn().mockResolvedValue([]),
  },
  Resource: {},
}));

vi.mock('../../services/RagService', () => ({
  ragService: {
    indexMeeting: vi.fn().mockResolvedValue(undefined),
  },
}));

vi.mock('../../config', () => ({
  config: {
    AI_ENABLED: true,
  },
}));

vi.mock('../../utils/logger', () => ({
  default: { warn: vi.fn(), info: vi.fn(), error: vi.fn(), debug: vi.fn() },
}));

vi.mock('../../utils/promptSanitizer', () => ({
  sanitizeForPrompt: vi.fn((s: string) => s),
}));

// ---------------------------------------------------------------------------
// Imports (after mocks)
// ---------------------------------------------------------------------------

import { MeetingIntelligenceService } from '../../services/MeetingIntelligenceService';
import { meetingAnalysisRepository } from '../../database/MeetingAnalysisRepository';
import { claudeService } from '../../services/claudeService';
import { scheduleService } from '../../services/ScheduleService';
import { resourceService } from '../../services/ResourceService';
import { ragService } from '../../services/RagService';
import { config } from '../../config';

const mockAnalysisRepo = meetingAnalysisRepository as any;
const mockClaude = claudeService as any;
const mockSchedule = scheduleService as any;
const mockResource = resourceService as any;
const mockRag = ragService as any;
const mockConfig = config as any;

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

const sampleResources = [
  { name: 'Alice Johnson', role: 'Developer', skills: ['typescript', 'react'] },
  { name: 'Bob Smith', role: 'Designer', skills: ['figma', 'css'] },
  { name: 'Carol Davis', role: 'PM', skills: ['planning'] },
];

const sampleTasks = [
  { id: 'task-1', name: 'Implement auth module', status: 'in_progress', priority: 'high', assignedTo: 'Alice Johnson' },
  { id: 'task-2', name: 'Design landing page', status: 'pending', priority: 'medium', assignedTo: 'Bob Smith' },
  { id: 'task-3', name: 'Write API docs', status: 'pending', priority: 'low', assignedTo: null },
];

const sampleAIResponse = {
  summary: 'Sprint review meeting. Discussed auth module progress and landing page designs.',
  actionItems: [
    { description: 'Finish auth tests', assignee: 'Alice', priority: 'high' as const },
    { description: 'Update wireframes', assignee: 'Bob Smith', priority: 'medium' as const },
  ],
  decisions: [
    { decision: 'Use OAuth2 for authentication', rationale: 'Industry standard', madeBy: 'Carol' },
  ],
  risks: [
    { description: 'API rate limits may cause issues', severity: 'medium' as const, mitigation: 'Implement caching' },
  ],
  issues: [
    { description: 'CI pipeline is slow', severity: 'low' as const, impact: 'Delays deployments' },
  ],
  dependencies: [
    { description: 'Auth module depends on identity provider setup', dependsOn: 'DevOps', blockedItem: 'Auth module' },
  ],
  taskUpdates: [
    { type: 'update_status' as const, taskName: 'Implement auth module', existingTaskId: 'task-1', newStatus: 'completed' as const },
    { type: 'create' as const, taskName: 'Add OAuth2 integration', description: 'Integrate with identity provider', assignee: 'Alice', priority: 'high' as const },
    { type: 'reschedule' as const, taskName: 'Design landing page', existingTaskId: 'task-2', newStartDate: '2026-09-15', newEndDate: '2026-09-30' },
  ],
};

function makeSampleDbRow(overrides: Record<string, any> = {}) {
  return {
    id: 'ma-abc123',
    project_id: 'proj-1',
    schedule_id: 'sch-1',
    transcript: 'Sample transcript',
    summary: 'Sample summary',
    action_items: JSON.stringify([]),
    decisions: JSON.stringify([]),
    risks: JSON.stringify([]),
    issues: JSON.stringify([]),
    dependencies: JSON.stringify([]),
    task_updates: JSON.stringify([
      { type: 'create', taskName: 'New task', priority: 'medium' },
      { type: 'update_status', taskName: 'Implement auth module', existingTaskId: 'task-1', newStatus: 'completed' },
      { type: 'reschedule', taskName: 'Design landing page', existingTaskId: 'task-2', newStartDate: '2026-10-01', newEndDate: '2026-10-15' },
    ]),
    applied_items: JSON.stringify([]),
    created_at: new Date('2026-09-01T10:00:00Z'),
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('MeetingIntelligenceService', () => {
  let service: MeetingIntelligenceService;

  beforeEach(() => {
    vi.clearAllMocks();
    service = new MeetingIntelligenceService();
    mockConfig.AI_ENABLED = true;
    mockClaude.isAvailable.mockReturnValue(true);
    mockSchedule.findTasksByScheduleId.mockResolvedValue(sampleTasks);
    mockSchedule.findById.mockResolvedValue({ id: 'sch-1', name: 'Sprint 1' });
    mockResource.findAllResources.mockResolvedValue(sampleResources);
    mockClaude.completeWithJsonSchema.mockResolvedValue({ data: sampleAIResponse });
    mockRag.indexMeeting.mockResolvedValue(undefined);
  });

  // =========================================================================
  // analyzeTranscript
  // =========================================================================

  describe('analyzeTranscript', () => {
    it('calls AI and returns a well-formed MeetingAnalysis', async () => {
      const result = await service.analyzeTranscript('Meeting transcript text', 'proj-1', 'sch-1', 'user-1');

      expect(result).toBeDefined();
      expect(result.id).toMatch(/^ma-/);
      expect(result.projectId).toBe('proj-1');
      expect(result.scheduleId).toBe('sch-1');
      expect(result.transcript).toBe('Meeting transcript text');
      expect(result.summary).toBe(sampleAIResponse.summary);
      expect(result.actionItems).toHaveLength(2);
      expect(result.decisions).toHaveLength(1);
      expect(result.risks).toHaveLength(1);
      expect(result.issues).toHaveLength(1);
      expect(result.dependencies).toHaveLength(1);
      expect(result.taskUpdates).toHaveLength(3);
      expect(result.appliedItems).toEqual([]);
      expect(result.createdAt).toBeDefined();
    });

    it('gathers schedule tasks and resources for context', async () => {
      await service.analyzeTranscript('transcript', 'proj-1', 'sch-1');

      expect(mockSchedule.findTasksByScheduleId).toHaveBeenCalledWith('sch-1');
      expect(mockSchedule.findById).toHaveBeenCalledWith('sch-1');
      expect(mockResource.findAllResources).toHaveBeenCalled();
    });

    it('passes transcript and context to Claude', async () => {
      await service.analyzeTranscript('transcript here', 'proj-1', 'sch-1');

      expect(mockClaude.completeWithJsonSchema).toHaveBeenCalledWith(
        expect.objectContaining({
          userMessage: expect.stringContaining('transcript here'),
          maxTokens: 8192,
        }),
      );
    });

    it('persists the analysis to the repository', async () => {
      await service.analyzeTranscript('transcript', 'proj-1', 'sch-1');

      expect(mockAnalysisRepo.upsert).toHaveBeenCalledTimes(1);
      const args = mockAnalysisRepo.upsert.mock.calls[0];
      expect(args[1]).toBe('proj-1'); // projectId
      expect(args[2]).toBe('sch-1'); // scheduleId
    });

    it('indexes the analysis in RAG (fire-and-forget)', async () => {
      await service.analyzeTranscript('transcript', 'proj-1', 'sch-1');

      expect(mockRag.indexMeeting).toHaveBeenCalledWith(expect.objectContaining({ projectId: 'proj-1' }));
    });

    it('does not throw if RAG indexing fails', async () => {
      mockRag.indexMeeting.mockRejectedValue(new Error('RAG down'));

      const result = await service.analyzeTranscript('transcript', 'proj-1', 'sch-1');
      expect(result).toBeDefined();
      expect(result.summary).toBe(sampleAIResponse.summary);
    });

    it('links analysis to meetingId when provided', async () => {
      await service.analyzeTranscript('transcript', 'proj-1', 'sch-1', 'user-1', 'meeting-42');

      expect(mockAnalysisRepo.updateMeetingId).toHaveBeenCalledWith(
        expect.stringMatching(/^ma-/),
        'meeting-42',
      );
    });

    it('does not call updateMeetingId when meetingId is not provided', async () => {
      await service.analyzeTranscript('transcript', 'proj-1', 'sch-1', 'user-1');

      expect(mockAnalysisRepo.updateMeetingId).not.toHaveBeenCalled();
    });

    it('does not throw if updateMeetingId fails', async () => {
      mockAnalysisRepo.updateMeetingId.mockRejectedValue(new Error('DB error'));

      const result = await service.analyzeTranscript('transcript', 'proj-1', 'sch-1', 'user-1', 'meeting-42');
      expect(result).toBeDefined();
    });

    // ---- Assignee matching ----

    it('matches partial assignee names to full resource names', async () => {
      const result = await service.analyzeTranscript('transcript', 'proj-1', 'sch-1');

      // 'Alice' should match 'Alice Johnson'
      const aliceAction = result.actionItems.find(a => a.description === 'Finish auth tests');
      expect(aliceAction?.assignee).toBe('Alice Johnson');

      // 'Bob Smith' should match exactly
      const bobAction = result.actionItems.find(a => a.description === 'Update wireframes');
      expect(bobAction?.assignee).toBe('Bob Smith');
    });

    it('matches assignee names in task updates', async () => {
      const result = await service.analyzeTranscript('transcript', 'proj-1', 'sch-1');

      const createUpdate = result.taskUpdates.find(t => t.type === 'create');
      expect(createUpdate?.assignee).toBe('Alice Johnson');
    });

    // ---- Fallback (AI disabled) ----

    it('returns fallback response when AI is disabled', async () => {
      mockConfig.AI_ENABLED = false;

      const result = await service.analyzeTranscript('transcript', 'proj-1', 'sch-1');

      expect(mockClaude.completeWithJsonSchema).not.toHaveBeenCalled();
      expect(result.summary).toContain('AI analysis is currently unavailable');
      expect(result.actionItems).toEqual([]);
      expect(result.taskUpdates).toEqual([]);
    });

    it('returns fallback response when Claude is not available', async () => {
      mockClaude.isAvailable.mockReturnValue(false);

      const result = await service.analyzeTranscript('transcript', 'proj-1', 'sch-1');

      expect(mockClaude.completeWithJsonSchema).not.toHaveBeenCalled();
      expect(result.summary).toContain('AI analysis is currently unavailable');
    });

    // ---- Task ID matching ----

    it('matches existing task IDs for update_status updates', async () => {
      // AI returns update with existingTaskId already set
      const result = await service.analyzeTranscript('transcript', 'proj-1', 'sch-1');

      const statusUpdate = result.taskUpdates.find(t => t.type === 'update_status');
      expect(statusUpdate?.existingTaskId).toBe('task-1');
    });

    it('auto-matches task IDs by name when existingTaskId is missing', async () => {
      const aiResponseNoIds = {
        ...sampleAIResponse,
        taskUpdates: [
          { type: 'update_status' as const, taskName: 'Implement auth module', newStatus: 'completed' as const },
        ],
      };
      mockClaude.completeWithJsonSchema.mockResolvedValue({ data: aiResponseNoIds });

      const result = await service.analyzeTranscript('transcript', 'proj-1', 'sch-1');

      const update = result.taskUpdates[0];
      expect(update.existingTaskId).toBe('task-1');
    });

    it('handles empty tasks and resources gracefully', async () => {
      mockSchedule.findTasksByScheduleId.mockResolvedValue([]);
      mockResource.findAllResources.mockResolvedValue([]);

      const result = await service.analyzeTranscript('transcript', 'proj-1', 'sch-1');
      expect(result).toBeDefined();
    });

    it('handles null schedule gracefully', async () => {
      mockSchedule.findById.mockResolvedValue(null);

      const result = await service.analyzeTranscript('transcript', 'proj-1', 'sch-1');
      expect(result).toBeDefined();
    });

    it('handles AI response with missing optional arrays', async () => {
      const minimalResponse = {
        summary: 'Minimal',
        actionItems: [],
        decisions: [],
        risks: [],
        taskUpdates: [],
        // issues and dependencies omitted
      };
      mockClaude.completeWithJsonSchema.mockResolvedValue({ data: minimalResponse });

      const result = await service.analyzeTranscript('transcript', 'proj-1', 'sch-1');
      expect(result.issues).toEqual([]);
      expect(result.dependencies).toEqual([]);
    });
  });

  // =========================================================================
  // getAnalysis
  // =========================================================================

  describe('getAnalysis', () => {
    it('returns null when analysis is not found', async () => {
      mockAnalysisRepo.findById.mockResolvedValue(null);

      const result = await service.getAnalysis('nonexistent');
      expect(result).toBeNull();
    });

    it('converts a DB row to a MeetingAnalysis object', async () => {
      const row = makeSampleDbRow();
      mockAnalysisRepo.findById.mockResolvedValue(row);

      const result = await service.getAnalysis('ma-abc123');

      expect(result).not.toBeNull();
      expect(result!.id).toBe('ma-abc123');
      expect(result!.projectId).toBe('proj-1');
      expect(result!.scheduleId).toBe('sch-1');
      expect(result!.transcript).toBe('Sample transcript');
      expect(result!.summary).toBe('Sample summary');
      expect(Array.isArray(result!.taskUpdates)).toBe(true);
      expect(result!.taskUpdates).toHaveLength(3);
      expect(result!.appliedItems).toEqual([]);
    });

    it('parses JSON string columns correctly', async () => {
      const row = makeSampleDbRow({
        action_items: JSON.stringify([{ description: 'Do X', assignee: 'Alice', priority: 'high' }]),
        decisions: JSON.stringify([{ decision: 'Use React' }]),
        risks: JSON.stringify([{ description: 'Risk A', severity: 'low' }]),
      });
      mockAnalysisRepo.findById.mockResolvedValue(row);

      const result = await service.getAnalysis('ma-abc123');

      expect(result!.actionItems).toHaveLength(1);
      expect(result!.actionItems[0].description).toBe('Do X');
      expect(result!.decisions).toHaveLength(1);
      expect(result!.risks).toHaveLength(1);
    });

    it('handles Date object for created_at', async () => {
      const row = makeSampleDbRow({ created_at: new Date('2026-09-01T10:00:00Z') });
      mockAnalysisRepo.findById.mockResolvedValue(row);

      const result = await service.getAnalysis('ma-abc123');
      expect(result!.createdAt).toContain('2026');
    });

    it('handles string for created_at', async () => {
      const row = makeSampleDbRow({ created_at: '2026-09-01 10:00:00' });
      mockAnalysisRepo.findById.mockResolvedValue(row);

      const result = await service.getAnalysis('ma-abc123');
      expect(result!.createdAt).toBe('2026-09-01 10:00:00');
    });
  });

  // =========================================================================
  // getProjectHistory
  // =========================================================================

  describe('getProjectHistory', () => {
    it('returns an empty array when no analyses exist', async () => {
      mockAnalysisRepo.findByProject.mockResolvedValue([]);

      const result = await service.getProjectHistory('proj-1');
      expect(result).toEqual([]);
    });

    it('returns mapped MeetingAnalysis objects', async () => {
      const rows = [
        makeSampleDbRow({ id: 'ma-1' }),
        makeSampleDbRow({ id: 'ma-2', summary: 'Second meeting' }),
      ];
      mockAnalysisRepo.findByProject.mockResolvedValue(rows);

      const result = await service.getProjectHistory('proj-1');

      expect(result).toHaveLength(2);
      expect(result[0].id).toBe('ma-1');
      expect(result[1].id).toBe('ma-2');
      expect(result[1].summary).toBe('Second meeting');
    });
  });

  // =========================================================================
  // applyChanges
  // =========================================================================

  describe('applyChanges', () => {
    const analysisRow = makeSampleDbRow();

    beforeEach(() => {
      mockAnalysisRepo.findById.mockResolvedValue(analysisRow);
      mockSchedule.createTask.mockResolvedValue({});
      mockSchedule.updateTask.mockResolvedValue({});
      mockSchedule.logActivity.mockResolvedValue(undefined);
      mockSchedule.findTaskById.mockImplementation(async (id: string) => {
        return sampleTasks.find(t => t.id === id) || null;
      });
    });

    it('returns error when analysis is not found', async () => {
      mockAnalysisRepo.findById.mockResolvedValue(null);

      const result = await service.applyChanges('nonexistent', [0]);
      expect(result.applied).toBe(0);
      expect(result.errors).toContain('Analysis not found: nonexistent');
    });

    it('creates a new task for type=create', async () => {
      const result = await service.applyChanges('ma-abc123', [0]);

      expect(result.applied).toBe(1);
      expect(result.errors).toHaveLength(0);
      expect(mockSchedule.createTask).toHaveBeenCalledWith(
        expect.objectContaining({
          scheduleId: 'sch-1',
          name: 'New task',
        }),
      );
      expect(mockSchedule.logActivity).toHaveBeenCalled();
    });

    it('updates status for type=update_status', async () => {
      const result = await service.applyChanges('ma-abc123', [1]);

      expect(result.applied).toBe(1);
      expect(mockSchedule.updateTask).toHaveBeenCalledWith('task-1', expect.objectContaining({ status: 'completed' }));
    });

    it('reschedules a task for type=reschedule', async () => {
      const result = await service.applyChanges('ma-abc123', [2]);

      expect(result.applied).toBe(1);
      expect(mockSchedule.updateTask).toHaveBeenCalledWith(
        'task-2',
        expect.objectContaining({
          startDate: '2026-10-01',
          endDate: '2026-10-15',
        }),
      );
    });

    it('applies multiple indices at once', async () => {
      const result = await service.applyChanges('ma-abc123', [0, 1, 2]);

      expect(result.applied).toBe(3);
      expect(result.errors).toHaveLength(0);
    });

    it('persists updated appliedItems', async () => {
      await service.applyChanges('ma-abc123', [0, 1]);

      expect(mockAnalysisRepo.updateAppliedItems).toHaveBeenCalledWith(
        'ma-abc123',
        expect.any(String),
      );
      const savedItems = JSON.parse(mockAnalysisRepo.updateAppliedItems.mock.calls[0][1]);
      expect(savedItems).toContain(0);
      expect(savedItems).toContain(1);
    });

    // ---- Error cases ----

    it('returns error for out-of-range index', async () => {
      const result = await service.applyChanges('ma-abc123', [99]);

      expect(result.applied).toBe(0);
      expect(result.errors).toContain('Invalid task update index: 99');
    });

    it('returns error for negative index', async () => {
      const result = await service.applyChanges('ma-abc123', [-1]);

      expect(result.applied).toBe(0);
      expect(result.errors).toContain('Invalid task update index: -1');
    });

    it('returns error when task update was already applied', async () => {
      const rowWithApplied = makeSampleDbRow({ applied_items: JSON.stringify([0]) });
      mockAnalysisRepo.findById.mockResolvedValue(rowWithApplied);

      const result = await service.applyChanges('ma-abc123', [0]);

      expect(result.applied).toBe(0);
      expect(result.errors[0]).toContain('already been applied');
    });

    it('returns error when update_status has no existingTaskId', async () => {
      const rowNoId = makeSampleDbRow({
        task_updates: JSON.stringify([
          { type: 'update_status', taskName: 'Unknown task', newStatus: 'completed' },
        ]),
      });
      mockAnalysisRepo.findById.mockResolvedValue(rowNoId);

      const result = await service.applyChanges('ma-abc123', [0]);

      expect(result.applied).toBe(0);
      expect(result.errors[0]).toContain('no matching existing task found');
    });

    it('returns error when update_status references a nonexistent task', async () => {
      const rowBadId = makeSampleDbRow({
        task_updates: JSON.stringify([
          { type: 'update_status', taskName: 'Gone task', existingTaskId: 'task-gone', newStatus: 'completed' },
        ]),
      });
      mockAnalysisRepo.findById.mockResolvedValue(rowBadId);
      mockSchedule.findTaskById.mockResolvedValue(null);

      const result = await service.applyChanges('ma-abc123', [0]);

      expect(result.applied).toBe(0);
      expect(result.errors[0]).toContain('Task not found: task-gone');
    });

    it('returns error when reschedule has no existingTaskId', async () => {
      const rowNoRescheduleId = makeSampleDbRow({
        task_updates: JSON.stringify([
          { type: 'reschedule', taskName: 'Some task', newStartDate: '2026-10-01' },
        ]),
      });
      mockAnalysisRepo.findById.mockResolvedValue(rowNoRescheduleId);

      const result = await service.applyChanges('ma-abc123', [0]);

      expect(result.applied).toBe(0);
      expect(result.errors[0]).toContain('no matching existing task found');
    });

    it('returns error when reschedule references a nonexistent task', async () => {
      const rowBadRescheduleId = makeSampleDbRow({
        task_updates: JSON.stringify([
          { type: 'reschedule', taskName: 'Gone task', existingTaskId: 'task-gone', newStartDate: '2026-10-01' },
        ]),
      });
      mockAnalysisRepo.findById.mockResolvedValue(rowBadRescheduleId);
      mockSchedule.findTaskById.mockResolvedValue(null);

      const result = await service.applyChanges('ma-abc123', [0]);

      expect(result.applied).toBe(0);
      expect(result.errors[0]).toContain('Task not found: task-gone');
    });

    it('returns error for unknown update type', async () => {
      const rowUnknown = makeSampleDbRow({
        task_updates: JSON.stringify([
          { type: 'delete', taskName: 'Delete me' },
        ]),
      });
      mockAnalysisRepo.findById.mockResolvedValue(rowUnknown);

      const result = await service.applyChanges('ma-abc123', [0]);

      expect(result.applied).toBe(0);
      expect(result.errors[0]).toContain('Unknown update type');
    });

    it('catches and reports errors thrown during task creation', async () => {
      mockSchedule.createTask.mockRejectedValue(new Error('DB write failed'));

      const result = await service.applyChanges('ma-abc123', [0]);

      expect(result.applied).toBe(0);
      expect(result.errors[0]).toContain('Failed to apply');
      expect(result.errors[0]).toContain('DB write failed');
    });

    it('catches and reports errors thrown during task update', async () => {
      mockSchedule.updateTask.mockRejectedValue(new Error('Concurrency conflict'));

      const result = await service.applyChanges('ma-abc123', [1]);

      expect(result.applied).toBe(0);
      expect(result.errors[0]).toContain('Concurrency conflict');
    });

    it('applies valid indices and reports errors for invalid ones', async () => {
      const result = await service.applyChanges('ma-abc123', [0, 99]);

      expect(result.applied).toBe(1);
      expect(result.errors).toHaveLength(1);
      expect(result.errors[0]).toContain('Invalid task update index: 99');
    });

    it('uses userId for createTask createdBy and logActivity', async () => {
      await service.applyChanges('ma-abc123', [0], 'user-42');

      expect(mockSchedule.createTask).toHaveBeenCalledWith(
        expect.objectContaining({ createdBy: 'user-42' }),
      );
      expect(mockSchedule.logActivity).toHaveBeenCalledWith(
        'system',
        'user-42',
        'Meeting Intelligence',
        'created',
        'task',
        undefined,
        'New task',
      );
    });

    it('falls back to default createdBy when userId is not provided', async () => {
      await service.applyChanges('ma-abc123', [0]);

      expect(mockSchedule.createTask).toHaveBeenCalledWith(
        expect.objectContaining({ createdBy: 'meeting-intelligence' }),
      );
    });
  });
});
