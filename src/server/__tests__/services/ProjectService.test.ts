import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('../../database/connection', () => ({
  databaseService: { query: vi.fn().mockResolvedValue([]) },
}));

vi.mock('../../services/AuditLedgerService', () => ({
  auditLedgerService: { append: vi.fn().mockResolvedValue(undefined) },
}));

vi.mock('../../services/PolicyEngineService', () => ({
  policyEngineService: {
    evaluate: vi.fn().mockResolvedValue({ allowed: true, enforcement: 'allowed', matchedPolicies: [] }),
  },
}));

vi.mock('../../services/DagWorkflowService', () => ({
  dagWorkflowService: {
    evaluateProjectChange: vi.fn().mockResolvedValue(undefined),
  },
}));

vi.mock('uuid', () => ({ v4: () => 'test-project-id' }));

import { ProjectService } from '../../services/ProjectService';
import { databaseService } from '../../database/connection';
import { policyEngineService } from '../../services/PolicyEngineService';

const mockQuery = databaseService.query as ReturnType<typeof vi.fn>;

const sampleRow = {
  id: 'p1', name: 'Test Project', description: 'Desc', category: 'dev',
  project_type: 'it', status: 'active', priority: 'high',
  budget_allocated: 50000, budget_spent: 10000, currency: 'USD',
  location: null, location_lat: null, location_lon: null,
  start_date: '2026-01-01', end_date: '2026-12-31',
  project_manager_id: null, created_by: 'u1',
  created_at: '2026-01-01', updated_at: '2026-01-01',
};

describe('ProjectService', () => {
  let service: ProjectService;

  beforeEach(() => {
    service = new ProjectService();
    vi.clearAllMocks();
  });

  describe('findById', () => {
    it('returns project when found', async () => {
      mockQuery.mockResolvedValueOnce([sampleRow]);
      const project = await service.findById('p1');
      expect(project).not.toBeNull();
      expect(project!.id).toBe('p1');
      expect(project!.name).toBe('Test Project');
      expect(project!.budgetAllocated).toBe(50000);
      expect(project!.budgetSpent).toBe(10000);
    });

    it('returns null when not found', async () => {
      mockQuery.mockResolvedValueOnce([]);
      const project = await service.findById('nonexistent');
      expect(project).toBeNull();
    });

    it('filters by userId when provided (checks created_by or project_members)', async () => {
      mockQuery.mockResolvedValueOnce([sampleRow]);
      await service.findById('p1', 'u1');
      expect(mockQuery).toHaveBeenCalledWith(
        expect.stringContaining('project_members'),
        ['u1', 'p1', 'u1'],
      );
    });
  });

  describe('findByUserId', () => {
    it('returns projects for user', async () => {
      mockQuery.mockResolvedValueOnce([sampleRow, { ...sampleRow, id: 'p2', name: 'Project 2' }]);
      const projects = await service.findByUserId('u1');
      expect(projects).toHaveLength(2);
    });

    it('returns empty array when none found', async () => {
      mockQuery.mockResolvedValueOnce([]);
      const projects = await service.findByUserId('u1');
      expect(projects).toEqual([]);
    });
  });

  describe('findAll', () => {
    it('returns all projects', async () => {
      mockQuery.mockResolvedValueOnce([sampleRow]);
      const projects = await service.findAll();
      expect(projects).toHaveLength(1);
      expect(mockQuery).toHaveBeenCalledWith(
        expect.stringContaining('LIMIT ?'),
        [1000],
      );
    });
  });

  describe('create', () => {
    it('creates project after policy check', async () => {
      mockQuery
        .mockResolvedValueOnce([]) // generateProjectCode
        .mockResolvedValueOnce([]) // INSERT
        .mockResolvedValueOnce([sampleRow]); // findById

      const project = await service.create({
        name: 'New Project',
        userId: 'u1',
        budgetAllocated: 50000,
      });

      expect(project.id).toBe('p1');
      expect(policyEngineService.evaluate).toHaveBeenCalledWith(
        'project.create',
        expect.objectContaining({ actorId: 'u1' }),
      );
    });

    it('throws when blocked by policy', async () => {
      (policyEngineService.evaluate as ReturnType<typeof vi.fn>).mockResolvedValueOnce({
        allowed: false,
        enforcement: 'blocked',
        matchedPolicies: [{ policyId: 'pol1', policyName: 'Budget Limit', enforcement: 'block' }],
      });

      await expect(service.create({
        name: 'Blocked Project',
        userId: 'u1',
      })).rejects.toThrow('Blocked by policy');
    });
  });

  describe('update', () => {
    it('updates project fields', async () => {
      mockQuery
        .mockResolvedValueOnce([sampleRow]) // findById (existing)
        .mockResolvedValueOnce([]) // UPDATE
        .mockResolvedValueOnce([{ ...sampleRow, name: 'Updated' }]); // findById (updated)

      const updated = await service.update('p1', { name: 'Updated' });
      expect(updated).not.toBeNull();
      expect(updated!.name).toBe('Updated');
    });

    it('returns null when project not found', async () => {
      mockQuery.mockResolvedValueOnce([]);
      const updated = await service.update('nonexistent', { name: 'X' });
      expect(updated).toBeNull();
    });

    it('returns existing when no fields to update', async () => {
      mockQuery.mockResolvedValueOnce([sampleRow]);
      const updated = await service.update('p1', {});
      expect(updated!.name).toBe('Test Project');
    });
  });

  describe('delete', () => {
    it('returns true when deleted', async () => {
      mockQuery
        .mockResolvedValueOnce([sampleRow]) // findById
        .mockResolvedValueOnce({ affectedRows: 1 }); // DELETE

      const deleted = await service.delete('p1');
      expect(deleted).toBe(true);
    });

    it('returns false when not found', async () => {
      mockQuery
        .mockResolvedValueOnce([]) // findById
        .mockResolvedValueOnce({ affectedRows: 0 }); // DELETE

      const deleted = await service.delete('nonexistent');
      expect(deleted).toBe(false);
    });
  });
});
