import { describe, it, expect, vi, beforeEach } from 'vitest';

// ── Mocks ────────────────────────────────────────────────────────────
const mockFindAll = vi.fn();
const mockFindById = vi.fn();
const mockFindByName = vi.fn();
const mockCreate = vi.fn();
const mockUpdate = vi.fn();
const mockDelete = vi.fn();
const mockReorder = vi.fn();
const mockAssignProject = vi.fn();
const mockUnassignProject = vi.fn();

vi.mock('../../database/ProjectGroupRepository', () => ({
  projectGroupRepository: {
    findAll: (...args: any[]) => mockFindAll(...args),
    findById: (...args: any[]) => mockFindById(...args),
    findByName: (...args: any[]) => mockFindByName(...args),
    create: (...args: any[]) => mockCreate(...args),
    update: (...args: any[]) => mockUpdate(...args),
    delete: (...args: any[]) => mockDelete(...args),
    reorder: (...args: any[]) => mockReorder(...args),
    assignProject: (...args: any[]) => mockAssignProject(...args),
    unassignProject: (...args: any[]) => mockUnassignProject(...args),
  },
}));

import { projectGroupService } from '../../services/ProjectGroupService';

// ── Helpers ──────────────────────────────────────────────────────────
function makeGroup(overrides: Partial<{
  id: string;
  name: string;
  color: string;
  icon: string | null;
  sortOrder: number;
  createdBy: string;
  createdAt: string;
  updatedAt: string;
}> = {}) {
  return {
    id: overrides.id ?? 'group-1',
    name: overrides.name ?? 'Test Group',
    color: overrides.color ?? '#6366f1',
    icon: overrides.icon ?? null,
    sortOrder: overrides.sortOrder ?? 0,
    createdBy: overrides.createdBy ?? 'user-1',
    createdAt: overrides.createdAt ?? '2026-01-01T00:00:00.000Z',
    updatedAt: overrides.updatedAt ?? '2026-01-01T00:00:00.000Z',
  };
}

