import { projectCoverRepository, ProjectCover } from '../database/ProjectCoverRepository';
import { organizationTimezone } from './StatusDateService';
import { today } from '../utils/calendarDate';

/**
 * Who covers which project TODAY — the one place the permission checks ask. Kept apart from
 * ProjectCoverService (emails, audit) so middleware/requireProjectAccess.ts stays light. Rights
 * come from these rows at request time, so an end date takes effect without any job having run.
 */
export async function coverToday(): Promise<string> {
  return today(await organizationTimezone());
}

export async function activeCoverFor(projectId: string, userId: string): Promise<ProjectCover | undefined> {
  return projectCoverRepository.findActiveFor(projectId, userId, await coverToday());
}

export async function activeCoverProjectIds(userId: string): Promise<string[]> {
  return projectCoverRepository.findActiveProjectIdsFor(userId, await coverToday());
}
