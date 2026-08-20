import { meetingRepository, type Meeting, type AgendaItem } from '../database/MeetingRepository';
import { meetingActionItemRepository } from '../database/MeetingActionItemRepository';
import { meetingAnalysisRepository } from '../database/MeetingAnalysisRepository';
import { auditLedgerService } from './AuditLedgerService';
import { deadLetterService } from './DeadLetterService';
import logger from '../utils/logger';

class MeetingService {
  async createMeeting(projectId: string, data: {
    title: string;
    meetingType?: string;
    scheduledDate: string;
    durationMinutes?: number;
    location?: string;
    attendees?: string[];
    agendaItems?: AgendaItem[];
    notes?: string;
  }, userId: string): Promise<Meeting> {
    const meeting = await meetingRepository.create({
      ...data,
      projectId,
      createdBy: userId,
    });

    auditLedgerService.append({
      actorId: userId, actorType: 'user', action: 'meeting.create',
      entityType: 'meeting', entityId: meeting.id, projectId,
      payload: { title: data.title, meetingType: data.meetingType },
      source: 'web',
    }).catch(err => deadLetterService.capture('audit.append', {}, err));

    return meeting;
  }

  async updateMeeting(id: string, data: {
    title?: string;
    meetingType?: string;
    scheduledDate?: string;
    durationMinutes?: number;
    location?: string;
    attendees?: string[];
    agendaItems?: AgendaItem[];
    notes?: string;
    status?: string;
  }, userId: string): Promise<Meeting> {
    const meeting = await meetingRepository.findById(id);
    if (!meeting) throw new Error('Meeting not found');

    const updated = await meetingRepository.update(id, data);

    auditLedgerService.append({
      actorId: userId, actorType: 'user', action: 'meeting.update',
      entityType: 'meeting', entityId: id, projectId: meeting.projectId,
      payload: { fields: Object.keys(data) },
      source: 'web',
    }).catch(err => deadLetterService.capture('audit.append', {}, err));

    return updated;
  }

  async deleteMeeting(id: string, userId: string): Promise<void> {
    const meeting = await meetingRepository.findById(id);
    if (!meeting) throw new Error('Meeting not found');

    // Cascade: delete linked action items
    await meetingActionItemRepository.deleteByMeeting(id);

    // Unlink meeting_analyses
    const analyses = await meetingAnalysisRepository.findByMeeting(id);
    for (const a of analyses) {
      await meetingAnalysisRepository.updateMeetingId(a.id, null);
    }

    await meetingRepository.delete(id);

    auditLedgerService.append({
      actorId: userId, actorType: 'user', action: 'meeting.delete',
      entityType: 'meeting', entityId: id, projectId: meeting.projectId,
      payload: { title: meeting.title },
      source: 'web',
    }).catch(err => deadLetterService.capture('audit.append', {}, err));
  }

  async getMeetings(projectId: string, filters?: {
    status?: string;
    type?: string;
    from?: string;
    to?: string;
  }): Promise<Meeting[]> {
    return meetingRepository.findAll(projectId, filters);
  }

  async getMeeting(id: string): Promise<{
    meeting: Meeting;
    actionItems: import('../database/MeetingActionItemRepository').MeetingActionItem[];
    analyses: import('../database/MeetingAnalysisRepository').MeetingAnalysisRow[];
  } | null> {
    const meeting = await meetingRepository.findById(id);
    if (!meeting) return null;

    const [actionItems, analyses] = await Promise.all([
      meetingActionItemRepository.findByMeeting(id),
      meetingAnalysisRepository.findByMeeting(id),
    ]);

    return { meeting, actionItems, analyses };
  }

  async completeMeeting(id: string, userId: string): Promise<Meeting> {
    const meeting = await meetingRepository.findById(id);
    if (!meeting) throw new Error('Meeting not found');
    if (meeting.status === 'cancelled') throw new Error('Cannot complete a cancelled meeting');

    return meetingRepository.update(id, { status: 'completed' });
  }

  async cancelMeeting(id: string, userId: string): Promise<Meeting> {
    const meeting = await meetingRepository.findById(id);
    if (!meeting) throw new Error('Meeting not found');
    if (meeting.status === 'completed') throw new Error('Cannot cancel a completed meeting');

    return meetingRepository.update(id, { status: 'cancelled' });
  }

  async getUpcoming(projectId: string): Promise<Meeting[]> {
    return meetingRepository.findUpcoming(projectId, 5);
  }

  async linkAnalysis(meetingId: string, analysisId: string): Promise<void> {
    const meeting = await meetingRepository.findById(meetingId);
    if (!meeting) throw new Error('Meeting not found');

    const analysis = await meetingAnalysisRepository.findById(analysisId);
    if (!analysis) throw new Error('Analysis not found');

    await meetingAnalysisRepository.updateMeetingId(analysisId, meetingId);
  }

  async importActionItemsFromAnalysis(
    meetingId: string,
    analysisId: string,
    userId: string,
  ): Promise<number> {
    const meeting = await meetingRepository.findById(meetingId);
    if (!meeting) throw new Error('Meeting not found');

    const analysis = await meetingAnalysisRepository.findById(analysisId);
    if (!analysis) throw new Error('Analysis not found');

    let actionItems: any[];
    try {
      actionItems = typeof analysis.action_items === 'string'
        ? JSON.parse(analysis.action_items)
        : analysis.action_items;
    } catch {
      actionItems = [];
    }

    if (!Array.isArray(actionItems) || actionItems.length === 0) return 0;

    let imported = 0;
    for (const item of actionItems) {
      try {
        await meetingActionItemRepository.create({
          meetingId,
          projectId: meeting.projectId,
          description: item.description || String(item),
          assigneeName: item.assignee || null,
          dueDate: item.dueDate || null,
          priority: item.priority || 'medium',
          source: 'ai_extracted',
          sourceAnalysisId: analysisId,
          createdBy: userId,
        });
        imported++;
      } catch (err) {
        logger.warn('Failed to import action item from analysis', {
          analysisId,
          error: (err as Error).message,
        });
      }
    }

    return imported;
  }
}

export const meetingService = new MeetingService();
