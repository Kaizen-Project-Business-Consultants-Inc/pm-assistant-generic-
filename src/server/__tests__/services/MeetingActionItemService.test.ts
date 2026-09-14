import { describe, it, expect, vi, beforeEach } from 'vitest';

// ── Mocks ────────────────────────────────────────────────────────────
const mockRepoCreate = vi.fn();
const mockRepoFindById = vi.fn();
const mockRepoUpdate = vi.fn();
const mockRepoUpdateStatus = vi.fn();
const mockRepoFindByMeeting = vi.fn();
const mockRepoFindByProject = vi.fn();
const mockRepoFindByAssignee = vi.fn();
const mockRepoCountByStatus = vi.fn();

vi.mock('../../database/MeetingActionItemRepository', () => ({
  meetingActionItemRepository: {
    create: (...args: any[]) => mockRepoCreate(...args),
    findById: (...args: any[]) => mockRepoFindById(...args),
    update: (...args: any[]) => mockRepoUpdate(...args),
    updateStatus: (...args: any[]) => mockRepoUpdateStatus(...args),
    findByMeeting: (...args: any[]) => mockRepoFindByMeeting(...args),
    findByProject: (...args: any[]) => mockRepoFindByProject(...args),
    findByAssignee: (...args: any[]) => mockRepoFindByAssignee(...args),
    countByStatus: (...args: any[]) => mockRepoCountByStatus(...args),
  },
}));

const mockMeetingFindById = vi.fn();
vi.mock('../../database/MeetingRepository', () => ({
  meetingRepository: {
    findById: (...args: any[]) => mockMeetingFindById(...args),
  },
}));

const mockNotificationCreate = vi.fn();
vi.mock('../../services/NotificationService', () => ({
  notificationService: {
    create: (...args: any[]) => mockNotificationCreate(...args),
  },
}));

const mockAuditAppend = vi.fn();
vi.mock('../../services/AuditLedgerService', () => ({
  auditLedgerService: {
    append: (...args: any[]) => mockAuditAppend(...args),
  },
}));

const mockDeadLetterCapture = vi.fn();
vi.mock('../../services/DeadLetterService', () => ({
  deadLetterService: {
    capture: (...args: any[]) => mockDeadLetterCapture(...args),
  },
}));

vi.mock('../../utils/logger', () => ({
  default: {
    warn: vi.fn(),
    error: vi.fn(),
    info: vi.fn(),
  },
}));

import { meetingActionItemService } from '../../services/MeetingActionItemService';

