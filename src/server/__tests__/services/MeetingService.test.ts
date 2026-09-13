import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('../../database/MeetingRepository', () => {
  const mockRepo = {
    create: vi.fn(),
    findAll: vi.fn().mockResolvedValue([]),
    findById: vi.fn().mockResolvedValue(null),
    update: vi.fn(),
    delete: vi.fn(),
    findUpcoming: vi.fn().mockResolvedValue([]),
  };
  return { meetingRepository: mockRepo };
});

vi.mock('../../database/MeetingActionItemRepository', () => {
  const mockRepo = {
    findByMeeting: vi.fn().mockResolvedValue([]),
    create: vi.fn(),
    deleteByMeeting: vi.fn(),
  };
  return { meetingActionItemRepository: mockRepo };
});

vi.mock('../../database/MeetingAnalysisRepository', () => {
  const mockRepo = {
    findByMeeting: vi.fn().mockResolvedValue([]),
    findById: vi.fn().mockResolvedValue(null),
    updateMeetingId: vi.fn(),
  };
  return { meetingAnalysisRepository: mockRepo };
});

vi.mock('../../services/AuditLedgerService', () => ({
  auditLedgerService: { append: vi.fn().mockResolvedValue({}) },
}));

vi.mock('../../services/DeadLetterService', () => ({
  deadLetterService: { capture: vi.fn() },
}));

vi.mock('../../utils/logger', () => ({
  default: { warn: vi.fn(), info: vi.fn(), error: vi.fn() },
}));

import { meetingService } from '../../services/MeetingService';
import { meetingRepository } from '../../database/MeetingRepository';
import { meetingActionItemRepository } from '../../database/MeetingActionItemRepository';
import { meetingAnalysisRepository } from '../../database/MeetingAnalysisRepository';
import { auditLedgerService } from '../../services/AuditLedgerService';

const mockMeetingRepo = meetingRepository as any;
const mockActionItemRepo = meetingActionItemRepository as any;
const mockAnalysisRepo = meetingAnalysisRepository as any;
const mockAudit = auditLedgerService as any;

const sampleMeeting = {
  id: 'm1',
  projectId: 'p1',
  title: 'Sprint Planning',
  meetingType: 'planning',
  scheduledDate: '2026-08-01T10:00:00Z',
  durationMinutes: 60,
  location: 'Room A',
  attendees: ['Alice', 'Bob'],
  agendaItems: [{ title: 'Review backlog' }],
  notes: null,
  status: 'scheduled',
  createdBy: 'u1',
  createdAt: '2026-07-01',
  updatedAt: '2026-07-01',
};

const sampleActionItem = {
  id: 'ai1',
  meetingId: 'm1',
  projectId: 'p1',
  description: 'Follow up on design',
  assigneeName: 'Alice',
  assigneeUserId: null,
  dueDate: '2026-08-10',
  priority: 'medium',
  status: 'open',
  completedAt: null,
  source: 'manual',
  sourceAnalysisId: null,
  notes: null,
  createdBy: 'u1',
  createdAt: '2026-07-01',
  updatedAt: '2026-07-01',
};

const sampleAnalysis = {
  id: 'an1',
  project_id: 'p1',
  schedule_id: 'sch1',
  transcript: 'transcript text',
  summary: 'summary text',
  action_items: JSON.stringify([
    { description: 'Task A', assignee: 'Alice', dueDate: '2026-08-15', priority: 'high' },
    { description: 'Task B', assignee: 'Bob' },
  ]),
  decisions: '[]',
  risks: '[]',
  issues: '[]',
  dependencies: '[]',
  task_updates: '[]',
  applied_items: '[]',
  created_at: '2026-07-01',
};

