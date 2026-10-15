import { projectGroupRepository, type ProjectGroup } from '../database/ProjectGroupRepository';
import { projectService } from './ProjectService';
import { databaseService } from '../database/connection';
import { projectTeamService } from './ProjectTeamService';

/** A client whose resource pool still has people can't be deleted (U8) */
export class ClientHasPeopleError extends Error {
  constructor(count: number) {
    super(`This client still has ${count} ${count === 1 ? 'person' : 'people'} in its resource pool. Move or remove them in Resources first.`);
    this.name = 'ClientHasPeopleError';
  }
}

/**
 * A reorder moves only the clients it names, within the FULL list: they swap among the places they
 * already hold, and every other client keeps its place (a project manager may only move the clients
 * they added — 2026-10-11 — and a short list used to give them sort orders 0..n that collided with
 * everyone else's). Unknown ids and repeats are ignored. A full list comes back exactly as sent.
 */
export function mergeIntoFullOrder(fullIds: string[], movedIds: string[]): string[] {
  const known = new Set(fullIds);
  const moved = [...new Set(movedIds.filter(id => known.has(id)))];
  const movedSet = new Set(moved);
  const result = [...fullIds];
  let next = 0;
  fullIds.forEach((id, slot) => { if (movedSet.has(id)) result[slot] = moved[next++]; });
  return result;
}

class ProjectGroupService {
  async getGroups(): Promise<ProjectGroup[]> {
    return projectGroupRepository.findAll();
  }

  async getGroup(id: string): Promise<ProjectGroup | null> {
    return projectGroupRepository.findById(id);
  }

  async createGroup(data: { name: string; color?: string; icon?: string }, userId: string): Promise<ProjectGroup> {
    const existing = await projectGroupRepository.findByName(data.name);
    if (existing) throw new Error('A group with this name already exists');
    return projectGroupRepository.create({ ...data, createdBy: userId });
  }

  async updateGroup(id: string, data: { name?: string; color?: string; icon?: string }): Promise<ProjectGroup> {
    const group = await projectGroupRepository.findById(id);
    if (!group) throw new Error('Group not found');
    if (data.name && data.name !== group.name) {
      const dup = await projectGroupRepository.findByName(data.name);
      if (dup) throw new Error('A group with this name already exists');
    }
    return projectGroupRepository.update(id, data);
  }

  async deleteGroup(id: string): Promise<void> {
    const group = await projectGroupRepository.findById(id);
    if (!group) throw new Error('Group not found');
    // its projects lose their client: drop them from the project cache too
    // its people would be left in no pool (U8): refuse while it has any; its rate card goes with it
    const [{ n }] = await databaseService.query<{ n: number }>('SELECT COUNT(*) AS n FROM resources WHERE client_id = ?', [id]);
    if (Number(n) > 0) throw new ClientHasPeopleError(Number(n));
    const affected = await databaseService.query<{ id: string }>('SELECT id FROM projects WHERE group_id = ?', [id]);
    const before = await Promise.all(affected.map(p => this.calendarBefore(p.id)));
    await projectGroupRepository.delete(id);
    await databaseService.query('DELETE FROM rate_card WHERE pool_id = ?', [id]);
    // its projects go back to the home calendar: re-fit dates where the holidays differ
    // eslint-disable-next-line no-await-in-loop -- deleting a client is rare; each project re-fits on its own, one after another
    for (const [i, p] of affected.entries()) await this.refitForCalendar(p.id, before[i]);
    await Promise.all(affected.map(p => projectService.invalidateCache(p.id)));
  }

  async reorderGroups(orderedIds: string[]): Promise<void> {
    return projectGroupRepository.reorder(orderedIds);
  }

  async assignProject(projectId: string, groupId: string): Promise<void> {
    const group = await projectGroupRepository.findById(groupId);
    if (!group) throw new Error('Group not found');
    // a project save sends its client every time: nothing to do when it hasn't changed
    const [current] = await databaseService.query<{ group_id: string | null }>('SELECT group_id FROM projects WHERE id = ?', [projectId]);
    if (current?.group_id === groupId) return;
    const before = await this.calendarBefore(projectId);
    await projectGroupRepository.assignProject(projectId, groupId);
    await this.refitForCalendar(projectId, before);
    await projectTeamService.dropOutsidePool(projectId);
    // the project is cached for 5 minutes: drop it so its client shows at once (2026-10-07)
    await projectService.invalidateCache(projectId);
  }

  /** A project's working calendar before it changes client (each client has its own holidays, U8) */
  private async calendarBefore(projectId: string) {
    const { calendarService } = await import('./CalendarService');
    return calendarService.calendarSpec(projectId);
  }

  /** After a client change: re-fit the dates if the new client's holidays differ */
  private async refitForCalendar(projectId: string, before: Awaited<ReturnType<ProjectGroupService['calendarBefore']>>) {
    const { workingCalendarService } = await import('./WorkingCalendarService');
    await workingCalendarService.refitAfterClientMove(projectId, before);
  }

  async unassignProject(projectId: string): Promise<void> {
    const [current] = await databaseService.query<{ group_id: string | null }>('SELECT group_id FROM projects WHERE id = ?', [projectId]);
    if (current && current.group_id === null) return;
    const before = await this.calendarBefore(projectId);
    await projectGroupRepository.unassignProject(projectId);
    await this.refitForCalendar(projectId, before);
    await projectTeamService.dropOutsidePool(projectId);
    await projectService.invalidateCache(projectId);
  }
}

export const projectGroupService = new ProjectGroupService();
