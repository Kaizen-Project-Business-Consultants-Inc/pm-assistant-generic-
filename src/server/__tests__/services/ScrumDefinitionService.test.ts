import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('../../database/ScrumDefinitionRepository', () => {
  const mockRepo = {
    upsert: vi.fn(),
    findByProject: vi.fn().mockResolvedValue([]),
    findByProjectAndType: vi.fn().mockResolvedValue(null),
  };
  return { scrumDefinitionRepository: mockRepo };
});

vi.mock('../../database/TaskChecklistRepository', () => {
  const mockRepo = {
    upsert: vi.fn(),
    findByTask: vi.fn().mockResolvedValue([]),
    findByTaskAndType: vi.fn().mockResolvedValue(null),
    findById: vi.fn().mockResolvedValue(null),
    updateItems: vi.fn(),
    getReadinessBulk: vi.fn().mockResolvedValue({}),
  };
  return { taskChecklistRepository: mockRepo };
});

import { scrumDefinitionRepository } from '../../database/ScrumDefinitionRepository';
import { taskChecklistRepository } from '../../database/TaskChecklistRepository';

const mockDefRepo = scrumDefinitionRepository as any;
const mockChecklistRepo = taskChecklistRepository as any;

const sampleDor = {
  id: 'd1', projectId: 'p1', type: 'dor',
  criteria: [{ id: 'c1', label: 'AC defined', order: 0 }],
  createdBy: 'u1', createdAt: '2026-08-19', updatedAt: '2026-08-19',
};

const sampleChecklist = {
  id: 'cl1', taskId: 't1', projectId: 'p1', type: 'dor',
  items: [{ id: 'c1', label: 'AC defined', checked: false }],
  createdAt: '2026-08-19', updatedAt: '2026-08-19',
};

const { scrumDefinitionService } = await import('../../services/ScrumDefinitionService');

describe('ScrumDefinitionService', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe('getDefinitions', () => {
    it('returns dor and dod', async () => {
      mockDefRepo.findByProject.mockResolvedValueOnce([sampleDor]);
      const defs = await scrumDefinitionService.getDefinitions('p1');
      expect(defs.dor).toBeTruthy();
      expect(defs.dod).toBeNull();
    });
  });

  describe('upsertDefinition', () => {
    it('calls repository upsert', async () => {
      mockDefRepo.upsert.mockResolvedValueOnce(sampleDor);
      const def = await scrumDefinitionService.upsertDefinition('p1', 'dor', sampleDor.criteria, 'u1');
      expect(def.type).toBe('dor');
      expect(mockDefRepo.upsert).toHaveBeenCalledWith('p1', 'dor', sampleDor.criteria, 'u1');
    });
  });

  describe('initializeChecklist', () => {
    it('creates checklist from template', async () => {
      mockDefRepo.findByProjectAndType.mockResolvedValueOnce(sampleDor);
      mockChecklistRepo.upsert.mockResolvedValueOnce(sampleChecklist);
      const cl = await scrumDefinitionService.initializeChecklist('t1', 'p1', 'dor');
      expect(cl.items).toHaveLength(1);
      expect(cl.items[0].checked).toBe(false);
    });

    it('throws when no template exists', async () => {
      mockDefRepo.findByProjectAndType.mockResolvedValueOnce(null);
      await expect(scrumDefinitionService.initializeChecklist('t1', 'p1', 'dor'))
        .rejects.toThrow('No DOR template');
    });
  });

  describe('updateChecklistItem', () => {
    it('toggles checklist item', async () => {
      mockChecklistRepo.findById.mockResolvedValueOnce(sampleChecklist);
      mockChecklistRepo.updateItems.mockResolvedValueOnce({
        ...sampleChecklist,
        items: [{ id: 'c1', label: 'AC defined', checked: true }],
      });
      const cl = await scrumDefinitionService.updateChecklistItem('cl1', 'c1', true);
      expect(cl.items[0].checked).toBe(true);
    });

    it('throws when checklist not found', async () => {
      mockChecklistRepo.findById.mockResolvedValueOnce(null);
      await expect(scrumDefinitionService.updateChecklistItem('bad', 'c1', true))
        .rejects.toThrow('not found');
    });
  });

  describe('getTaskChecklists', () => {
    it('returns dor and dod', async () => {
      mockChecklistRepo.findByTask.mockResolvedValueOnce([sampleChecklist]);
      const result = await scrumDefinitionService.getTaskChecklists('t1');
      expect(result.dor).toBeTruthy();
      expect(result.dod).toBeNull();
    });
  });

  describe('getReadinessBulk', () => {
    it('delegates to repository', async () => {
      mockChecklistRepo.getReadinessBulk.mockResolvedValueOnce({
        t1: { ready: true, checked: 1, total: 1 },
      });
      const result = await scrumDefinitionService.getReadinessBulk(['t1'], 'dor');
      expect(result.t1.ready).toBe(true);
    });
  });
});
