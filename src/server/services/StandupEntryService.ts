import { standupEntryRepository, StandupEntry } from '../database/StandupEntryRepository';
import { sprintService } from './SprintService';
import { riskService } from './RiskService';
import { notificationService } from './NotificationService';
import { projectMemberRepository } from '../database/ProjectMemberRepository';
import logger from '../utils/logger';

class StandupEntryService {
  async submit(data: {
    sprintId: string;
    projectId: string;
    userId: string;
    entryDate: string;
    yesterday?: string | null;
    today?: string | null;
    blockers?: string[] | null;
  }): Promise<StandupEntry> {
    // Validate sprint is active
    const sprint = await sprintService.getById(data.sprintId);
    if (!sprint) throw new Error('Sprint not found');
    if (sprint.status !== 'active') throw new Error('Sprint must be active to submit standups');

    const entry = await standupEntryRepository.upsert(data);

    // Fire-and-forget: create RAID issues from blockers
    if (data.blockers && data.blockers.length > 0) {
      for (const blocker of data.blockers) {
        riskService.create({
          projectId: data.projectId,
          type: 'issue',
          title: blocker,
          source: 'standup' as any,
          createdBy: data.userId,
        }).catch((err) => logger.warn('Failed to create RAID from standup blocker', { error: err.message }));
      }
    }

    // Fire-and-forget: notify project managers
    projectMemberRepository.findByProjectId(data.projectId)
      .then((members: any[]) => {
        const managers = members.filter((m) => m.role === 'owner' || m.role === 'manager');
        for (const mgr of managers) {
          if (mgr.userId === data.userId) continue;
          notificationService.create({
            userId: mgr.userId,
            type: 'standup_submitted',
            title: 'Standup Submitted',
            message: `A team member submitted their daily standup for ${data.entryDate}`,
            projectId: data.projectId,
          }).catch((e: any) => logger.warn('Failed to send standup notification', { error: e.message }));
        }
      })
      .catch((e: any) => logger.warn('Failed to notify managers of standup', { error: e.message }));

    return entry;
  }

  async getByDate(sprintId: string, date: string): Promise<StandupEntry[]> {
    return standupEntryRepository.findBySprintAndDate(sprintId, date);
  }

  async getTimeline(sprintId: string): Promise<{ date: string; count: number }[]> {
    return standupEntryRepository.getTimeline(sprintId);
  }

  async update(id: string, userId: string, data: { yesterday?: string | null; today?: string | null; blockers?: string[] | null }): Promise<StandupEntry> {
    const existing = await standupEntryRepository.findById(id);
    if (!existing) throw new Error('Standup entry not found');
    if (existing.userId !== userId) throw new Error('Can only update your own standup entry');

    const updated = await standupEntryRepository.update(id, data);
    if (!updated) throw new Error('Failed to update standup entry');
    return updated;
  }

  async delete(id: string, userId: string): Promise<void> {
    const existing = await standupEntryRepository.findById(id);
    if (!existing) throw new Error('Standup entry not found');
    if (existing.userId !== userId) throw new Error('Can only delete your own standup entry');

    await standupEntryRepository.deleteById(id);
  }
}

export const standupEntryService = new StandupEntryService();
