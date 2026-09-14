import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('../../../database/connection', () => ({
  databaseService: {
    query: vi.fn().mockResolvedValue([]),
    queryControlPlane: vi.fn().mockResolvedValue([]),
  },
}));

vi.mock('uuid', () => ({ v4: () => 'test-versioned-id' }));

import { VersionedMemoryService } from '../../../services/context/VersionedMemoryService';
import { databaseService } from '../../../database/connection';

const mockQuery = databaseService.queryControlPlane as ReturnType<typeof vi.fn>;

const sampleRow = {
  id: 'mem-1',
  agent_id: 'mjuzi-chat',
  memory_type: 'role',
  entity_id: null,
  key_name: 'pref:language',
  value: JSON.stringify({ value: 'French' }),
  version: 1,
  version_hash: 'hash-v1',
  created_by: 'user-1',
  source: 'user',
  permission_scope: 'user',
  is_approved: 1,
  expires_at: null,
  created_at: '2026-09-13 10:00:00',
  updated_at: '2026-09-13 10:00:00',
};

describe('VersionedMemoryService', () => {
  let service: VersionedMemoryService;

  beforeEach(() => {
    service = new VersionedMemoryService();
    vi.clearAllMocks();
  });

  describe('getById', () => {
    it('returns null when not found', async () => {
      mockQuery.mockResolvedValueOnce([]);
      expect(await service.getById('missing')).toBeNull();
    });

    it('returns versioned memory', async () => {
      mockQuery.mockResolvedValueOnce([sampleRow]);
      const result = await service.getById('mem-1');
      expect(result).not.toBeNull();
      expect(result!.version).toBe(1);
      expect(result!.versionHash).toBe('hash-v1');
      expect(result!.permissionScope).toBe('user');
    });
  });

  describe('listMemories', () => {
    it('lists memories with filters', async () => {
      mockQuery.mockResolvedValueOnce([sampleRow, { ...sampleRow, id: 'mem-2' }]);
      const result = await service.listMemories({ agentId: 'mjuzi-chat', memoryType: 'role' });
      expect(result).toHaveLength(2);
      expect(mockQuery.mock.calls[0][0]).toContain('agent_id = ?');
      expect(mockQuery.mock.calls[0][0]).toContain('memory_type = ?');
    });

    it('applies permission scope filter', async () => {
      mockQuery.mockResolvedValueOnce([sampleRow]);
      await service.listMemories({ permissionScope: 'user' });
      expect(mockQuery.mock.calls[0][0]).toContain('permission_scope = ?');
    });
  });

  describe('updateMemory', () => {
    it('returns conflict on hash mismatch', async () => {
      mockQuery.mockResolvedValueOnce([sampleRow]); // getById
      const result = await service.updateMemory('mem-1', { value: 'new' }, 'wrong-hash', 'user-1');
      expect(result.conflict).toBe(true);
    });

    it('updates successfully with matching hash', async () => {
      mockQuery.mockResolvedValueOnce([sampleRow]); // getById
      mockQuery.mockResolvedValueOnce([]); // logChange INSERT
      mockQuery.mockResolvedValueOnce([]); // UPDATE
      mockQuery.mockResolvedValueOnce([{ ...sampleRow, version: 2, value: JSON.stringify('updated') }]); // getById after

      const result = await service.updateMemory('mem-1', { value: 'updated' }, 'hash-v1', 'user-1');
      expect(result.conflict).toBeFalsy();
      if (!result.conflict) {
        expect(result.memory.version).toBe(2);
      }
    });

    it('throws when memory not found', async () => {
      mockQuery.mockResolvedValueOnce([]);
      await expect(service.updateMemory('missing', {}, 'hash', 'user-1')).rejects.toThrow('Memory not found');
    });
  });

  describe('createMemory', () => {
    it('creates with version 1 and hash', async () => {
      mockQuery.mockResolvedValueOnce([]); // INSERT
      mockQuery.mockResolvedValueOnce([]); // logChange
      mockQuery.mockResolvedValueOnce([{ ...sampleRow, version: 1 }]); // getById

      const result = await service.createMemory('mjuzi-chat', 'role', null, 'pref:test', { value: 'test' }, 'user-1');
      expect(result.version).toBe(1);
      expect(result.versionHash).toBe('hash-v1');
    });

    it('sets source and permission scope', async () => {
      mockQuery.mockResolvedValueOnce([]); // INSERT
      mockQuery.mockResolvedValueOnce([]); // logChange
      mockQuery.mockResolvedValueOnce([{ ...sampleRow, source: 'dreaming', permission_scope: 'org' }]); // getById

      const result = await service.createMemory('mjuzi-chat', 'role', null, 'test', {}, 'user-1', { source: 'dreaming', permissionScope: 'org' });
      expect(result.source).toBe('dreaming');
      expect(result.permissionScope).toBe('org');
    });
  });

  describe('deleteMemory', () => {
    it('returns false when not found', async () => {
      mockQuery.mockResolvedValueOnce([]); // getById
      expect(await service.deleteMemory('missing', 'user-1')).toBe(false);
    });

    it('deletes and logs the change', async () => {
      mockQuery.mockResolvedValueOnce([sampleRow]); // getById
      mockQuery.mockResolvedValueOnce([]); // logChange
      mockQuery.mockResolvedValueOnce({ affectedRows: 1 }); // DELETE

      expect(await service.deleteMemory('mem-1', 'user-1')).toBe(true);
      // Verify logChange was called
      expect(mockQuery.mock.calls[1][0]).toContain('memory_change_log');
    });
  });

  describe('rollbackMemory', () => {
    it('throws when no previous version', async () => {
      mockQuery.mockResolvedValueOnce([{ old_value: null, action: 'create' }]); // only 1 log entry
      await expect(service.rollbackMemory('mem-1', 'user-1')).rejects.toThrow('No previous version');
    });

    it('restores previous value', async () => {
      const previousValue = JSON.stringify({ old: true });
      mockQuery.mockResolvedValueOnce([
        { old_value: JSON.stringify({ current: true }), action: 'update' },
        { old_value: previousValue, action: 'create' },
      ]); // changelog
      mockQuery.mockResolvedValueOnce([sampleRow]); // getById
      mockQuery.mockResolvedValueOnce([]); // logChange
      mockQuery.mockResolvedValueOnce([]); // UPDATE
      mockQuery.mockResolvedValueOnce([{ ...sampleRow, version: 2 }]); // getById after

      const result = await service.rollbackMemory('mem-1', 'user-1');
      expect(result).not.toBeNull();
    });
  });

  describe('getChangeLog', () => {
    it('returns formatted history', async () => {
      mockQuery.mockResolvedValueOnce([
        { id: 'log-1', action: 'update', old_value: JSON.stringify('old'), new_value: JSON.stringify('new'), changed_by: 'user-1', created_at: '2026-09-13' },
      ]);

      const log = await service.getChangeLog('mem-1');
      expect(log).toHaveLength(1);
      expect(log[0].action).toBe('update');
      expect(log[0].oldValue).toBe('old');
    });
  });
});
