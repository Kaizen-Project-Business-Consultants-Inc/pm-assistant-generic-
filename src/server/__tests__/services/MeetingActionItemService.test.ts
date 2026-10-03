import { describe, it, expect, vi, beforeEach } from 'vitest';

// Meeting action items are read-only history since Oct 2026 (meeting actions live in the RAID
// log), so only the look-ups are left.

// ── Mocks ────────────────────────────────────────────────────────────
const mockRepoFindById = vi.fn();
const mockRepoFindByMeeting = vi.fn();
const mockRepoFindByProject = vi.fn();

vi.mock('../../database/MeetingActionItemRepository', () => ({
  meetingActionItemRepository: {
    findById: (...args: any[]) => mockRepoFindById(...args),
    findByMeeting: (...args: any[]) => mockRepoFindByMeeting(...args),
    findByProject: (...args: any[]) => mockRepoFindByProject(...args),
  },
}));

import { meetingActionItemService } from '../../services/MeetingActionItemService';

// ── Helpers ──────────────────────────────────────────────────────────
function makeActionItem(overrides: Partial<{
  id: string;
  meetingId: string;
  projectId: string;
  description: string;
  assigneeName: string;
  assigneeUserId: string;
  dueDate: string;
  priority: string;
  status: string;
  notes: string;
  createdBy: string;
  completedAt: string | null;
}> = {}) {
  return {
    id: overrides.id ?? 'item-1',
    meetingId: overrides.meetingId ?? 'meeting-1',
    projectId: overrides.projectId ?? 'proj-1',
    description: overrides.description ?? 'Follow up on design review',
    assigneeName: overrides.assigneeName ?? 'John Doe',
    assigneeUserId: overrides.assigneeUserId ?? 'user-2',
    dueDate: overrides.dueDate ?? '2026-09-20',
    priority: overrides.priority ?? 'medium',
    status: overrides.status ?? 'open',
    notes: overrides.notes ?? '',
    createdBy: overrides.createdBy ?? 'user-1',
    completedAt: overrides.completedAt ?? null,
  };
}

// ── Tests ────────────────────────────────────────────────────────────
describe('MeetingActionItemService (read-only history)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('has no way left to create or change an action item', () => {
    for (const m of ['createItem', 'updateItem', 'completeItem', 'reopenItem', 'cancelItem', 'getMyItems', 'getSummary']) {
      expect((meetingActionItemService as any)[m], m).toBeUndefined();
    }
  });

  // ── getItemsByMeeting ───────────────────────────────────────────────
  describe('getItemsByMeeting', () => {
    it('delegates to repository', async () => {
      const items = [makeActionItem(), makeActionItem({ id: 'item-2' })];
      mockRepoFindByMeeting.mockResolvedValue(items);

      const result = await meetingActionItemService.getItemsByMeeting('meeting-1');

      expect(mockRepoFindByMeeting).toHaveBeenCalledWith('meeting-1');
      expect(result).toBe(items);
    });

    it('returns empty array when no items exist', async () => {
      mockRepoFindByMeeting.mockResolvedValue([]);

      const result = await meetingActionItemService.getItemsByMeeting('meeting-999');

      expect(result).toEqual([]);
    });
  });

  // ── getItemsByProject ───────────────────────────────────────────────
  describe('getItemsByProject', () => {
    it('delegates to repository without filters', async () => {
      const items = [makeActionItem()];
      mockRepoFindByProject.mockResolvedValue(items);

      const result = await meetingActionItemService.getItemsByProject('proj-1');

      expect(mockRepoFindByProject).toHaveBeenCalledWith('proj-1', undefined);
      expect(result).toBe(items);
    });

    it('passes filters to repository', async () => {
      mockRepoFindByProject.mockResolvedValue([]);

      const filters = { status: 'open', assigneeUserId: 'user-2', overdue: true };
      await meetingActionItemService.getItemsByProject('proj-1', filters);

      expect(mockRepoFindByProject).toHaveBeenCalledWith('proj-1', filters);
    });
  });

  // ── getItem ─────────────────────────────────────────────────────────
  describe('getItem', () => {
    it('returns item when found', async () => {
      const item = makeActionItem({ id: 'item-42' });
      mockRepoFindById.mockResolvedValue(item);

      const result = await meetingActionItemService.getItem('item-42');

      expect(mockRepoFindById).toHaveBeenCalledWith('item-42');
      expect(result).toBe(item);
    });

    it('returns null when not found', async () => {
      mockRepoFindById.mockResolvedValue(null);

      const result = await meetingActionItemService.getItem('nonexistent');

      expect(result).toBeNull();
    });
  });
});
