import { projectCoverRepository, ProjectCover } from '../database/ProjectCoverRepository';
import { projectMemberRepository } from '../database/ProjectMemberRepository';
import { databaseService } from '../database/connection';
import { projectService } from './ProjectService';
import { userService } from './UserService';
import { notificationService } from './NotificationService';
import { emailService } from './EmailService';
import { auditLedgerService } from './AuditLedgerService';
import { isCompanyLogin } from './peopleRights';
import { coverToday } from './projectCoverAccess';
import { daysBetween } from '../utils/calendarDate';
import { getActorSource } from '../middleware/requestContext';
import { config } from '../config';
import logger from '../utils/logger';

/** Longest single cover (a longer absence is a hand-over: reassign the project instead) */
export const MAX_COVER_DAYS = 90;
const DATE = /^\d{4}-\d{2}-\d{2}$/;

export class CoverError extends Error {
  constructor(public status: number, public code: string, message: string) { super(message); }
}

type Actor = { userId: string };

function niceDate(ymd: string): string {
  const [y, m, d] = ymd.split('-').map(Number);
  return new Date(Date.UTC(y, m - 1, d)).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric', timeZone: 'UTC' });
}

/** The Owner(s) of a project: members with the Owner role, or the creator of a project that has none */
async function ownersOf(projectId: string): Promise<string[]> {
  const members = await projectMemberRepository.findByProjectId(projectId);
  const owners = members.filter(m => m.role === 'owner').map(m => m.userId);
  if (owners.length > 0) return owners;
  const project = await projectService.findById(projectId);
  return project?.createdBy ? [project.createdBy] : [];
}

/** Is this person the line manager of one of the project's Owners (resources.line_manager_user_id, T070)? */
export async function isLineManagerOfOwner(projectId: string, userId: string): Promise<boolean> {
  const owners = await ownersOf(projectId);
  if (owners.length === 0) return false;
  const rows = await databaseService.query<{ n: number }>(
    `SELECT COUNT(*) AS n FROM resources WHERE user_id IN (${owners.map(() => '?').join(',')}) AND line_manager_user_id = ?`,
    [...owners, userId],
  );
  return Number(rows[0]?.n ?? 0) > 0;
}

async function tell(userId: string, email: string | undefined, projectId: string, title: string, message: string): Promise<void> {
  await notificationService.create({ userId, type: 'project_cover', severity: 'medium', title, message, projectId, linkType: 'project', linkId: projectId })
    .catch(err => logger.error('project_cover notification error', { error: err }));
  if (email) {
    await emailService.sendNotificationEmail(email, title, title, message, `${config.APP_URL}/project/${projectId}?tab=team`, 'Open project')
      .catch(err => logger.error('project_cover email error', { error: err }));
  }
}

async function audit(actorId: string, action: string, cover: ProjectCover, extra: Record<string, unknown> = {}): Promise<void> {
  await auditLedgerService.append({
    actorId, actorType: actorId === 'system' ? 'system' : 'user', action, entityType: 'project', entityId: cover.projectId, projectId: cover.projectId,
    payload: { coverId: cover.id, ownerUserId: cover.ownerUserId, coverUserId: cover.coverUserId, startDate: cover.startDate, endDate: cover.endDate, ...extra },
    source: actorId === 'system' ? 'system' : getActorSource(),
  }).catch(err => logger.error('project_cover audit error', { error: err }));
}

class ProjectCoverService {
  /** The current or next cover on a project, for the Team tab and the project banner */
  async current(projectId: string): Promise<(ProjectCover & { active: boolean }) | null> {
    const asOf = await coverToday();
    const cover = await projectCoverRepository.findCurrentOrUpcoming(projectId, asOf);
    return cover ? { ...cover, active: cover.startDate <= asOf } : null;
  }