// ── Tests ────────────────────────────────────────────────────────────
describe('ProjectGroupService', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  // ── getGroups ────────────────────────────────────────────────────
  describe('getGroups', () => {
    it('returns all groups from repository', async () => {
      const groups = [makeGroup({ id: 'g1', name: 'Alpha' }), makeGroup({ id: 'g2', name: 'Beta' })];
      mockFindAll.mockResolvedValue(groups);

      const result = await projectGroupService.getGroups();

      expect(mockFindAll).toHaveBeenCalledOnce();
      expect(result).toEqual(groups);
    });

    it('returns empty array when no groups exist', async () => {
      mockFindAll.mockResolvedValue([]);

      const result = await projectGroupService.getGroups();

      expect(result).toEqual([]);
    });
  });

  // ── createGroup ──────────────────────────────────────────────────
  describe('createGroup', () => {
    it('creates a group with name only', async () => {
      const created = makeGroup({ name: 'New Group' });
      mockFindByName.mockResolvedValue(null);
      mockCreate.mockResolvedValue(created);

      const result = await projectGroupService.createGroup({ name: 'New Group' }, 'user-1');

      expect(mockFindByName).toHaveBeenCalledWith('New Group');
      expect(mockCreate).toHaveBeenCalledWith({ name: 'New Group', createdBy: 'user-1' });
      expect(result).toEqual(created);
    });

    it('creates a group with color and icon', async () => {
      const created = makeGroup({ name: 'Styled', color: '#ff0000', icon: 'star' });
      mockFindByName.mockResolvedValue(null);
      mockCreate.mockResolvedValue(created);

      const result = await projectGroupService.createGroup(
        { name: 'Styled', color: '#ff0000', icon: 'star' },
        'user-1',
      );

      expect(mockCreate).toHaveBeenCalledWith({
        name: 'Styled',
        color: '#ff0000',
        icon: 'star',
        createdBy: 'user-1',
      });
      expect(result).toEqual(created);
    });

    it('throws when a group with the same name already exists', async () => {
      mockFindByName.mockResolvedValue(makeGroup({ name: 'Duplicate' }));

      await expect(
        projectGroupService.createGroup({ name: 'Duplicate' }, 'user-1'),
      ).rejects.toThrow('A group with this name already exists');

      expect(mockCreate).not.toHaveBeenCalled();
    });
  });

  // ── updateGroup ──────────────────────────────────────────────────
  describe('updateGroup', () => {
    it('updates a group when it exists', async () => {
      const existing = makeGroup({ id: 'g1', name: 'Old Name' });
      const updated = makeGroup({ id: 'g1', name: 'New Name' });
      mockFindById.mockResolvedValue(existing);
      mockFindByName.mockResolvedValue(null);
      mockUpdate.mockResolvedValue(updated);

      const result = await projectGroupService.updateGroup('g1', { name: 'New Name' });

      expect(mockFindById).toHaveBeenCalledWith('g1');
      expect(mockFindByName).toHaveBeenCalledWith('New Name');
      expect(mockUpdate).toHaveBeenCalledWith('g1', { name: 'New Name' });
      expect(result).toEqual(updated);
    });

    it('throws when group does not exist', async () => {
      mockFindById.mockResolvedValue(null);

      await expect(
        projectGroupService.updateGroup('nonexistent', { name: 'X' }),
      ).rejects.toThrow('Group not found');

      expect(mockUpdate).not.toHaveBeenCalled();
    });

    it('throws when renaming to an existing name', async () => {
      const existing = makeGroup({ id: 'g1', name: 'Old' });
      const duplicate = makeGroup({ id: 'g2', name: 'Taken' });
      mockFindById.mockResolvedValue(existing);
      mockFindByName.mockResolvedValue(duplicate);

      await expect(
        projectGroupService.updateGroup('g1', { name: 'Taken' }),
      ).rejects.toThrow('A group with this name already exists');

      expect(mockUpdate).not.toHaveBeenCalled();
    });

    it('skips duplicate check when name is unchanged', async () => {
      const existing = makeGroup({ id: 'g1', name: 'Same Name' });
      const updated = makeGroup({ id: 'g1', name: 'Same Name', color: '#ff0000' });
      mockFindById.mockResolvedValue(existing);
      mockUpdate.mockResolvedValue(updated);

      const result = await projectGroupService.updateGroup('g1', { name: 'Same Name', color: '#ff0000' });

      expect(mockFindByName).not.toHaveBeenCalled();
      expect(mockUpdate).toHaveBeenCalledWith('g1', { name: 'Same Name', color: '#ff0000' });
      expect(result).toEqual(updated);
    });

    it('skips duplicate check when name is not provided', async () => {
      const existing = makeGroup({ id: 'g1' });
      const updated = makeGroup({ id: 'g1', color: '#00ff00' });
      mockFindById.mockResolvedValue(existing);
      mockUpdate.mockResolvedValue(updated);

      const result = await projectGroupService.updateGroup('g1', { color: '#00ff00' });

      expect(mockFindByName).not.toHaveBeenCalled();
      expect(mockUpdate).toHaveBeenCalledWith('g1', { color: '#00ff00' });
      expect(result).toEqual(updated);
    });
  });

  // ── deleteGroup ──────────────────────────────────────────────────
  describe('deleteGroup', () => {
    it('deletes a group when it exists', async () => {
      mockFindById.mockResolvedValue(makeGroup({ id: 'g1' }));
      mockDelete.mockResolvedValue(undefined);

      await projectGroupService.deleteGroup('g1');

      expect(mockFindById).toHaveBeenCalledWith('g1');
      expect(mockDelete).toHaveBeenCalledWith('g1');
    });

    it('throws when group does not exist', async () => {
      mockFindById.mockResolvedValue(null);

      await expect(
        projectGroupService.deleteGroup('nonexistent'),
      ).rejects.toThrow('Group not found');

      expect(mockDelete).not.toHaveBeenCalled();
    });
  });

  // ── reorderGroups ────────────────────────────────────────────────
  describe('reorderGroups', () => {
    it('delegates to repository with ordered IDs', async () => {
      mockReorder.mockResolvedValue(undefined);

      await projectGroupService.reorderGroups(['g3', 'g1', 'g2']);

      expect(mockReorder).toHaveBeenCalledWith(['g3', 'g1', 'g2']);
    });

    it('handles empty array', async () => {
      mockReorder.mockResolvedValue(undefined);

      await projectGroupService.reorderGroups([]);

      expect(mockReorder).toHaveBeenCalledWith([]);
    });
  });

  // ── assignProject ────────────────────────────────────────────────
  describe('assignProject', () => {
    it('assigns a project to an existing group', async () => {
      mockFindById.mockResolvedValue(makeGroup({ id: 'g1' }));
      mockAssignProject.mockResolvedValue(undefined);

      await projectGroupService.assignProject('proj-1', 'g1');

      expect(mockFindById).toHaveBeenCalledWith('g1');
      expect(mockAssignProject).toHaveBeenCalledWith('proj-1', 'g1');
    });

    it('throws when group does not exist', async () => {
      mockFindById.mockResolvedValue(null);

      await expect(
        projectGroupService.assignProject('proj-1', 'nonexistent'),
      ).rejects.toThrow('Group not found');

      expect(mockAssignProject).not.toHaveBeenCalled();
    });
  });

  // ── unassignProject ──────────────────────────────────────────────
  describe('unassignProject', () => {
    it('delegates to repository', async () => {
      mockUnassignProject.mockResolvedValue(undefined);

      await projectGroupService.unassignProject('proj-1');

      expect(mockUnassignProject).toHaveBeenCalledWith('proj-1');
    });
  });
});
