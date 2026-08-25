import { describe, it, expect, vi, beforeEach } from 'vitest';

const mockQuery = vi.fn();
vi.mock('../../database/connection', () => ({
  databaseService: {
    query: (...args: any[]) => mockQuery(...args),
    queryControlPlane: (...args: any[]) => mockQuery(...args),
  },
}));

vi.mock('uuid', () => ({ v4: () => 'test-uuid-1234' }));

import { ProjectMemberService } from '../../services/ProjectMemberService';

describe('ProjectMemberService', () => {
  let service: ProjectMemberService;

  beforeEach(() => {
    vi.clearAllMocks();
    service = new ProjectMemberService();
  });

  const sampleRow = {
    id: 'm1',
    project_id: 'p1',
    user_id: 'u1',
    user_name: 'Alice',
    email: 'alice@example.com',
    role: 'editor',
    added_at: '2026-01-01T00:00:00.000Z',
  };

  describe('findByProjectId', () => {
    it('returns mapped members for a project', async () => {
      mockQuery.mockResolvedValue([sampleRow]);
      const members = await service.findByProjectId('p1');
      expect(members).toHaveLength(1);
      expect(members[0]).toEqual({
        id: 'm1', projectId: 'p1', userId: 'u1', userName: 'Alice',
        email: 'alice@example.com', role: 'editor', addedAt: '2026-01-01T00:00:00.000Z',
      });
      expect(mockQuery).toHaveBeenCalledWith(
        expect.stringContaining('project_id = ?'),
        ['p1'],
      );
    });

    it('returns empty array when no members', async () => {
      mockQuery.mockResolvedValue([]);
      const members = await service.findByProjectId('p-empty');
      expect(members).toEqual([]);
    });
  });

  describe('findMembership', () => {
    it('returns member when found', async () => {
      mockQuery.mockResolvedValue([sampleRow]);
      const member = await service.findMembership('p1', 'u1');
      expect(member).toBeDefined();
      expect(member!.userId).toBe('u1');
    });

    it('returns undefined when not found', async () => {
      mockQuery.mockResolvedValue([]);
      const member = await service.findMembership('p1', 'u-nonexistent');
      expect(member).toBeUndefined();
    });
  });

  describe('hasAccess', () => {
    it('returns true when member exists', async () => {
      mockQuery.mockResolvedValue([{ 1: 1 }]);
      expect(await service.hasAccess('p1', 'u1')).toBe(true);
    });

    it('returns false when no membership', async () => {
      mockQuery.mockResolvedValue([]);
      expect(await service.hasAccess('p1', 'u-none')).toBe(false);
    });
  });

  describe('hasRole', () => {
    it('returns true when role meets minimum', async () => {
      mockQuery.mockResolvedValue([{ ...sampleRow, role: 'manager' }]);
      expect(await service.hasRole('p1', 'u1', 'editor')).toBe(true);
    });

    it('returns true when role equals minimum', async () => {
      mockQuery.mockResolvedValue([{ ...sampleRow, role: 'editor' }]);
      expect(await service.hasRole('p1', 'u1', 'editor')).toBe(true);
    });

    it('returns false when role is below minimum', async () => {
      mockQuery.mockResolvedValue([{ ...sampleRow, role: 'viewer' }]);
      expect(await service.hasRole('p1', 'u1', 'editor')).toBe(false);
    });

    it('returns false when not a member', async () => {
      mockQuery.mockResolvedValue([]);
      expect(await service.hasRole('p1', 'u-none', 'viewer')).toBe(false);
    });

    it('owner meets all role requirements', async () => {
      mockQuery.mockResolvedValue([{ ...sampleRow, role: 'owner' }]);
      for (const role of ['owner', 'manager', 'editor', 'viewer'] as const) {
        expect(await service.hasRole('p1', 'u1', role)).toBe(true);
      }
    });
  });

  describe('addMember', () => {
    const newMemberData = { userId: 'u2', userName: 'Bob', email: 'bob@example.com', role: 'editor' as const };

    it('inserts new member when not already a member', async () => {
      // findMembership returns empty
      mockQuery.mockResolvedValueOnce([]);
      // INSERT succeeds
      mockQuery.mockResolvedValueOnce({ affectedRows: 1 });

      const member = await service.addMember('p1', newMemberData);
      expect(member.id).toBe('test-uuid-1234');
      expect(member.projectId).toBe('p1');
      expect(member.userId).toBe('u2');
      expect(member.role).toBe('editor');
      expect(mockQuery).toHaveBeenCalledTimes(3); // findMembership + INSERT + auto-link resource
      expect(mockQuery.mock.calls[1][0]).toContain('INSERT INTO project_members');
      expect(mockQuery.mock.calls[2][0]).toContain('UPDATE resources');
    });

    it('updates role when already a member', async () => {
      // findMembership returns existing
      mockQuery.mockResolvedValueOnce([sampleRow]);
      // UPDATE succeeds
      mockQuery.mockResolvedValueOnce({ affectedRows: 1 });

      const member = await service.addMember('p1', { ...newMemberData, userId: 'u1', role: 'manager' });
      expect(member.role).toBe('manager');
      expect(mockQuery.mock.calls[1][0]).toContain('UPDATE project_members SET role');
    });
  });

  describe('updateRole', () => {
    it('updates role and returns updated member', async () => {
      mockQuery.mockResolvedValueOnce([sampleRow]);
      mockQuery.mockResolvedValueOnce({ affectedRows: 1 });

      const member = await service.updateRole('m1', 'manager');
      expect(member).not.toBeNull();
      expect(member!.role).toBe('manager');
    });

    it('returns null when member not found', async () => {
      mockQuery.mockResolvedValue([]);
      const member = await service.updateRole('m-nonexistent', 'manager');
      expect(member).toBeNull();
    });
  });

  describe('removeMember', () => {
    it('returns false when member not found', async () => {
      mockQuery.mockResolvedValue([]);
      expect(await service.removeMember('m-nonexistent')).toBe(false);
    });

    it('prevents removing last owner', async () => {
      const ownerRow = { ...sampleRow, role: 'owner' };
      mockQuery.mockResolvedValueOnce([ownerRow]); // find member
      mockQuery.mockResolvedValueOnce([{ cnt: 1 }]); // count owners = 1

      expect(await service.removeMember('m1')).toBe(false);
    });

    it('allows removing owner when multiple owners exist', async () => {
      const ownerRow = { ...sampleRow, role: 'owner' };
      mockQuery.mockResolvedValueOnce([ownerRow]); // find member
      mockQuery.mockResolvedValueOnce([{ cnt: 2 }]); // count owners = 2
      mockQuery.mockResolvedValueOnce({ affectedRows: 1 }); // delete

      expect(await service.removeMember('m1')).toBe(true);
    });

    it('removes non-owner member without owner check', async () => {
      mockQuery.mockResolvedValueOnce([sampleRow]); // find (role=editor)
      mockQuery.mockResolvedValueOnce({ affectedRows: 1 }); // delete

      expect(await service.removeMember('m1')).toBe(true);
      // Should only have 2 calls (find + delete), no owner count
      expect(mockQuery).toHaveBeenCalledTimes(2);
    });
  });

  describe('findUserByEmail', () => {
    it('returns user when found', async () => {
      mockQuery.mockResolvedValue([{ id: 'u1', full_name: 'Alice Smith', email: 'alice@example.com' }]);
      const user = await service.findUserByEmail('alice@example.com');
      expect(user).toEqual({ id: 'u1', fullName: 'Alice Smith', email: 'alice@example.com' });
    });

    it('returns null when not found', async () => {
      mockQuery.mockResolvedValue([]);
      const user = await service.findUserByEmail('nobody@example.com');
      expect(user).toBeNull();
    });
  });
});