  async start(actor: Actor, projectId: string, input: { coverUserId: string; startDate: string; endDate: string }): Promise<ProjectCover> {
    const { coverUserId, startDate, endDate } = input;
    if (!DATE.test(startDate) || !DATE.test(endDate)) throw new CoverError(400, 'bad_dates', 'Choose a start and an end date.');
    const length = daysBetween(startDate, endDate);
    if (length === null || length < 0) throw new CoverError(400, 'bad_dates', 'The end date must be on or after the start date.');
    if (length + 1 > MAX_COVER_DAYS) throw new CoverError(400, 'too_long', `Cover can last up to ${MAX_COVER_DAYS} days. For a longer absence, hand the project to a new Owner instead.`);
    const asOf = await coverToday();
    if (endDate < asOf) throw new CoverError(400, 'bad_dates', 'The end date is already past.');

    const project = await projectService.findById(projectId);
    if (!project) throw new CoverError(404, 'not_found', 'Project not found.');
    const owners = await ownersOf(projectId);
    if (owners.includes(coverUserId)) throw new CoverError(400, 'cover_is_owner', 'The Owner cannot cover for themselves.');
    if (!(await isCompanyLogin(coverUserId))) throw new CoverError(400, 'not_in_company', 'Choose someone from your company.');
    const person = await userService.findById(coverUserId);
    if (!person || !person.isActive || person.isGuest) throw new CoverError(400, 'not_in_company', 'That person cannot sign in, so they cannot cover.');
    if (await projectCoverRepository.findOverlapping(projectId, startDate, endDate, asOf)) {
      throw new CoverError(409, 'overlap', 'This project already has cover in those dates. End it first, or choose other dates.');
    }

    const ownerUserId = owners.includes(actor.userId) ? actor.userId : (owners[0] ?? actor.userId);
    const cover = await projectCoverRepository.insert({
      projectId, ownerUserId, coverUserId, coverUserName: person.fullName || person.email, coverUserEmail: person.email,
      startDate, endDate, startedBy: actor.userId,
    });
    await audit(actor.userId, 'project.cover_started', cover);
    await projectCoverRepository.markStartNotified(cover.id);

    const owner = await userService.findById(ownerUserId).catch(() => null);
    const range = `from ${niceDate(startDate)} to ${niceDate(endDate)}`;
    const name = cover.coverUserName;
    // fire-and-forget: the people involved are told, the Owner's click is not held up
    void Promise.all([
      owner ? tell(owner.id, owner.email, projectId, `${name} is covering your project "${project.name}"`, `${name} can edit "${project.name}" ${range}. You can end cover early on the project's Team tab.`) : undefined,
      tell(coverUserId, person.email, projectId, `You are covering "${project.name}"`, `You can edit "${project.name}" ${range}${owner ? `, while ${owner.fullName || owner.email} is away` : ''}. You cannot make or remove Owners.`),
    ]);
    return cover;
  }

  async end(actor: Actor, projectId: string): Promise<boolean> {
    const asOf = await coverToday();
    const cover = await projectCoverRepository.findCurrentOrUpcoming(projectId, asOf);
    if (!cover) return false;
    await projectCoverRepository.end(cover.id, actor.userId);
    await audit(actor.userId, 'project.cover_ended', cover, { early: true });
    const project = await projectService.findById(projectId);
    const owner = await userService.findById(cover.ownerUserId).catch(() => null);
    const title = `Cover ended on "${project?.name ?? 'a project'}"`;
    void Promise.all([
      owner ? tell(owner.id, owner.email, projectId, title, `${cover.coverUserName} no longer covers the project. You are the only one who can edit it as Owner.`) : undefined,
      tell(cover.coverUserId, cover.coverUserEmail, projectId, title, 'Your cover has ended, so you can no longer edit this project.'),
    ]);
    return true;
  }

  /** The daily job, for one company: cover whose end date has passed gets marked finished and its end notice sent once */
  async finishPastCover(): Promise<number> {
    const asOf = await coverToday();
    const past = await projectCoverRepository.findEndedNeedingNotice(asOf);
    for (const cover of past) {
      // eslint-disable-next-line no-await-in-loop -- one small notice per finished cover; the batch is capped at 200 a day
      await projectCoverRepository.markFinished(cover.id);
      // eslint-disable-next-line no-await-in-loop -- same
      const project = await projectService.findById(cover.projectId);
      // eslint-disable-next-line no-await-in-loop -- same
      const owner = await userService.findById(cover.ownerUserId).catch(() => null);
      const title = `Cover ended on "${project?.name ?? 'a project'}"`;
      // eslint-disable-next-line no-await-in-loop -- same
      await audit('system', 'project.cover_ended', cover, { early: false });
      // eslint-disable-next-line no-await-in-loop -- same
      if (owner) await tell(owner.id, owner.email, cover.projectId, title, `${cover.coverUserName}'s cover ended on ${niceDate(cover.endDate)}. You are the only one who can edit the project as Owner.`);
      // eslint-disable-next-line no-await-in-loop -- same
      await tell(cover.coverUserId, cover.coverUserEmail, cover.projectId, title, 'Your cover has ended, so you can no longer edit this project.');
    }
    return past.length;
  }
}

export const projectCoverService = new ProjectCoverService();
