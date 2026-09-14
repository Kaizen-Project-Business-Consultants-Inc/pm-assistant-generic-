import { describe, it, expect, vi, beforeEach } from 'vitest';

// ── Mocks ────────────────────────────────────────────────────────────

const mockInsert = vi.fn();
const mockFindById = vi.fn();
const mockFindByEntity = vi.fn();
const mockFindVersions = vi.fn();
const mockFindVersionHistory = vi.fn();
const mockGetMaxVersion = vi.fn();
const mockDeleteWithVersions = vi.fn();

vi.mock('../../database/FileAttachmentRepository', () => ({
  fileAttachmentRepository: {
    insert: (...args: any[]) => mockInsert(...args),
    findById: (...args: any[]) => mockFindById(...args),
    findByEntity: (...args: any[]) => mockFindByEntity(...args),
    findVersions: (...args: any[]) => mockFindVersions(...args),
    findVersionHistory: (...args: any[]) => mockFindVersionHistory(...args),
    getMaxVersion: (...args: any[]) => mockGetMaxVersion(...args),
    deleteWithVersions: (...args: any[]) => mockDeleteWithVersions(...args),
  },
}));

vi.mock('../../config', () => ({
  config: { UPLOAD_DIR: '/test/uploads' },
}));

const mockExistsSync = vi.fn();
const mockMkdirSync = vi.fn();
const mockUnlinkSync = vi.fn();
vi.mock('fs', () => ({
  default: {
    existsSync: (...args: any[]) => mockExistsSync(...args),
    mkdirSync: (...args: any[]) => mockMkdirSync(...args),
    unlinkSync: (...args: any[]) => mockUnlinkSync(...args),
  },
}));

const mockWriteFile = vi.fn();
vi.mock('fs/promises', () => ({
  default: {
    writeFile: (...args: any[]) => mockWriteFile(...args),
  },
}));

vi.mock('uuid', () => ({
  v4: vi.fn(() => 'mock-uuid-1234-5678-9abc-def012345678'),
}));

import { FileAttachmentService } from '../../services/FileAttachmentService';

// ── Helpers ──────────────────────────────────────────────────────────

const VALID_UUID = 'aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee';

function makeRow(overrides: Partial<{
  id: string;
  entity_type: string;
  entity_id: string;
  uploaded_by: string;
  file_name: string;
  original_name: string;
  mime_type: string;
  file_size: number;
  file_path: string;
  version: number;
  parent_id: string | null;
  created_at: string;
}> = {}) {
  return {
    id: overrides.id ?? 'row-id-1',
    entity_type: overrides.entity_type ?? 'task',
    entity_id: overrides.entity_id ?? VALID_UUID,
    uploaded_by: overrides.uploaded_by ?? 'user-1',
    file_name: overrides.file_name ?? 'stored.txt',
    original_name: overrides.original_name ?? 'original.txt',
    mime_type: overrides.mime_type ?? 'text/plain',
    file_size: overrides.file_size ?? 100,
    file_path: overrides.file_path ?? '/test/uploads/task/' + VALID_UUID + '/stored.txt',
    version: overrides.version ?? 1,
    parent_id: overrides.parent_id !== undefined ? overrides.parent_id : null,
    created_at: overrides.created_at ?? '2026-01-01T00:00:00.000Z',
  };
}

// ── Tests ────────────────────────────────────────────────────────────

