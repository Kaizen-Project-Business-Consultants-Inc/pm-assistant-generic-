import { BaseRepository } from './BaseRepository';
import { v4 as uuidv4 } from 'uuid';
import { forgetReadableProjects } from '../middleware/requestContext';

export interface ProjectCover {
  id: string;
  projectId: string;
  ownerUserId: string;
  coverUserId: string;
  coverUserName: string;
  coverUserEmail: string;
  startDate: string;
  endDate: string;
  startedBy: string;
  startedAt: string;
  endedAt: string | null;
  endedBy: string | null;
  startNotifiedAt: string | null;
  endNotifiedAt: string | null;
}

function rowToCover(row: any): ProjectCover {
  return {
    id: row.id,
    projectId: row.project_id,
    ownerUserId: row.owner_user_id,
    coverUserId: row.cover_user_id,
    coverUserName: row.cover_user_name,
    coverUserEmail: row.cover_user_email,
    startDate: String(row.start_date).slice(0, 10),
    endDate: String(row.end_date).slice(0, 10),
    startedBy: row.started_by,
    startedAt: String(row.started_at),
    endedAt: row.ended_at ? String(row.ended_at) : null,
    endedBy: row.ended_by ?? null,
    startNotifiedAt: row.start_notified_at ? String(row.start_notified_at) : null,
    endNotifiedAt: row.end_notified_at ? String(row.end_notified_at) : null,
  };
}

/** Dates are calendar days ('YYYY-MM-DD'); `asOf` is today in the company's time zone (services/projectCoverAccess.ts). */
class ProjectCoverRepository extends BaseRepository<ProjectCover> {
  constructor() {
    super('project_cover', rowToCover);
  }

  /** The cover in force today on one project (at most one: startCover refuses an overlap) */
  async findActiveForProject(projectId: string, asOf: string): Promise<ProjectCover | undefined> {
    const rows = await this.queryRaw(
      `SELECT * FROM project_cover WHERE project_id = ? AND ended_at IS NULL AND start_date <= ? AND end_date >= ? LIMIT 1`,
      [projectId, asOf, asOf],
    );
    return rows.length > 0 ? rowToCover(rows[0]) : undefined;
  }

  /** Is this person covering this project today? */
  async findActiveFor(projectId: string, coverUserId: string, asOf: string): Promise<ProjectCover | undefined> {
    const rows = await this.queryRaw(
      `SELECT * FROM project_cover WHERE project_id = ? AND cover_user_id = ? AND ended_at IS NULL AND start_date <= ? AND end_date >= ? LIMIT 1`,
      [projectId, coverUserId, asOf, asOf],
    );
    return rows.length > 0 ? rowToCover(rows[0]) : undefined;
  }

  /** Every project this person covers today */
  async findActiveProjectIdsFor(coverUserId: string, asOf: string): Promise<string[]> {
    const rows = await this.queryRaw(
      `SELECT project_id FROM project_cover WHERE cover_user_id = ? AND ended_at IS NULL AND start_date <= ? AND end_date >= ?`,
      [coverUserId, asOf, asOf],
    );
    return rows.map((r: any) => r.project_id);
  }

  /** Cover not yet over that overlaps these dates (a project has one cover at a time) */
  async findOverlapping(projectId: string, startDate: string, endDate: string, asOf: string): Promise<ProjectCover | undefined> {
    const rows = await this.queryRaw(
      `SELECT * FROM project_cover WHERE project_id = ? AND ended_at IS NULL AND end_date >= ? AND start_date <= ? AND end_date >= ? LIMIT 1`,
      [projectId, startDate, endDate, asOf],
    );
    return rows.length > 0 ? rowToCover(rows[0]) : undefined;
  }

  /** The current or next cover (not ended, not yet past) — what the Team tab shows */
  async findCurrentOrUpcoming(projectId: string, asOf: string): Promise<ProjectCover | undefined> {
    const rows = await this.queryRaw(
      `SELECT * FROM project_cover WHERE project_id = ? AND ended_at IS NULL AND end_date >= ? ORDER BY start_date LIMIT 1`,
      [projectId, asOf],
    );
    return rows.length > 0 ? rowToCover(rows[0]) : undefined;
  }

  async insert(data: {
    projectId: string; ownerUserId: string; coverUserId: string; coverUserName: string; coverUserEmail: string;
    startDate: string; endDate: string; startedBy: string;
  }): Promise<ProjectCover> {
    const id = uuidv4();
    await this.queryRaw(
      `INSERT INTO project_cover (id, project_id, owner_user_id, cover_user_id, cover_user_name, cover_user_email, start_date, end_date, started_by)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [id, data.projectId, data.ownerUserId, data.coverUserId, data.coverUserName, data.coverUserEmail, data.startDate, data.endDate, data.startedBy],
    );
    forgetReadableProjects();
    return (await this.findById(id))!;
  }

  async end(id: string, endedBy: string): Promise<void> {
    await this.queryRaw(`UPDATE project_cover SET ended_at = CURRENT_TIMESTAMP, ended_by = ? WHERE id = ? AND ended_at IS NULL`, [endedBy, id]);
    forgetReadableProjects();
  }

  async markStartNotified(id: string): Promise<void> {
    await this.queryRaw(`UPDATE project_cover SET start_notified_at = CURRENT_TIMESTAMP WHERE id = ?`, [id]);
  }

  /** Cover whose end date has passed and whose end email has not gone out (the daily job) */
  async findEndedNeedingNotice(asOf: string, limit = 200): Promise<ProjectCover[]> {
    const rows = await this.queryRaw(
      `SELECT * FROM project_cover WHERE end_notified_at IS NULL AND ended_at IS NULL AND end_date < ? LIMIT ?`,
      [asOf, limit],
    );
    return rows.map(rowToCover);
  }

  /** Marks a past cover finished (ended_at) and its end email sent */
  async markFinished(id: string): Promise<void> {
    await this.queryRaw(`UPDATE project_cover SET ended_at = CURRENT_TIMESTAMP, end_notified_at = CURRENT_TIMESTAMP WHERE id = ? AND ended_at IS NULL`, [id]);
  }
}

export const projectCoverRepository = new ProjectCoverRepository();