// ── Helpers ──────────────────────────────────────────────────────────
function makeMeeting(overrides: Partial<{ id: string; projectId: string }> = {}) {
  return {
    id: overrides.id ?? 'meeting-1',
    projectId: overrides.projectId ?? 'proj-1',
  };
}

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
describe('MeetingActionItemService', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    // Default: fire-and-forget calls resolve
    mockNotificationCreate.mockResolvedValue(undefined);
    mockAuditAppend.mockResolvedValue(undefined);
  });

  // ── createItem ──────────────────────────────────────────────────────
  describe('createItem', () => {
    it('creates an action item and returns it', async () => {
      const meeting = makeMeeting();
      const createdItem = makeActionItem();
      mockMeetingFindById.mockResolvedValue(meeting);
      mockRepoCreate.mockResolvedValue(createdItem);

      const result = await meetingActionItemService.createItem('meeting-1', {
        description: 'Follow up on design review',
        assigneeName: 'John Doe',
        assigneeUserId: 'user-2',
        dueDate: '2026-09-20',
        priority: 'medium',
      }, 'user-1');

      expect(mockMeetingFindById).toHaveBeenCalledWith('meeting-1');
      expect(mockRepoCreate).toHaveBeenCalledWith({
        meetingId: 'meeting-1',
        projectId: 'proj-1',
        description: 'Follow up on design review',
        assigneeName: 'John Doe',
        assigneeUserId: 'user-2',
        dueDate: '2026-09-20',
        priority: 'medium',
        notes: undefined,
        createdBy: 'user-1',
      });
      expect(result).toBe(createdItem);
    });

    it('throws when meeting not found', async () => {
      mockMeetingFindById.mockResolvedValue(null);

      await expect(
        meetingActionItemService.createItem('nonexistent', { description: 'test' }, 'user-1')
      ).rejects.toThrow('Meeting not found');
    });

    it('sends notification to assignee when assigneeUserId differs from creator', async () => {
      const meeting = makeMeeting();
      const createdItem = makeActionItem({ id: 'item-99' });
      mockMeetingFindById.mockResolvedValue(meeting);
      mockRepoCreate.mockResolvedValue(createdItem);

      await meetingActionItemService.createItem('meeting-1', {
        description: 'Do something',
        assigneeUserId: 'user-2',
      }, 'user-1');

      expect(mockNotificationCreate).toHaveBeenCalledWith(
        expect.objectContaining({
          userId: 'user-2',
          type: 'meeting_action_assigned',
          linkId: 'item-99',
        })
      );
    });

    it('does not send notification when assigneeUserId equals creator', async () => {
      const meeting = makeMeeting();
      mockMeetingFindById.mockResolvedValue(meeting);
      mockRepoCreate.mockResolvedValue(makeActionItem());

      await meetingActionItemService.createItem('meeting-1', {
        description: 'Self-assigned',
        assigneeUserId: 'user-1',
      }, 'user-1');

      expect(mockNotificationCreate).not.toHaveBeenCalled();
    });

    it('does not send notification when no assigneeUserId', async () => {
      const meeting = makeMeeting();
      mockMeetingFindById.mockResolvedValue(meeting);
      mockRepoCreate.mockResolvedValue(makeActionItem());

      await meetingActionItemService.createItem('meeting-1', {
        description: 'Unassigned item',
      }, 'user-1');

      expect(mockNotificationCreate).not.toHaveBeenCalled();
    });

    it('appends audit ledger entry', async () => {
      const meeting = makeMeeting({ projectId: 'proj-5' });
      const createdItem = makeActionItem({ id: 'item-7' });
      mockMeetingFindById.mockResolvedValue(meeting);
      mockRepoCreate.mockResolvedValue(createdItem);

      await meetingActionItemService.createItem('meeting-1', {
        description: 'Audit me',
      }, 'user-1');

      expect(mockAuditAppend).toHaveBeenCalledWith(
        expect.objectContaining({
          actorId: 'user-1',
          action: 'meeting_action_item.create',
          entityType: 'meeting_action_item',
          entityId: 'item-7',
          projectId: 'proj-5',
        })
      );
    });

    it('swallows notification errors gracefully', async () => {
      const meeting = makeMeeting();
      mockMeetingFindById.mockResolvedValue(meeting);
      mockRepoCreate.mockResolvedValue(makeActionItem());
      mockNotificationCreate.mockRejectedValue(new Error('Notification service down'));

      // Should not throw
      const result = await meetingActionItemService.createItem('meeting-1', {
        description: 'test',
        assigneeUserId: 'user-2',
      }, 'user-1');

      expect(result).toBeDefined();
    });

    it('captures audit errors to dead letter service', async () => {
      const meeting = makeMeeting();
      mockMeetingFindById.mockResolvedValue(meeting);
      mockRepoCreate.mockResolvedValue(makeActionItem());
      const auditError = new Error('Audit DB down');
      mockAuditAppend.mockRejectedValue(auditError);

      // Should not throw
      const result = await meetingActionItemService.createItem('meeting-1', {
        description: 'test',
      }, 'user-1');

      expect(result).toBeDefined();
      // Wait for fire-and-forget to settle
      await new Promise(r => setTimeout(r, 10));
      expect(mockDeadLetterCapture).toHaveBeenCalledWith('audit.append', {}, auditError);
    });

    it('creates item with minimal data (description only)', async () => {
      const meeting = makeMeeting();
      mockMeetingFindById.mockResolvedValue(meeting);
      mockRepoCreate.mockResolvedValue(makeActionItem());

      await meetingActionItemService.createItem('meeting-1', {
        description: 'Minimal item',
      }, 'user-1');

      expect(mockRepoCreate).toHaveBeenCalledWith(
        expect.objectContaining({
          description: 'Minimal item',
          assigneeName: undefined,
          assigneeUserId: undefined,
          dueDate: undefined,
          priority: undefined,
          notes: undefined,
        })
      );
    });
  });

  // ── updateItem ──────────────────────────────────────────────────────
  describe('updateItem', () => {
    it('updates and returns the item', async () => {
      const existing = makeActionItem();
      const updated = makeActionItem({ description: 'Updated description' });
      mockRepoFindById.mockResolvedValue(existing);
      mockRepoUpdate.mockResolvedValue(updated);

      const result = await meetingActionItemService.updateItem('item-1', {
        description: 'Updated description',
      }, 'user-1');

      expect(mockRepoFindById).toHaveBeenCalledWith('item-1');
      expect(mockRepoUpdate).toHaveBeenCalledWith('item-1', { description: 'Updated description' });
      expect(result).toBe(updated);
    });

    it('throws when item not found', async () => {
      mockRepoFindById.mockResolvedValue(null);

      await expect(
        meetingActionItemService.updateItem('nonexistent', { description: 'x' }, 'user-1')
      ).rejects.toThrow('Action item not found');
    });

    it('passes all update fields to repository', async () => {
      mockRepoFindById.mockResolvedValue(makeActionItem());
      mockRepoUpdate.mockResolvedValue(makeActionItem());

      const updateData = {
        description: 'New desc',
        assigneeName: 'Jane',
        assigneeUserId: 'user-3',
        dueDate: '2026-10-01',
        priority: 'high',
        status: 'in_progress',
        notes: 'Some notes',
      };

      await meetingActionItemService.updateItem('item-1', updateData, 'user-1');

      expect(mockRepoUpdate).toHaveBeenCalledWith('item-1', updateData);
    });
  });

  // ── completeItem ────────────────────────────────────────────────────
  describe('completeItem', () => {
    it('marks item as completed with timestamp', async () => {
      const item = makeActionItem({ status: 'open' });
      const completedItem = makeActionItem({ status: 'completed' });
      mockRepoFindById.mockResolvedValue(item);
      mockRepoUpdateStatus.mockResolvedValue(completedItem);

      const result = await meetingActionItemService.completeItem('item-1', 'user-1');

      expect(mockRepoUpdateStatus).toHaveBeenCalledWith(
        'item-1',
        'completed',
        expect.stringMatching(/^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}$/)
      );
      expect(result).toBe(completedItem);
    });

    it('throws when item not found', async () => {
      mockRepoFindById.mockResolvedValue(null);

      await expect(
        meetingActionItemService.completeItem('nonexistent', 'user-1')
      ).rejects.toThrow('Action item not found');
    });

    it('returns existing item without updating when already completed', async () => {
      const alreadyCompleted = makeActionItem({ status: 'completed' });
      mockRepoFindById.mockResolvedValue(alreadyCompleted);

      const result = await meetingActionItemService.completeItem('item-1', 'user-1');

      expect(mockRepoUpdateStatus).not.toHaveBeenCalled();
      expect(result).toBe(alreadyCompleted);
    });

    it('sends notification when assignee differs from completer', async () => {
      const item = makeActionItem({ status: 'open', assigneeUserId: 'user-2' });
      mockRepoFindById.mockResolvedValue(item);
      mockRepoUpdateStatus.mockResolvedValue(makeActionItem({ status: 'completed' }));

      await meetingActionItemService.completeItem('item-1', 'user-1');

      expect(mockNotificationCreate).toHaveBeenCalledWith(
        expect.objectContaining({
          userId: 'user-2',
          type: 'meeting_action_completed',
        })
      );
    });

    it('does not send notification when completer is the assignee', async () => {
      const item = makeActionItem({ status: 'open', assigneeUserId: 'user-1' });
      mockRepoFindById.mockResolvedValue(item);
      mockRepoUpdateStatus.mockResolvedValue(makeActionItem({ status: 'completed' }));

      await meetingActionItemService.completeItem('item-1', 'user-1');

      expect(mockNotificationCreate).not.toHaveBeenCalled();
    });

    it('does not send notification when no assigneeUserId', async () => {
      const item = makeActionItem({ status: 'open', assigneeUserId: undefined as any });
      item.assigneeUserId = undefined as any;
      mockRepoFindById.mockResolvedValue(item);
      mockRepoUpdateStatus.mockResolvedValue(makeActionItem({ status: 'completed' }));

      await meetingActionItemService.completeItem('item-1', 'user-1');

      expect(mockNotificationCreate).not.toHaveBeenCalled();
    });

    it('swallows notification errors gracefully', async () => {
      const item = makeActionItem({ status: 'open', assigneeUserId: 'user-2' });
      mockRepoFindById.mockResolvedValue(item);
      mockRepoUpdateStatus.mockResolvedValue(makeActionItem({ status: 'completed' }));
      mockNotificationCreate.mockRejectedValue(new Error('Notification failed'));

      const result = await meetingActionItemService.completeItem('item-1', 'user-1');

      expect(result).toBeDefined();
    });
  });

  // ── reopenItem ──────────────────────────────────────────────────────
  describe('reopenItem', () => {
    it('reopens a completed item', async () => {
      const item = makeActionItem({ status: 'completed' });
      const reopened = makeActionItem({ status: 'open' });
      mockRepoFindById.mockResolvedValue(item);
      mockRepoUpdateStatus.mockResolvedValue(reopened);

      const result = await meetingActionItemService.reopenItem('item-1', 'user-1');

      expect(mockRepoUpdateStatus).toHaveBeenCalledWith('item-1', 'open', null);
      expect(result).toBe(reopened);
    });

    it('throws when item not found', async () => {
      mockRepoFindById.mockResolvedValue(null);

      await expect(
        meetingActionItemService.reopenItem('nonexistent', 'user-1')
      ).rejects.toThrow('Action item not found');
    });

    it('throws when item is not completed', async () => {
      const item = makeActionItem({ status: 'open' });
      mockRepoFindById.mockResolvedValue(item);

      await expect(
        meetingActionItemService.reopenItem('item-1', 'user-1')
      ).rejects.toThrow('Only completed items can be reopened');
    });

    it('throws when item is in_progress (not completed)', async () => {
      const item = makeActionItem({ status: 'in_progress' });
      mockRepoFindById.mockResolvedValue(item);

      await expect(
        meetingActionItemService.reopenItem('item-1', 'user-1')
      ).rejects.toThrow('Only completed items can be reopened');
    });

    it('throws when item is cancelled (not completed)', async () => {
      const item = makeActionItem({ status: 'cancelled' });
      mockRepoFindById.mockResolvedValue(item);

      await expect(
        meetingActionItemService.reopenItem('item-1', 'user-1')
      ).rejects.toThrow('Only completed items can be reopened');
    });
  });

  // ── cancelItem ──────────────────────────────────────────────────────
  describe('cancelItem', () => {
    it('cancels an open item', async () => {
      const item = makeActionItem({ status: 'open' });
      const cancelled = makeActionItem({ status: 'cancelled' });
      mockRepoFindById.mockResolvedValue(item);
      mockRepoUpdateStatus.mockResolvedValue(cancelled);

      const result = await meetingActionItemService.cancelItem('item-1', 'user-1');

      expect(mockRepoUpdateStatus).toHaveBeenCalledWith('item-1', 'cancelled', null);
      expect(result).toBe(cancelled);
    });

    it('throws when item not found', async () => {
      mockRepoFindById.mockResolvedValue(null);

      await expect(
        meetingActionItemService.cancelItem('nonexistent', 'user-1')
      ).rejects.toThrow('Action item not found');
    });

    it('throws when item is already completed', async () => {
      const item = makeActionItem({ status: 'completed' });
      mockRepoFindById.mockResolvedValue(item);

      await expect(
        meetingActionItemService.cancelItem('item-1', 'user-1')
      ).rejects.toThrow('Cannot cancel a completed item');
    });

    it('cancels an in_progress item', async () => {
      const item = makeActionItem({ status: 'in_progress' });
      const cancelled = makeActionItem({ status: 'cancelled' });
      mockRepoFindById.mockResolvedValue(item);
      mockRepoUpdateStatus.mockResolvedValue(cancelled);

      const result = await meetingActionItemService.cancelItem('item-1', 'user-1');

      expect(mockRepoUpdateStatus).toHaveBeenCalledWith('item-1', 'cancelled', null);
      expect(result).toBe(cancelled);
    });
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

  // ── getMyItems ──────────────────────────────────────────────────────
  describe('getMyItems', () => {
    it('delegates to repository with userId', async () => {
      const items = [makeActionItem()];
      mockRepoFindByAssignee.mockResolvedValue(items);

      const result = await meetingActionItemService.getMyItems('user-2');

      expect(mockRepoFindByAssignee).toHaveBeenCalledWith('user-2', undefined);
      expect(result).toBe(items);
    });

    it('passes filters to repository', async () => {
      mockRepoFindByAssignee.mockResolvedValue([]);

      const filters = { status: 'completed', overdue: false };
      await meetingActionItemService.getMyItems('user-2', filters);

      expect(mockRepoFindByAssignee).toHaveBeenCalledWith('user-2', filters);
    });
  });

  // ── getSummary ──────────────────────────────────────────────────────
  describe('getSummary', () => {
    it('delegates to repository with projectId', async () => {
      const summary = { open: 5, completed: 3, cancelled: 1, overdue: 2 };
      mockRepoCountByStatus.mockResolvedValue(summary);

      const result = await meetingActionItemService.getSummary('proj-1');

      expect(mockRepoCountByStatus).toHaveBeenCalledWith('proj-1');
      expect(result).toBe(summary);
    });

    it('delegates to repository without projectId', async () => {
      const summary = { open: 10, completed: 5, cancelled: 2, overdue: 3 };
      mockRepoCountByStatus.mockResolvedValue(summary);

      const result = await meetingActionItemService.getSummary();

      expect(mockRepoCountByStatus).toHaveBeenCalledWith(undefined);
      expect(result).toBe(summary);
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
