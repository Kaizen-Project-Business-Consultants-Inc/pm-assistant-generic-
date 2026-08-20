import { meetingActionItemRepository, type MeetingActionItem } from '../database/MeetingActionItemRepository';
import { meetingRepository } from '../database/MeetingRepository';
import { notificationService } from './NotificationService';
import { auditLedgerService } from './AuditLedgerService';
import { deadLetterService } from './DeadLetterService';
import logger from '../utils/logger';

class MeetingActionItemService {
  async createItem(meetingId: string, data: {
    description: string;
    assigneeName?: string;
    assigneeUserId?: string;
    dueDate?: string;
    priority?: string;
    notes?: string;
  }, userId: string): Promise<MeetingActionItem> {
    const meeting = await meetingRepository.findById(meetingId);
    if (!meeting) throw new Error('Meeting not found');

    const item = await meetingActionItemRepository.create({
      meetingId,
      projectId: meeting.projectId,
      description: data.description,
      assigneeName: data.assigneeName,
      assigneeUserId: data.assigneeUserId,
      dueDate: data.dueDate,
      priority: data.priority,
      notes: data.notes,
      createdBy: userId,
    });

    // Notify assignee (fire-and-forget)
    if (data.assigneeUserId && data.assigneeUserId !== userId) {
      notificationService.create({
        userId: data.assigneeUserId,
        type: 'meeting_action_assigned',
        severity: 'medium',
        title: 'Meeting Action Item Assigned',
        message: `You have been assigned an action item: "${data.description}"`,
        projectId: meeting.projectId,
        linkType: 'meeting_action_item',
        linkId: item.id,
      }).catch(err => logger.warn('Failed to notify action item assignment', { error: (err as Error).message }));
    }

    auditLedgerService.append({
      actorId: userId, actorType: 'user', action: 'meeting_action_item.create',
      entityType: 'meeting_action_item', entityId: item.id, projectId: meeting.projectId,
      payload: { description: data.description, meetingId },
      source: 'web',
    }).catch(err => deadLetterService.capture('audit.append', {}, err));

    return item;
  }

  async updateItem(id: string, data: {
    description?: string;
    assigneeName?: string;
    assigneeUserId?: string;
    dueDate?: string;
    priority?: string;
    status?: string;
    notes?: string;
  }, userId: string): Promise<MeetingActionItem> {
    const item = await meetingActionItemRepository.findById(id);
    if (!item) throw new Error('Action item not found');

    return meetingActionItemRepository.update(id, data);
  }

  async completeItem(id: string, userId: string): Promise<MeetingActionItem> {
    const item = await meetingActionItemRepository.findById(id);
    if (!item) throw new Error('Action item not found');
    if (item.status === 'completed') return item;

    const updated = await meetingActionItemRepository.updateStatus(id, 'completed',
      new Date().toISOString().slice(0, 19).replace('T', ' '));

    // Notify assignee if different from completer
    if (item.assigneeUserId && item.assigneeUserId !== userId) {
      notificationService.create({
        userId: item.assigneeUserId,
        type: 'meeting_action_completed',
        severity: 'low',
        title: 'Action Item Completed',
        message: `Action item "${item.description}" has been marked complete`,
        projectId: item.projectId,
        linkType: 'meeting_action_item',
        linkId: id,
      }).catch(err => logger.warn('Failed to notify action item completion', { error: (err as Error).message }));
    }

    return updated;
  }

  async reopenItem(id: string, userId: string): Promise<MeetingActionItem> {
    const item = await meetingActionItemRepository.findById(id);
    if (!item) throw new Error('Action item not found');
    if (item.status !== 'completed') throw new Error('Only completed items can be reopened');

    return meetingActionItemRepository.updateStatus(id, 'open', null);
  }

  async cancelItem(id: string, userId: string): Promise<MeetingActionItem> {
    const item = await meetingActionItemRepository.findById(id);
    if (!item) throw new Error('Action item not found');
    if (item.status === 'completed') throw new Error('Cannot cancel a completed item');

    return meetingActionItemRepository.updateStatus(id, 'cancelled', null);
  }

  async getItemsByMeeting(meetingId: string): Promise<MeetingActionItem[]> {
    return meetingActionItemRepository.findByMeeting(meetingId);
  }

  async getItemsByProject(projectId: string, filters?: {
    status?: string;
    assigneeUserId?: string;
    overdue?: boolean;
  }): Promise<MeetingActionItem[]> {
    return meetingActionItemRepository.findByProject(projectId, filters);
  }

  async getMyItems(userId: string, filters?: {
    status?: string;
    overdue?: boolean;
  }): Promise<MeetingActionItem[]> {
    return meetingActionItemRepository.findByAssignee(userId, filters);
  }

  async getSummary(projectId?: string): Promise<Record<string, number> & { overdue: number }> {
    return meetingActionItemRepository.countByStatus(projectId);
  }

  async getItem(id: string): Promise<MeetingActionItem | null> {
    return meetingActionItemRepository.findById(id);
  }
}

export const meetingActionItemService = new MeetingActionItemService();
