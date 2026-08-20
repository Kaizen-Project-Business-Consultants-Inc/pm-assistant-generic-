import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('../../database/RetrospectiveRepository', () => {
  const mockRepo = {
    create: vi.fn(),
    findById: vi.fn(),
    findBySprint: vi.fn().mockResolvedValue([]),
    addVote: vi.fn().mockResolvedValue(true),
    removeVote: vi.fn().mockResolvedValue(true),
    getUserVotes: vi.fn().mockResolvedValue([]),
    setConvertedTaskId: vi.fn(),
    deleteWithVotes: vi.fn().mockResolvedValue(true),
  };
  return { retrospectiveRepository: mockRepo };
});

vi.mock('../../services/SprintService', () => ({
  sprintService: {
    getById: vi.fn().mockResolvedValue({ id: 's1', status: 'completed', projectId: 'p1', name: 'Sprint 1', goal: 'Goal', startDate: '2026-08-01', endDate: '2026-08-14' }),
    getSprintBoard: vi.fn().mockResolvedValue({ tasks: [] }),
    getSprintBurndown: vi.fn().mockResolvedValue({ totalPoints: 0, actual: [] }),
    getVelocityHistory: vi.fn().mockResolvedValue({ sprints: [] }),
  },
}));

import { retrospectiveRepository } from '../../database/RetrospectiveRepository';

const mockRepo = retrospectiveRepository as any;

const sampleItem = {
  id: 'ri1', sprintId: 's1', projectId: 'p1', category: 'went_well',
  content: 'Great teamwork', createdBy: 'u1', voteCount: 0,
  convertedTaskId: null, aiGenerated: false,
  createdAt: '2026-08-19', updatedAt: '2026-08-19',
};

const { retrospectiveService } = await import('../../services/RetrospectiveService');

describe('RetrospectiveService', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe('getBoard', () => {
    it('returns items and user votes', async () => {
      mockRepo.findBySprint.mockResolvedValueOnce([sampleItem]);
      mockRepo.getUserVotes.mockResolvedValueOnce(['ri1']);
      const board = await retrospectiveService.getBoard('s1', 'u1');
      expect(board.items).toHaveLength(1);
      expect(board.userVotes).toEqual(['ri1']);
    });
  });

  describe('addItem', () => {
    it('creates a retro item', async () => {
      mockRepo.create.mockResolvedValueOnce(sampleItem);
      const item = await retrospectiveService.addItem({
        sprintId: 's1', projectId: 'p1', category: 'went_well',
        content: 'Great teamwork', createdBy: 'u1',
      });
      expect(item.content).toBe('Great teamwork');
    });
  });

  describe('deleteItem', () => {
    it('deletes own item', async () => {
      mockRepo.findById.mockResolvedValueOnce(sampleItem);
      await retrospectiveService.deleteItem('ri1', 'u1');
      expect(mockRepo.deleteWithVotes).toHaveBeenCalledWith('ri1');
    });

    it('rejects delete for other user', async () => {
      mockRepo.findById.mockResolvedValueOnce(sampleItem);
      await expect(retrospectiveService.deleteItem('ri1', 'other'))
        .rejects.toThrow('only delete your own');
    });
  });

  describe('vote / unvote', () => {
    it('adds vote', async () => {
      await retrospectiveService.vote('ri1', 'u1');
      expect(mockRepo.addVote).toHaveBeenCalledWith('ri1', 'u1');
    });

    it('removes vote', async () => {
      await retrospectiveService.unvote('ri1', 'u1');
      expect(mockRepo.removeVote).toHaveBeenCalledWith('ri1', 'u1');
    });
  });

  describe('convertToTask', () => {
    it('rejects non-action items', async () => {
      mockRepo.findById.mockResolvedValueOnce(sampleItem); // category: went_well
      await expect(retrospectiveService.convertToTask('ri1', 'sch1', 'u1'))
        .rejects.toThrow('Only action items');
    });

    it('rejects already converted items', async () => {
      mockRepo.findById.mockResolvedValueOnce({
        ...sampleItem, category: 'action_item', convertedTaskId: 't1',
      });
      await expect(retrospectiveService.convertToTask('ri1', 'sch1', 'u1'))
        .rejects.toThrow('already converted');
    });
  });
});