describe('FileAttachmentService', () => {
  let service: FileAttachmentService;

  beforeEach(() => {
    vi.clearAllMocks();
    service = new FileAttachmentService();
    mockExistsSync.mockReturnValue(false);
    mockWriteFile.mockResolvedValue(undefined);
  });

  // ── upload ──────────────────────────────────────────────────────────

  describe('upload', () => {
    it('uploads a file and returns the DTO', async () => {
      const buffer = Buffer.from('hello');
      const row = makeRow({
        id: 'mock-uuid-1234-5678-9abc-def012345678',
        file_name: 'mock-uuid-1234-5678-9abc-def012345678.txt',
        original_name: 'hello.txt',
        mime_type: 'text/plain',
        file_size: 5,
      });
      mockInsert.mockResolvedValue(undefined);
      mockFindById.mockResolvedValue(row);

      const result = await service.upload('task', VALID_UUID, 'user-1', 'hello.txt', 'text/plain', buffer);

      expect(result.id).toBe('mock-uuid-1234-5678-9abc-def012345678');
      expect(result.entityType).toBe('task');
      expect(result.entityId).toBe(VALID_UUID);
      expect(result.originalName).toBe('hello.txt');
      expect(result.mimeType).toBe('text/plain');
      expect(result.version).toBe(1);
      expect(result.parentId).toBeNull();
    });

    it('creates the upload directory if it does not exist', async () => {
      const buffer = Buffer.from('data');
      mockInsert.mockResolvedValue(undefined);
      mockFindById.mockResolvedValue(makeRow());
      mockExistsSync.mockReturnValue(false);

      await service.upload('task', VALID_UUID, 'user-1', 'file.txt', 'text/plain', buffer);

      expect(mockMkdirSync).toHaveBeenCalledWith(
        expect.stringContaining('task'),
        { recursive: true },
      );
    });

    it('does not create directory if it already exists', async () => {
      const buffer = Buffer.from('data');
      mockInsert.mockResolvedValue(undefined);
      mockFindById.mockResolvedValue(makeRow());
      mockExistsSync.mockReturnValue(true);

      await service.upload('task', VALID_UUID, 'user-1', 'file.txt', 'text/plain', buffer);

      expect(mockMkdirSync).not.toHaveBeenCalled();
    });

    it('writes the file to disk', async () => {
      const buffer = Buffer.from('content');
      mockInsert.mockResolvedValue(undefined);
      mockFindById.mockResolvedValue(makeRow());

      await service.upload('task', VALID_UUID, 'user-1', 'file.txt', 'text/plain', buffer);

      expect(mockWriteFile).toHaveBeenCalledWith(
        expect.stringContaining('mock-uuid-1234-5678-9abc-def012345678.txt'),
        buffer,
      );
    });

    it('inserts into the repository with correct parameters', async () => {
      const buffer = Buffer.from('abc');
      mockInsert.mockResolvedValue(undefined);
      mockFindById.mockResolvedValue(makeRow());

      await service.upload('project', VALID_UUID, 'user-1', 'doc.pdf', 'application/pdf', buffer);

      expect(mockInsert).toHaveBeenCalledWith(
        'mock-uuid-1234-5678-9abc-def012345678',
        'project',
        VALID_UUID,
        'user-1',
        'mock-uuid-1234-5678-9abc-def012345678.pdf',
        'doc.pdf',
        'application/pdf',
        3, // buffer.length
        expect.stringContaining('mock-uuid-1234-5678-9abc-def012345678.pdf'),
        1,
        null,
      );
    });

    it('throws for invalid entity type', async () => {
      const buffer = Buffer.from('data');

      await expect(
        service.upload('invalid_type', VALID_UUID, 'user-1', 'file.txt', 'text/plain', buffer),
      ).rejects.toThrow('Invalid entity type: invalid_type');
    });

    it('throws for invalid entity ID (not a UUID)', async () => {
      const buffer = Buffer.from('data');

      await expect(
        service.upload('task', 'not-a-uuid', 'user-1', 'file.txt', 'text/plain', buffer),
      ).rejects.toThrow('Invalid entity ID: not-a-uuid');
    });

    it('accepts all allowed entity types', async () => {
      const allowedTypes = ['project', 'task', 'schedule', 'risk', 'issue', 'decision', 'action', 'sprint', 'goal', 'meeting'];
      const buffer = Buffer.from('x');
      mockInsert.mockResolvedValue(undefined);

      for (const entityType of allowedTypes) {
        mockFindById.mockResolvedValue(makeRow({ entity_type: entityType }));
        const result = await service.upload(entityType, VALID_UUID, 'user-1', 'f.txt', 'text/plain', buffer);
        expect(result.entityType).toBe(entityType);
      }
    });

    it('preserves the file extension from original name', async () => {
      const buffer = Buffer.from('img');
      mockInsert.mockResolvedValue(undefined);
      mockFindById.mockResolvedValue(makeRow());

      await service.upload('task', VALID_UUID, 'user-1', 'photo.png', 'image/png', buffer);

      expect(mockWriteFile).toHaveBeenCalledWith(
        expect.stringContaining('.png'),
        buffer,
      );
    });
  });

  // ── getByEntity ─────────────────────────────────────────────────────

  describe('getByEntity', () => {
    it('returns DTOs for all matching rows', async () => {
      const rows = [
        makeRow({ id: 'a', original_name: 'file1.txt' }),
        makeRow({ id: 'b', original_name: 'file2.txt' }),
      ];
      mockFindByEntity.mockResolvedValue(rows);

      const result = await service.getByEntity('task', VALID_UUID);

      expect(mockFindByEntity).toHaveBeenCalledWith('task', VALID_UUID);
      expect(result).toHaveLength(2);
      expect(result[0].id).toBe('a');
      expect(result[0].originalName).toBe('file1.txt');
      expect(result[1].id).toBe('b');
    });

    it('returns empty array when no attachments exist', async () => {
      mockFindByEntity.mockResolvedValue([]);

      const result = await service.getByEntity('project', VALID_UUID);

      expect(result).toEqual([]);
    });
  });

  // ── getById ─────────────────────────────────────────────────────────

  describe('getById', () => {
    it('returns a DTO when the attachment exists', async () => {
      mockFindById.mockResolvedValue(makeRow({ id: 'att-1', original_name: 'resume.pdf' }));

      const result = await service.getById('att-1');

      expect(mockFindById).toHaveBeenCalledWith('att-1');
      expect(result).not.toBeNull();
      expect(result!.id).toBe('att-1');
      expect(result!.originalName).toBe('resume.pdf');
    });

    it('returns null when the attachment does not exist', async () => {
      mockFindById.mockResolvedValue(null);

      const result = await service.getById('nonexistent');

      expect(result).toBeNull();
    });

    it('maps all row fields to DTO correctly', async () => {
      const row = makeRow({
        id: 'id-1',
        entity_type: 'project',
        entity_id: VALID_UUID,
        uploaded_by: 'user-42',
        file_name: 'stored-name.docx',
        original_name: 'report.docx',
        mime_type: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
        file_size: 54321,
        file_path: '/test/uploads/project/stored-name.docx',
        version: 3,
        parent_id: 'parent-id',
        created_at: '2026-06-15T10:30:00Z',
      });
      mockFindById.mockResolvedValue(row);

      const result = await service.getById('id-1');

      expect(result).toEqual({
        id: 'id-1',
        entityType: 'project',
        entityId: VALID_UUID,
        uploadedBy: 'user-42',
        fileName: 'stored-name.docx',
        originalName: 'report.docx',
        mimeType: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
        fileSize: 54321,
        filePath: '/test/uploads/project/stored-name.docx',
        version: 3,
        parentId: 'parent-id',
        createdAt: '2026-06-15T10:30:00Z',
      });
    });
  });

  // ── delete ──────────────────────────────────────────────────────────

  describe('delete', () => {
    it('deletes the file from disk and the DB record plus versions', async () => {
      const row = makeRow({ id: 'del-1', file_path: '/test/uploads/task/file.txt' });
      mockFindById.mockResolvedValue(row);
      mockExistsSync.mockReturnValue(true);
      mockFindVersions.mockResolvedValue([]);
      mockDeleteWithVersions.mockResolvedValue(undefined);

      await service.delete('del-1');

      expect(mockUnlinkSync).toHaveBeenCalledWith('/test/uploads/task/file.txt');
      expect(mockDeleteWithVersions).toHaveBeenCalledWith('del-1');
    });

    it('does not attempt to unlink if the file does not exist on disk', async () => {
      const row = makeRow({ id: 'del-2', file_path: '/missing/path.txt' });
      mockFindById.mockResolvedValue(row);
      mockExistsSync.mockReturnValue(false);
      mockFindVersions.mockResolvedValue([]);
      mockDeleteWithVersions.mockResolvedValue(undefined);

      await service.delete('del-2');

      expect(mockUnlinkSync).not.toHaveBeenCalled();
      expect(mockDeleteWithVersions).toHaveBeenCalledWith('del-2');
    });

    it('deletes version files from disk as well', async () => {
      const row = makeRow({ id: 'del-3', file_path: '/test/parent.txt' });
      mockFindById.mockResolvedValue(row);
      mockExistsSync.mockReturnValue(true);
      const versions = [
        makeRow({ id: 'v1', file_path: '/test/v1.txt', parent_id: 'del-3', version: 2 }),
        makeRow({ id: 'v2', file_path: '/test/v2.txt', parent_id: 'del-3', version: 3 }),
      ];
      mockFindVersions.mockResolvedValue(versions);
      mockDeleteWithVersions.mockResolvedValue(undefined);

      await service.delete('del-3');

      // Parent file + 2 version files
      expect(mockUnlinkSync).toHaveBeenCalledTimes(3);
      expect(mockUnlinkSync).toHaveBeenCalledWith('/test/parent.txt');
      expect(mockUnlinkSync).toHaveBeenCalledWith('/test/v1.txt');
      expect(mockUnlinkSync).toHaveBeenCalledWith('/test/v2.txt');
    });

    it('handles case where attachment does not exist in DB', async () => {
      mockFindById.mockResolvedValue(null);
      mockFindVersions.mockResolvedValue([]);
      mockDeleteWithVersions.mockResolvedValue(undefined);

      // Should not throw
      await service.delete('nonexistent');

      expect(mockUnlinkSync).not.toHaveBeenCalled();
      expect(mockDeleteWithVersions).toHaveBeenCalledWith('nonexistent');
    });

    it('only deletes version files that exist on disk', async () => {
      const row = makeRow({ id: 'del-4', file_path: '/test/main.txt' });
      mockFindById.mockResolvedValue(row);
      const versions = [
        makeRow({ id: 'v1', file_path: '/test/v1.txt', version: 2 }),
      ];
      mockFindVersions.mockResolvedValue(versions);
      mockDeleteWithVersions.mockResolvedValue(undefined);

      // Main file exists, version file does not
      mockExistsSync.mockImplementation((p: string) => p === '/test/main.txt');

      await service.delete('del-4');

      expect(mockUnlinkSync).toHaveBeenCalledTimes(1);
      expect(mockUnlinkSync).toHaveBeenCalledWith('/test/main.txt');
    });
  });

  // ── uploadNewVersion ────────────────────────────────────────────────

  describe('uploadNewVersion', () => {
    it('creates a new version linked to the root parent', async () => {
      const parentRow = makeRow({
        id: 'parent-1',
        entity_type: 'task',
        entity_id: VALID_UUID,
        version: 1,
        parent_id: null,
      });
      mockFindById
        .mockResolvedValueOnce(parentRow) // getById call for parent
        .mockResolvedValueOnce(makeRow({ // findById call for the new version
          id: 'mock-uuid-1234-5678-9abc-def012345678',
          version: 2,
          parent_id: 'parent-1',
        }));
      mockGetMaxVersion.mockResolvedValue(1);
      mockInsert.mockResolvedValue(undefined);

      const buffer = Buffer.from('v2 content');
      const result = await service.uploadNewVersion('parent-1', 'user-1', 'updated.txt', 'text/plain', buffer);

      expect(mockGetMaxVersion).toHaveBeenCalledWith('parent-1'); // rootId = parent.id when no parent_id
      expect(mockInsert).toHaveBeenCalledWith(
        'mock-uuid-1234-5678-9abc-def012345678',
        'task',
        VALID_UUID,
        'user-1',
        'mock-uuid-1234-5678-9abc-def012345678.txt',
        'updated.txt',
        'text/plain',
        10, // buffer.length
        expect.any(String),
        2, // nextVersion = maxVer + 1
        'parent-1', // rootId
      );
      expect(result.version).toBe(2);
      expect(result.parentId).toBe('parent-1');
    });

    it('uses the parent_id as rootId when parent already has a parent', async () => {
      const parentRow = makeRow({
        id: 'child-1',
        entity_type: 'project',
        entity_id: VALID_UUID,
        version: 2,
        parent_id: 'root-1', // This version already has a parent
      });
      mockFindById
        .mockResolvedValueOnce(parentRow)
        .mockResolvedValueOnce(makeRow({ id: 'new-id', version: 3, parent_id: 'root-1' }));
      mockGetMaxVersion.mockResolvedValue(2);
      mockInsert.mockResolvedValue(undefined);

      const buffer = Buffer.from('v3');
      await service.uploadNewVersion('child-1', 'user-1', 'v3.txt', 'text/plain', buffer);

      // rootId should be parent.parentId, not parent.id
      expect(mockGetMaxVersion).toHaveBeenCalledWith('root-1');
      expect(mockInsert).toHaveBeenCalledWith(
        expect.any(String),
        'project',
        VALID_UUID,
        'user-1',
        expect.any(String),
        'v3.txt',
        'text/plain',
        2,
        expect.any(String),
        3, // maxVer(2) + 1
        'root-1', // rootId from parent.parentId
      );
    });

    it('throws when parent attachment does not exist', async () => {
      mockFindById.mockResolvedValue(null);

      await expect(
        service.uploadNewVersion('nonexistent', 'user-1', 'file.txt', 'text/plain', Buffer.from('x')),
      ).rejects.toThrow('Parent attachment not found');
    });

    it('writes the new version file to disk in the same directory', async () => {
      const parentRow = makeRow({
        id: 'p-1',
        entity_type: 'task',
        entity_id: VALID_UUID,
        version: 1,
        parent_id: null,
      });
      mockFindById
        .mockResolvedValueOnce(parentRow)
        .mockResolvedValueOnce(makeRow({ version: 2 }));
      mockGetMaxVersion.mockResolvedValue(1);
      mockInsert.mockResolvedValue(undefined);

      const buffer = Buffer.from('new data');
      await service.uploadNewVersion('p-1', 'user-1', 'updated.docx', 'application/docx', buffer);

      expect(mockWriteFile).toHaveBeenCalledWith(
        expect.stringContaining('.docx'),
        buffer,
      );
    });
  });

  // ── getVersionHistory ───────────────────────────────────────────────

  describe('getVersionHistory', () => {
    it('returns version history for a root attachment', async () => {
      const rootRow = makeRow({ id: 'root-1', parent_id: null, version: 1 });
      mockFindById.mockResolvedValue(rootRow);

      const historyRows = [
        makeRow({ id: 'v2', parent_id: 'root-1', version: 2 }),
        makeRow({ id: 'root-1', parent_id: null, version: 1 }),
      ];
      mockFindVersionHistory.mockResolvedValue(historyRows);

      const result = await service.getVersionHistory('root-1');

      expect(mockFindVersionHistory).toHaveBeenCalledWith('root-1');
      expect(result).toHaveLength(2);
      expect(result[0].version).toBe(2);
      expect(result[1].version).toBe(1);
    });

    it('uses parentId as rootId when called on a child version', async () => {
      const childRow = makeRow({ id: 'v3', parent_id: 'root-1', version: 3 });
      mockFindById.mockResolvedValue(childRow);

      mockFindVersionHistory.mockResolvedValue([
        makeRow({ id: 'v3', parent_id: 'root-1', version: 3 }),
        makeRow({ id: 'v2', parent_id: 'root-1', version: 2 }),
        makeRow({ id: 'root-1', parent_id: null, version: 1 }),
      ]);

      const result = await service.getVersionHistory('v3');

      // Should query with parent_id as root, not the child id
      expect(mockFindVersionHistory).toHaveBeenCalledWith('root-1');
      expect(result).toHaveLength(3);
    });

    it('returns empty array when attachment does not exist', async () => {
      mockFindById.mockResolvedValue(null);

      const result = await service.getVersionHistory('nonexistent');

      expect(result).toEqual([]);
      expect(mockFindVersionHistory).not.toHaveBeenCalled();
    });
  });
});
