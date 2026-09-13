import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('../../database/connection', () => ({
  databaseService: { query: vi.fn().mockResolvedValue([]) },
}));

vi.mock('uuid', () => ({ v4: () => 'test-project-id' }));

import { ProjectRepository } from '../../database/ProjectRepository';
import { databaseService } from '../../database/connection';

const mockQuery = databaseService.query as ReturnType<typeof vi.fn>;

const sampleRow = {
  id: 'p1', name: 'Test Project', description: null,
  category: 'IT', project_type: 'it', status: 'planning',
  priority: 'medium', budget_allocated: 10000, budget_spent: 0,
  currency: 'USD', location: null, location_lat: null, location_lon: null,
  start_date: '2026-01-01', end_date: '2026-12-31',
  project_manager_id: null, created_by: 'u1',
  created_at: '2026-01-01', updated_at: '2026-01-01',
};

describe('ProjectRepository', () => {
  let repo: ProjectRepository;

  beforeEach(() => {
    vi.clearAllMocks();
    repo = new ProjectRepository();
  });

  it('findById returns mapped project', async () => {
    mockQuery.mockResolvedValueOnce([sampleRow]);
    const project = await repo.findById('p1');
    expect(project).not.toBeNull();
    expect(project!.projectType).toBe('it');
    expect(project!.budgetAllocated).toBe(10000);
  });

  it('findByIdForUser joins project_members and filters by created_by or membership', async () => {
    mockQuery.mockResolvedValueOnce([sampleRow]);
    await repo.findByIdForUser('p1', 'u1');
    expect(mockQuery).toHaveBeenCalledWith(
      expect.stringContaining('project_members'),
      ['u1', 'p1', 'u1'],
    );
  });

  it('findByUserId queries by created_by', async () => {
    mockQuery.mockResolvedValueOnce([sampleRow]);
    const projects = await repo.findByUserId('u1');
    expect(projects).toHaveLength(1);
  });

  it('findByUserIdPaginated returns rows and total with membership join', async () => {
    mockQuery
      .mockResolvedValueOnce([{ count: 1 }])
      .mockResolvedValueOnce([sampleRow]);
    const result = await repo.findByUserIdPaginated('u1', 10, 0);
    expect(result.total).toBe(1);
    expect(result.rows).toHaveLength(1);
    expect(mockQuery).toHaveBeenCalledWith(
      expect.stringContaining('project_members'),
      expect.arrayContaining(['u1']),
    );
  });

  it('create inserts and returns project', async () => {
    mockQuery
      .mockResolvedValueOnce([]) // generateProjectCode (no existing codes)
      .mockResolvedValueOnce([]) // INSERT
      .mockResolvedValueOnce([sampleRow]); // findById
    const project = await repo.create({
      name: 'Test', userId: 'u1',
    });
    expect(project.name).toBe('Test Project');
    expect(mockQuery).toHaveBeenCalledWith(
      expect.stringContaining('INSERT INTO projects'),
      expect.arrayContaining(['test-project-id', 'Test']),
    );
  });

  it('update builds and executes update', async () => {
    mockQuery
      .mockResolvedValueOnce([]) // UPDATE
      .mockResolvedValueOnce([{ ...sampleRow, name: 'Updated' }]); // findById
    const result = await repo.update('p1', { name: 'Updated' });
    expect(result).not.toBeNull();
    expect(mockQuery).toHaveBeenCalledWith(
      expect.stringContaining('UPDATE projects SET name = ?'),
      expect.arrayContaining(['Updated', 'p1']),
    );
  });

  it('update returns null when no fields match', async () => {
    const result = await repo.update('p1', { nonexistent: 'val' } as any);
    expect(result).toBeNull();
  });

  it('deleteForUser adds created_by constraint', async () => {
    mockQuery.mockResolvedValueOnce({ affectedRows: 1 });
    const deleted = await repo.deleteForUser('p1', 'u1');
    expect(deleted).toBe(true);
    expect(mockQuery).toHaveBeenCalledWith(
      expect.stringContaining('AND created_by = ?'),
      ['p1', 'u1'],
    );
  });
});
