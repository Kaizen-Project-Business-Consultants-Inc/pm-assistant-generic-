import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('../../database/StandupEntryRepository', () => {
  const mockRepo = {
    upsert: vi.fn(),
    findById: vi.fn(),
    findBySprintAndDate: vi.fn().mockResolvedValue([]),
    getTimeline: vi.fn().mockResolvedValue([]),
    update: vi.fn(),
    deleteById: vi.fn().mockResolvedValue(true),
  };
  return { standupEntryRepository: mockRepo };
});

vi.mock('../../services/SprintService', () => ({
  sprintService: {
    getById: vi.fn().mockResolvedValue({ id: 's1', status: 'active', projectId: 'p1' }),
  },
}));

vi.mock('../../services/RiskService', () => ({
  riskService: { create: vi.fn().mockResolvedValue({ id: 'r1' }) },
}));

vi.mock('../../services/NotificationService', () => ({
  notificationService: { create: vi.fn().mockResolvedValue({ id: 'n1' }) },
}));

vi.mock('../../database/ProjectMemberRepository', () => ({
  projectMemberRepository: { findByProjectId: vi.fn().mockResolvedValue([]) },
}));

import { standupEntryRepository } from '../../database/StandupEntryRepository';
import { sprintService } from '../../services/SprintService';
import { riskService } from '../../services/RiskService';

const mockRepo = standupEntryRepository as any;
const mockSprint = sprintService as any;

const sampleEntry = {
  id: 'e1', sprintId: 's1', projectId: 'p1', userId: 'u1',
  entryDate: '2026-08-19', yesterday: 'Did stuff', today: 'More stuff',
  blockers: ['Blocked by X'], createdAt: '2026-08-19', updatedAt: '2026-08-19',
};

// Inline import after mocks
const { standupEntryService } = await import('../../services/StandupEntryService');

describe('StandupEntryService', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockSprint.getById.mockResolvedValue({ id: 's1', status: 'active', projectId: 'p1' });
  });

  describe('submit', () => {
    it('upserts entry for active sprint', async () => {
      mockRepo.upsert.mockResolvedValueOnce(sampleEntry);
      const result = await standupEntryService.submit({
        sprintId: 's1', projectId: 'p1', userId: 'u1',
        entryDate: '2026-08-19', yesterday: 'Did stuff', today: 'More stuff',
        blockers: ['Blocked by X'],
      });
      expect(result.id).toBe('e1');
      expect(mockRepo.upsert).toHaveBeenCalledOnce();
    });

    it('rejects submit for non-active sprint', async () => {
      mockSprint.getById.mockResolvedValueOnce({ id: 's1', status: 'planning' });
      await expect(standupEntryService.submit({
        sprintId: 's1', projectId: 'p1', userId: 'u1',
        entryDate: '2026-08-19',
      })).rejects.toThrow('must be active');
    });

    it('creates RAID issues from blockers', async () => {
      mockRepo.upsert.mockResolvedValueOnce(sampleEntry);
      await standupEntryService.submit({
        sprintId: 's1', projectId: 'p1', userId: 'u1',
        entryDate: '2026-08-19', blockers: ['B1', 'B2'],
      });
      // Fire-and-forget — just check it was called
      await new Promise((r) => setTimeout(r, 10));
      expect(riskService.create).toHaveBeenCalledTimes(2);
    });

    it('throws when sprint not found', async () => {
      mockSprint.getById.mockResolvedValueOnce(null);
      await expect(standupEntryService.submit({
        sprintId: 'bad', projectId: 'p1', userId: 'u1', entryDate: '2026-08-19',
      })).rejects.toThrow('not found');
    });
  });

  describe('getByDate', () => {
    it('returns entries for date', async () => {
      mockRepo.findBySprintAndDate.mockResolvedValueOnce([sampleEntry]);
      const entries = await standupEntryService.getByDate('s1', '2026-08-19');
      expect(entries).toHaveLength(1);
    });
  });

  describe('update', () => {
    it('updates own entry', async () => {
      mockRepo.findById.mockResolvedValueOnce(sampleEntry);
      mockRepo.update.mockResolvedValueOnce({ ...sampleEntry, today: 'Updated' });
      const result = await standupEntryService.update('e1', 'u1', { today: 'Updated' });
      expect(result.today).toBe('Updated');
    });

    it('rejects update for other user', async () => {
      mockRepo.findById.mockResolvedValueOnce(sampleEntry);
      await expect(standupEntryService.update('e1', 'other-user', { today: 'Nope' }))
        .rejects.toThrow('only update your own');
    });
  });

  describe('delete', () => {
    it('deletes own entry', async () => {
      mockRepo.findById.mockResolvedValueOnce(sampleEntry);
      await standupEntryService.delete('e1', 'u1');
      expect(mockRepo.deleteById).toHaveBeenCalledWith('e1');
    });

    it('rejects delete for other user', async () => {
      mockRepo.findById.mockResolvedValueOnce(sampleEntry);
      await expect(standupEntryService.delete('e1', 'other-user'))
        .rejects.toThrow('only delete your own');
    });
  });
});