describe('MeetingService', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  // ─── createMeeting ─────────────────────────────────────────────
  describe('createMeeting', () => {
    it('creates meeting, logs audit, and returns result', async () => {
      mockMeetingRepo.create.mockResolvedValueOnce(sampleMeeting);

      const result = await meetingService.createMeeting('p1', {
        title: 'Sprint Planning',
        scheduledDate: '2026-08-01T10:00:00Z',
        meetingType: 'planning',
        durationMinutes: 60,
      }, 'u1');

      expect(result).toEqual(sampleMeeting);
      expect(mockMeetingRepo.create).toHaveBeenCalledWith({
        title: 'Sprint Planning',
        scheduledDate: '2026-08-01T10:00:00Z',
        meetingType: 'planning',
        durationMinutes: 60,
        projectId: 'p1',
        createdBy: 'u1',
      });
      expect(mockAudit.append).toHaveBeenCalledWith(
        expect.objectContaining({
          action: 'meeting.create',
          entityType: 'meeting',
          entityId: 'm1',
          projectId: 'p1',
        }),
      );
    });

    it('passes optional fields through to repository', async () => {
      mockMeetingRepo.create.mockResolvedValueOnce(sampleMeeting);

      await meetingService.createMeeting('p1', {
        title: 'Standup',
        scheduledDate: '2026-08-02',
        attendees: ['Alice'],
        agendaItems: [{ title: 'Updates' }],
        location: 'Zoom',
        notes: 'Daily sync',
      }, 'u1');

      expect(mockMeetingRepo.create).toHaveBeenCalledWith(
        expect.objectContaining({
          attendees: ['Alice'],
          agendaItems: [{ title: 'Updates' }],
          location: 'Zoom',
          notes: 'Daily sync',
        }),
      );
    });
  });

  // ─── updateMeeting ─────────────────────────────────────────────
  describe('updateMeeting', () => {
    it('updates meeting when found', async () => {
      mockMeetingRepo.findById.mockResolvedValueOnce(sampleMeeting);
      const updated = { ...sampleMeeting, title: 'Renamed' };
      mockMeetingRepo.update.mockResolvedValueOnce(updated);

      const result = await meetingService.updateMeeting('m1', { title: 'Renamed' }, 'u1');

      expect(result.title).toBe('Renamed');
      expect(mockMeetingRepo.update).toHaveBeenCalledWith('m1', { title: 'Renamed' });
      expect(mockAudit.append).toHaveBeenCalledWith(
        expect.objectContaining({
          action: 'meeting.update',
          payload: { fields: ['title'] },
        }),
      );
    });

    it('throws when meeting not found', async () => {
      mockMeetingRepo.findById.mockResolvedValueOnce(null);

      await expect(
        meetingService.updateMeeting('nonexistent', { title: 'X' }, 'u1'),
      ).rejects.toThrow('Meeting not found');

      expect(mockMeetingRepo.update).not.toHaveBeenCalled();
    });
  });

  // ─── deleteMeeting ─────────────────────────────────────────────
  describe('deleteMeeting', () => {
    it('cascades deletes: action items, unlinks analyses, deletes meeting', async () => {
      mockMeetingRepo.findById.mockResolvedValueOnce(sampleMeeting);
      mockAnalysisRepo.findByMeeting.mockResolvedValueOnce([sampleAnalysis]);

      await meetingService.deleteMeeting('m1', 'u1');

      expect(mockActionItemRepo.deleteByMeeting).toHaveBeenCalledWith('m1');
      expect(mockAnalysisRepo.updateMeetingId).toHaveBeenCalledWith('an1', null);
      expect(mockMeetingRepo.delete).toHaveBeenCalledWith('m1');
      expect(mockAudit.append).toHaveBeenCalledWith(
        expect.objectContaining({
          action: 'meeting.delete',
          payload: { title: 'Sprint Planning' },
        }),
      );
    });

    it('handles deletion with no linked analyses', async () => {
      mockMeetingRepo.findById.mockResolvedValueOnce(sampleMeeting);
      mockAnalysisRepo.findByMeeting.mockResolvedValueOnce([]);

      await meetingService.deleteMeeting('m1', 'u1');

      expect(mockAnalysisRepo.updateMeetingId).not.toHaveBeenCalled();
      expect(mockMeetingRepo.delete).toHaveBeenCalledWith('m1');
    });

    it('unlinks multiple analyses', async () => {
      const analyses = [
        { ...sampleAnalysis, id: 'an1' },
        { ...sampleAnalysis, id: 'an2' },
        { ...sampleAnalysis, id: 'an3' },
      ];
      mockMeetingRepo.findById.mockResolvedValueOnce(sampleMeeting);
      mockAnalysisRepo.findByMeeting.mockResolvedValueOnce(analyses);

      await meetingService.deleteMeeting('m1', 'u1');

      expect(mockAnalysisRepo.updateMeetingId).toHaveBeenCalledTimes(3);
      expect(mockAnalysisRepo.updateMeetingId).toHaveBeenCalledWith('an1', null);
      expect(mockAnalysisRepo.updateMeetingId).toHaveBeenCalledWith('an2', null);
      expect(mockAnalysisRepo.updateMeetingId).toHaveBeenCalledWith('an3', null);
    });

    it('throws when meeting not found', async () => {
      mockMeetingRepo.findById.mockResolvedValueOnce(null);

      await expect(
        meetingService.deleteMeeting('nonexistent', 'u1'),
      ).rejects.toThrow('Meeting not found');

      expect(mockActionItemRepo.deleteByMeeting).not.toHaveBeenCalled();
      expect(mockMeetingRepo.delete).not.toHaveBeenCalled();
    });
  });

  // ─── getMeetings ────────────────────────────────────────────────
  describe('getMeetings', () => {
    it('delegates to repository findAll with filters', async () => {
      mockMeetingRepo.findAll.mockResolvedValueOnce([sampleMeeting]);

      const filters = { status: 'scheduled', type: 'planning' };
      const result = await meetingService.getMeetings('p1', filters);

      expect(result).toEqual([sampleMeeting]);
      expect(mockMeetingRepo.findAll).toHaveBeenCalledWith('p1', filters);
    });

    it('works without filters', async () => {
      mockMeetingRepo.findAll.mockResolvedValueOnce([]);

      const result = await meetingService.getMeetings('p1');

      expect(result).toEqual([]);
      expect(mockMeetingRepo.findAll).toHaveBeenCalledWith('p1', undefined);
    });
  });

  // ─── getMeeting ─────────────────────────────────────────────────
  describe('getMeeting', () => {
    it('returns meeting with action items and analyses', async () => {
      mockMeetingRepo.findById.mockResolvedValueOnce(sampleMeeting);
      mockActionItemRepo.findByMeeting.mockResolvedValueOnce([sampleActionItem]);
      mockAnalysisRepo.findByMeeting.mockResolvedValueOnce([sampleAnalysis]);

      const result = await meetingService.getMeeting('m1');

      expect(result).not.toBeNull();
      expect(result!.meeting).toEqual(sampleMeeting);
      expect(result!.actionItems).toEqual([sampleActionItem]);
      expect(result!.analyses).toEqual([sampleAnalysis]);
    });

    it('returns null when meeting not found', async () => {
      mockMeetingRepo.findById.mockResolvedValueOnce(null);

      const result = await meetingService.getMeeting('nonexistent');

      expect(result).toBeNull();
      expect(mockActionItemRepo.findByMeeting).not.toHaveBeenCalled();
      expect(mockAnalysisRepo.findByMeeting).not.toHaveBeenCalled();
    });

    it('returns empty arrays when no action items or analyses', async () => {
      mockMeetingRepo.findById.mockResolvedValueOnce(sampleMeeting);
      mockActionItemRepo.findByMeeting.mockResolvedValueOnce([]);
      mockAnalysisRepo.findByMeeting.mockResolvedValueOnce([]);

      const result = await meetingService.getMeeting('m1');

      expect(result!.actionItems).toEqual([]);
      expect(result!.analyses).toEqual([]);
    });
  });

  // ─── completeMeeting ───────────────────────────────────────────
  describe('completeMeeting', () => {
    it('completes a scheduled meeting', async () => {
      mockMeetingRepo.findById.mockResolvedValueOnce(sampleMeeting);
      const completed = { ...sampleMeeting, status: 'completed' };
      mockMeetingRepo.update.mockResolvedValueOnce(completed);

      const result = await meetingService.completeMeeting('m1', 'u1');

      expect(result.status).toBe('completed');
      expect(mockMeetingRepo.update).toHaveBeenCalledWith('m1', { status: 'completed' });
    });

    it('completes an in_progress meeting', async () => {
      const inProgress = { ...sampleMeeting, status: 'in_progress' };
      mockMeetingRepo.findById.mockResolvedValueOnce(inProgress);
      mockMeetingRepo.update.mockResolvedValueOnce({ ...inProgress, status: 'completed' });

      const result = await meetingService.completeMeeting('m1', 'u1');
      expect(result.status).toBe('completed');
    });

    it('throws when meeting not found', async () => {
      mockMeetingRepo.findById.mockResolvedValueOnce(null);

      await expect(
        meetingService.completeMeeting('nonexistent', 'u1'),
      ).rejects.toThrow('Meeting not found');
    });

    it('throws when meeting is cancelled', async () => {
      const cancelled = { ...sampleMeeting, status: 'cancelled' };
      mockMeetingRepo.findById.mockResolvedValueOnce(cancelled);

      await expect(
        meetingService.completeMeeting('m1', 'u1'),
      ).rejects.toThrow('Cannot complete a cancelled meeting');

      expect(mockMeetingRepo.update).not.toHaveBeenCalled();
    });
  });

  // ─── cancelMeeting ─────────────────────────────────────────────
  describe('cancelMeeting', () => {
    it('cancels a scheduled meeting', async () => {
      mockMeetingRepo.findById.mockResolvedValueOnce(sampleMeeting);
      const cancelled = { ...sampleMeeting, status: 'cancelled' };
      mockMeetingRepo.update.mockResolvedValueOnce(cancelled);

      const result = await meetingService.cancelMeeting('m1', 'u1');

      expect(result.status).toBe('cancelled');
      expect(mockMeetingRepo.update).toHaveBeenCalledWith('m1', { status: 'cancelled' });
    });

    it('throws when meeting not found', async () => {
      mockMeetingRepo.findById.mockResolvedValueOnce(null);

      await expect(
        meetingService.cancelMeeting('nonexistent', 'u1'),
      ).rejects.toThrow('Meeting not found');
    });

    it('throws when meeting is already completed', async () => {
      const completed = { ...sampleMeeting, status: 'completed' };
      mockMeetingRepo.findById.mockResolvedValueOnce(completed);

      await expect(
        meetingService.cancelMeeting('m1', 'u1'),
      ).rejects.toThrow('Cannot cancel a completed meeting');

      expect(mockMeetingRepo.update).not.toHaveBeenCalled();
    });
  });

  // ─── getUpcoming ────────────────────────────────────────────────
  describe('getUpcoming', () => {
    it('returns upcoming meetings for project', async () => {
      const upcoming = [sampleMeeting];
      mockMeetingRepo.findUpcoming.mockResolvedValueOnce(upcoming);

      const result = await meetingService.getUpcoming('p1');

      expect(result).toEqual(upcoming);
      expect(mockMeetingRepo.findUpcoming).toHaveBeenCalledWith('p1', 5);
    });

    it('returns empty array when no upcoming meetings', async () => {
      mockMeetingRepo.findUpcoming.mockResolvedValueOnce([]);

      const result = await meetingService.getUpcoming('p1');

      expect(result).toEqual([]);
    });
  });

  // ─── linkAnalysis ───────────────────────────────────────────────
  describe('linkAnalysis', () => {
    it('links analysis to meeting', async () => {
      mockMeetingRepo.findById.mockResolvedValueOnce(sampleMeeting);
      mockAnalysisRepo.findById.mockResolvedValueOnce(sampleAnalysis);

      await meetingService.linkAnalysis('m1', 'an1');

      expect(mockAnalysisRepo.updateMeetingId).toHaveBeenCalledWith('an1', 'm1');
    });

    it('throws when meeting not found', async () => {
      mockMeetingRepo.findById.mockResolvedValueOnce(null);

      await expect(
        meetingService.linkAnalysis('nonexistent', 'an1'),
      ).rejects.toThrow('Meeting not found');

      expect(mockAnalysisRepo.updateMeetingId).not.toHaveBeenCalled();
    });

    it('throws when analysis not found', async () => {
      mockMeetingRepo.findById.mockResolvedValueOnce(sampleMeeting);
      mockAnalysisRepo.findById.mockResolvedValueOnce(null);

      await expect(
        meetingService.linkAnalysis('m1', 'nonexistent'),
      ).rejects.toThrow('Analysis not found');

      expect(mockAnalysisRepo.updateMeetingId).not.toHaveBeenCalled();
    });
  });

  // ─── importActionItemsFromAnalysis ──────────────────────────────
  describe('importActionItemsFromAnalysis', () => {
    it('imports action items from analysis with full fields', async () => {
      mockMeetingRepo.findById.mockResolvedValueOnce(sampleMeeting);
      mockAnalysisRepo.findById.mockResolvedValueOnce(sampleAnalysis);
      mockActionItemRepo.create.mockResolvedValue(sampleActionItem);

      const count = await meetingService.importActionItemsFromAnalysis('m1', 'an1', 'u1');

      expect(count).toBe(2);
      expect(mockActionItemRepo.create).toHaveBeenCalledTimes(2);
      expect(mockActionItemRepo.create).toHaveBeenCalledWith(
        expect.objectContaining({
          meetingId: 'm1',
          projectId: 'p1',
          description: 'Task A',
          assigneeName: 'Alice',
          dueDate: '2026-08-15',
          priority: 'high',
          source: 'ai_extracted',
          sourceAnalysisId: 'an1',
          createdBy: 'u1',
        }),
      );
      // Second item has defaults for missing fields
      expect(mockActionItemRepo.create).toHaveBeenCalledWith(
        expect.objectContaining({
          description: 'Task B',
          assigneeName: 'Bob',
          dueDate: null,
          priority: 'medium',
        }),
      );
    });

    it('handles action_items as already-parsed array', async () => {
      const analysisWithParsed = {
        ...sampleAnalysis,
        action_items: [{ description: 'Parsed item' }],
      };
      mockMeetingRepo.findById.mockResolvedValueOnce(sampleMeeting);
      mockAnalysisRepo.findById.mockResolvedValueOnce(analysisWithParsed);
      mockActionItemRepo.create.mockResolvedValue(sampleActionItem);

      const count = await meetingService.importActionItemsFromAnalysis('m1', 'an1', 'u1');

      expect(count).toBe(1);
      expect(mockActionItemRepo.create).toHaveBeenCalledWith(
        expect.objectContaining({ description: 'Parsed item' }),
      );
    });

    it('returns 0 for empty action_items array', async () => {
      const analysisEmpty = { ...sampleAnalysis, action_items: '[]' };
      mockMeetingRepo.findById.mockResolvedValueOnce(sampleMeeting);
      mockAnalysisRepo.findById.mockResolvedValueOnce(analysisEmpty);

      const count = await meetingService.importActionItemsFromAnalysis('m1', 'an1', 'u1');

      expect(count).toBe(0);
      expect(mockActionItemRepo.create).not.toHaveBeenCalled();
    });

    it('returns 0 for invalid JSON in action_items', async () => {
      const analysisBadJson = { ...sampleAnalysis, action_items: 'not valid json{{{' };
      mockMeetingRepo.findById.mockResolvedValueOnce(sampleMeeting);
      mockAnalysisRepo.findById.mockResolvedValueOnce(analysisBadJson);

      const count = await meetingService.importActionItemsFromAnalysis('m1', 'an1', 'u1');

      expect(count).toBe(0);
      expect(mockActionItemRepo.create).not.toHaveBeenCalled();
    });

    it('returns 0 when action_items parses to non-array', async () => {
      const analysisObj = { ...sampleAnalysis, action_items: '{"key":"val"}' };
      mockMeetingRepo.findById.mockResolvedValueOnce(sampleMeeting);
      mockAnalysisRepo.findById.mockResolvedValueOnce(analysisObj);

      const count = await meetingService.importActionItemsFromAnalysis('m1', 'an1', 'u1');

      expect(count).toBe(0);
    });

    it('uses String(item) as description for plain string items', async () => {
      const analysisStrings = {
        ...sampleAnalysis,
        action_items: JSON.stringify(['Do thing one', 'Do thing two']),
      };
      mockMeetingRepo.findById.mockResolvedValueOnce(sampleMeeting);
      mockAnalysisRepo.findById.mockResolvedValueOnce(analysisStrings);
      mockActionItemRepo.create.mockResolvedValue(sampleActionItem);

      const count = await meetingService.importActionItemsFromAnalysis('m1', 'an1', 'u1');

      expect(count).toBe(2);
      expect(mockActionItemRepo.create).toHaveBeenCalledWith(
        expect.objectContaining({ description: 'Do thing one' }),
      );
      expect(mockActionItemRepo.create).toHaveBeenCalledWith(
        expect.objectContaining({ description: 'Do thing two' }),
      );
    });

    it('continues importing when individual items fail', async () => {
      const analysisThreeItems = {
        ...sampleAnalysis,
        action_items: JSON.stringify([
          { description: 'Item 1' },
          { description: 'Item 2' },
          { description: 'Item 3' },
        ]),
      };
      mockMeetingRepo.findById.mockResolvedValueOnce(sampleMeeting);
      mockAnalysisRepo.findById.mockResolvedValueOnce(analysisThreeItems);
      mockActionItemRepo.create
        .mockResolvedValueOnce(sampleActionItem) // Item 1 succeeds
        .mockRejectedValueOnce(new Error('DB error')) // Item 2 fails
        .mockResolvedValueOnce(sampleActionItem); // Item 3 succeeds

      const count = await meetingService.importActionItemsFromAnalysis('m1', 'an1', 'u1');

      expect(count).toBe(2);
      expect(mockActionItemRepo.create).toHaveBeenCalledTimes(3);
    });

    it('throws when meeting not found', async () => {
      mockMeetingRepo.findById.mockResolvedValueOnce(null);

      await expect(
        meetingService.importActionItemsFromAnalysis('nonexistent', 'an1', 'u1'),
      ).rejects.toThrow('Meeting not found');
    });

    it('throws when analysis not found', async () => {
      mockMeetingRepo.findById.mockResolvedValueOnce(sampleMeeting);
      mockAnalysisRepo.findById.mockResolvedValueOnce(null);

      await expect(
        meetingService.importActionItemsFromAnalysis('m1', 'nonexistent', 'u1'),
      ).rejects.toThrow('Analysis not found');
    });
  });
});
