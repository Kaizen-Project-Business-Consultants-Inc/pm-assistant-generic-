import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('../../database/connection', () => ({
  databaseService: { query: vi.fn(), getTenantConnection: vi.fn() },
}));

vi.mock('../../database/ResourceAvailabilityRepository', () => {
  const mockRepo = {
    findByResource: vi.fn().mockResolvedValue([]),
    findById: vi.fn().mockResolvedValue(null),
    insert: vi.fn(),
    update: vi.fn(),
    deleteById: vi.fn().mockResolvedValue(false),
    findOverlappingBatch: vi.fn().mockResolvedValue([]),
  };
  return { resourceAvailabilityRepository: mockRepo };
});

import { ResourceAvailabilityService } from '../../services/ResourceAvailabilityService';
import { resourceAvailabilityRepository } from '../../database/ResourceAvailabilityRepository';

const mockRepo = resourceAvailabilityRepository as any;

const sampleBlock = {
  id: 'ra1', resourceId: 'r1', dateFrom: '2026-01-06', dateTo: '2026-01-10',
  type: 'vacation' as const, hoursAvailable: null, note: 'Holiday trip',
  createdAt: '2026-01-01',
};

describe('ResourceAvailabilityService', () => {
  let service: ResourceAvailabilityService;

  beforeEach(() => {
    service = new ResourceAvailabilityService();
    vi.clearAllMocks();
  });

  describe('findByResource', () => {
    it('delegates to repository', async () => {
      mockRepo.findByResource.mockResolvedValueOnce([sampleBlock]);
      const blocks = await service.findByResource('r1');
      expect(blocks).toHaveLength(1);
    });
  });

  describe('create', () => {
    it('creates availability block', async () => {
      mockRepo.insert.mockResolvedValueOnce(sampleBlock);
      const block = await service.create({
        resourceId: 'r1', dateFrom: '2026-01-06', dateTo: '2026-01-10',
        type: 'vacation', note: 'Holiday trip',
      });
      expect(block.type).toBe('vacation');
    });
  });

  describe('update', () => {
    it('returns null when not found', async () => {
      const result = await service.update('nonexistent', { note: 'test' });
      expect(result).toBeNull();
    });

    it('updates when found', async () => {
      mockRepo.findById.mockResolvedValueOnce(sampleBlock);
      mockRepo.update.mockResolvedValueOnce({ ...sampleBlock, note: 'Updated' });
      const result = await service.update('ra1', { note: 'Updated' });
      expect(result).not.toBeNull();
    });
  });

  describe('delete', () => {
    it('delegates to repository', async () => {
      mockRepo.deleteById.mockResolvedValueOnce(true);
      const result = await service.delete('ra1');
      expect(result).toBe(true);
    });
  });

  describe("a week's capacity (getEffectiveCapacityBatch)", () => {
    const week = new Date('2026-01-05'); // a Monday
    const one = async (blocks: any[]) => {
      mockRepo.findOverlappingBatch.mockResolvedValueOnce(blocks.map(b => ({ resourceId: 'r1', ...b })));
      return (await service.getEffectiveCapacityBatch([{ id: 'r1', capacityHoursPerWeek: 40 }], [week])).get('r1')!.get('2026-01-05');
    };

    it('returns full capacity when no blocks', async () => {
      expect(await one([])).toBe(40);
    });

    it('reduces capacity for vacation days', async () => {
      // 2 days unavailable: 40 - (2 * 8) = 24
      expect(await one([{ dateFrom: '2026-01-06', dateTo: '2026-01-07', type: 'vacation', hoursAvailable: null }])).toBe(24);
    });

    it('handles reduced hours blocks', async () => {
      // 1 reduced day: 40 - (1 * 8) + (4 * 1) = 36
      expect(await one([{ dateFrom: '2026-01-06', dateTo: '2026-01-06', type: 'reduced', hoursAvailable: 4 }])).toBe(36);
    });

    it("one day off mid-week counts (2026-10-09: the profile's history used to ignore any time off not covering the whole week)", async () => {
      expect(await one([{ dateFrom: '2026-01-07', dateTo: '2026-01-07', type: 'vacation', hoursAvailable: null }])).toBe(32);
    });
  });
});
