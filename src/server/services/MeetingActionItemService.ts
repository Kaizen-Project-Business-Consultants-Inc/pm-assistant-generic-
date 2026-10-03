import { meetingActionItemRepository, type MeetingActionItem } from '../database/MeetingActionItemRepository';

/**
 * Meeting action items — read-only history (Oct 2026). Meeting actions are RAID actions now
 * (riskService, type 'action', source 'meeting'); this only looks up the old ones.
 */
class MeetingActionItemService {
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

  async getItem(id: string): Promise<MeetingActionItem | null> {
    return meetingActionItemRepository.findById(id);
  }
}

export const meetingActionItemService = new MeetingActionItemService();
