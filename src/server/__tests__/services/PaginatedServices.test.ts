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

import { ProjectService } from '../../services/ProjectService';
import { SprintService } from '../../services/SprintService';
import { databaseService } from '../../database/connection';

const mockQuery = databaseService.query as ReturnType<typeof vi.fn>;

const sampleProjectRow = {
  id: 'p1', name: 'Test Project', description: 'Desc', category: 'dev',
  project_type: 'it', status: 'active', priority: 'high',
  budget_allocated: 50000, budget_spent: 10000, currency: 'USD',
  location: null, location_lat: null, location_lon: null,
  start_date: '2026-01-01', end_date: '2026-12-31',
  project_manager_id: null, created_by: 'u1',
  created_at: '2026-01-01', updated_at: '2026-01-01',
};

const sampleSprintRow = {
  id: 's1', project_id: 'p1', schedule_id: 'sch1',
  name: 'Sprint 1', goal: 'Complete features',
  start_date: '2026-01-01', end_date: '2026-01-14',
  status: 'active', velocity_commitment: 20,
  created_by: 'u1', created_at: '2026-01-01', updated_at: '2026-01-01',
};

describe('Paginated Service Methods', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe('ProjectService.findByUserIdPaginated', () => {
    it('returns paginated results with total count', async () => {
      const service = new ProjectService();
      mockQuery
        .mockResolvedValueOnce([{ count: 15 }])  // COUNT query
        .mockResolvedValueOnce([sampleProjectRow, { ...sampleProjectRow, id: 'p2', name: 'Project 2' }]); // SELECT query

      const result = await service.findByUserIdPaginated('u1', 2, 0);

      expect(result.total).toBe(15);
      expect(result.rows).toHaveLength(2);
      expect(result.rows[0].id).toBe('p1');
      expect(result.rows[1].id).toBe('p2');
    });

    it('passes correct LIMIT and OFFSET to SQL', async () => {
      const service = new ProjectService();
      mockQuery
        .mockResolvedValueOnce([{ count: 100 }])
        .mockResolvedValueOnce([]);

      await service.findByUserIdPaginated('u1', 10, 20);

      // Second call is the SELECT with LIMIT/OFFSET
      expect(mockQuery).toHaveBeenCalledWith(
        expect.stringContaining('LIMIT ? OFFSET ?'),
        expect.arrayContaining(['u1', 10, 20]),
      );
    });

    it('returns empty rows with correct total when offset beyond data', async () => {
      const service = new ProjectService();
      mockQuery
        .mockResolvedValueOnce([{ count: 5 }])
        .mockResolvedValueOnce([]);

      const result = await service.findByUserIdPaginated('u1', 10, 100);

      expect(result.total).toBe(5);
      expect(result.rows).toHaveLength(0);
    });

    it('runs COUNT and SELECT queries', async () => {
      const service = new ProjectService();
      mockQuery
        .mockResolvedValueOnce([{ count: 0 }])
        .mockResolvedValueOnce([]);

      await service.findByUserIdPaginated('u1', 50, 0);

      // Both queries should have been called
      expect(mockQuery).toHaveBeenCalledTimes(2);
      // the readable projects as three indexed lookups joined first (2026-10-08), not one OR query
      expect(mockQuery).toHaveBeenCalledWith(
        expect.stringMatching(/STRAIGHT_JOIN COUNT\(\*\)[\s\S]*created_by = \?[\s\S]*UNION SELECT project_id FROM project_members WHERE user_id = \?[\s\S]*is_demo = 1/),
        expect.arrayContaining(['u1']),
      );
    });
  });

  describe('SprintService.getByProjectPaginated', () => {
    it('returns paginated sprints with total', async () => {
      const service = new SprintService();
      mockQuery
        .mockResolvedValueOnce([{ cnt: 8 }])
        .mockResolvedValueOnce([sampleSprintRow]);

      const result = await service.getByProjectPaginated('p1', 5, 0);

      expect(result.total).toBe(8);
      expect(result.rows).toHaveLength(1);
      expect(result.rows[0].id).toBe('s1');
      expect(result.rows[0].name).toBe('Sprint 1');
      expect(result.rows[0].projectId).toBe('p1');
    });

    it('passes correct params to SQL', async () => {
      const service = new SprintService();
      mockQuery
        .mockResolvedValueOnce([{ cnt: 0 }])
        .mockResolvedValueOnce([]);

      await service.getByProjectPaginated('p1', 10, 5);

      expect(mockQuery).toHaveBeenCalledWith(
        expect.stringContaining('LIMIT ? OFFSET ?'),
        ['p1', 10, 5],
      );
      expect(mockQuery).toHaveBeenCalledWith(
        expect.stringContaining('COUNT(*)'),
        ['p1'],
      );
    });

    it('returns empty when no sprints exist', async () => {
      const service = new SprintService();
      mockQuery
        .mockResolvedValueOnce([{ cnt: 0 }])
        .mockResolvedValueOnce([]);

      const result = await service.getByProjectPaginated('p1', 50, 0);

      expect(result.total).toBe(0);
      expect(result.rows).toEqual([]);
    });
  });
});

describe('paginate helper', () => {
  it('computes totalPages correctly', async () => {
    const { paginate } = await import('../../dto/responses');

    const result = paginate(['a', 'b'], 15, 1, 5);
    expect(result.total).toBe(15);
    expect(result.page).toBe(1);
    expect(result.pageSize).toBe(5);
    expect(result.totalPages).toBe(3);
    expect(result.data).toEqual(['a', 'b']);
  });

  it('handles single page', async () => {
    const { paginate } = await import('../../dto/responses');

    const result = paginate(['x'], 1, 1, 50);
    expect(result.totalPages).toBe(1);
  });

  it('handles empty data', async () => {
    const { paginate } = await import('../../dto/responses');

    const result = paginate([], 0, 1, 50);
    expect(result.totalPages).toBe(0);
    expect(result.data).toEqual([]);
  });

  it('rounds totalPages up', async () => {
    const { paginate } = await import('../../dto/responses');

    const result = paginate([], 11, 1, 5);
    expect(result.totalPages).toBe(3); // ceil(11/5) = 3
  });
});
