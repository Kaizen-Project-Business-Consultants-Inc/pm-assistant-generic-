import { v4 as uuidv4 } from 'uuid';
import { BaseRepository } from './BaseRepository';
import type { Project, CreateProjectData } from '../services/ProjectService';
import { isDuplicateCodeDbError } from '../utils/duplicateProject';
import { forgetReadableProjects } from '../middleware/requestContext';

function toDateStr(val: any): string | undefined {
  if (!val) return undefined;
  if (val instanceof Date) return val.toISOString().slice(0, 10);
  return String(val).slice(0, 10);
}

function rowToProject(row: any): Project {
  return {
    id: row.id,
    name: row.name,
    description: row.description ?? undefined,
    category: row.category ?? undefined,
    projectType: row.project_type,
    methodology: row.methodology || 'waterfall',
    status: row.status,
    priority: row.priority,
    budgetAllocated: row.budget_allocated != null ? Number(row.budget_allocated) : undefined,
    // Total spent = labour from approved timesheets + other costs (typed in) — T072
    budgetSpent: Number(row.budget_spent),
    labourCost: row.labour_cost != null ? Number(row.labour_cost) : 0,
    otherCosts: row.other_costs != null ? Number(row.other_costs) : Number(row.budget_spent ?? 0),
    currency: row.currency,
    location: row.location ?? undefined,
    locationLat: row.location_lat != null ? Number(row.location_lat) : undefined,
    locationLon: row.location_lon != null ? Number(row.location_lon) : undefined,
    startDate: row.start_date ? String(row.start_date) : undefined,
    endDate: row.end_date ? String(row.end_date) : undefined,
    // The day progress is measured "as at" — see services/StatusDateService.ts.
    statusDate: row.status_date ? String(row.status_date).slice(0, 10) : undefined,
    projectManagerId: row.project_manager_id ?? undefined,
    createdBy: row.created_by,
    createdAt: String(row.created_at),
    updatedAt: String(row.updated_at),
    archivedAt: row.archived_at ? String(row.archived_at) : undefined,
    groupId: row.group_id ?? undefined,
    isDemo: row.is_demo === 1 || row.is_demo === true,
    projectCode: row.project_code ?? undefined,
  };
}

const PROJECT_COLUMN_MAP: Record<string, string> = {
  name: 'name',
  description: 'description',
  category: 'category',
  projectType: 'project_type',
  methodology: 'methodology',
  status: 'status',
  priority: 'priority',
  budgetAllocated: 'budget_allocated',
  budgetSpent: 'budget_spent',
  otherCosts: 'other_costs',
  currency: 'currency',
  location: 'location',
  locationLat: 'location_lat',
  locationLon: 'location_lon',
  startDate: 'start_date',
  endDate: 'end_date',
  statusDate: 'status_date',
  projectManagerId: 'project_manager_id',
};

export class ProjectRepository extends BaseRepository<Project> {
  constructor() {
    super('projects', rowToProject);
  }

  async findByIds(ids: string[]): Promise<Project[]> {
    if (ids.length === 0) return [];
    const placeholders = ids.map(() => '?').join(',');
    const rows = await this.queryRaw(`SELECT * FROM projects WHERE id IN (${placeholders})`, ids);
    return this.mapRows(rows);
  }

  async findByIdForUser(id: string, userId: string): Promise<Project | null> {
    const rows = await this.queryRaw(
      `SELECT DISTINCT p.* FROM projects p
       LEFT JOIN project_members pm ON pm.project_id = p.id AND pm.user_id = ?
       WHERE p.id = ? AND (p.created_by = ? OR pm.user_id IS NOT NULL OR p.is_demo = 1)`,
      [userId, id, userId],
    );
    return rows.length > 0 ? rowToProject(rows[0]) : null;
  }

  /**
   * Of these projects, the live (not archived, not the sample) ones this person manages: an
   * Owner/Manager membership, or the creator when they have no membership row — the same rule
   * as checkProjectRoleFor(…, 'manager'), in one query (the Team Planner checked one project at
   * a time — 2026-10-04 audit).
   */
  async findManagedIds(userId: string, projectIds: string[]): Promise<string[]> {
    if (projectIds.length === 0) return [];
    const rows = await this.queryRaw(
      `SELECT p.id FROM projects p
         LEFT JOIN project_members m ON m.project_id = p.id AND m.user_id = ?
        WHERE p.id IN (${projectIds.map(() => '?').join(',')}) AND p.archived_at IS NULL AND COALESCE(p.is_demo, 0) = 0
          AND (m.role IN ('owner', 'manager') OR (m.user_id IS NULL AND p.created_by = ?))`,
      [userId, ...projectIds, userId],
    );
    return rows.map((r: any) => r.id);
  }

  async findAllPaginated(limit: number, offset: number, includeArchived = false): Promise<{ rows: Project[]; total: number }> {
    const where = includeArchived ? '1=1' : 'archived_at IS NULL';
    return this.queryPaginated(where, [], 'created_at DESC', limit, offset);
  }

  /**
   * The projects a person can read: ones they created, are a member of, or the sample — as three
   * lookups that each use an index (the old `created_by = ? OR member OR is_demo` could use none,
   * so every call read the whole projects table; 2026-10-08). Two placeholders: the user id twice.
   * Callers join it FIRST (STRAIGHT_JOIN): the short list, then one key lookup per project.
   */
  private static readonly READABLE = `SELECT id FROM projects WHERE created_by = ?
       UNION SELECT project_id FROM project_members WHERE user_id = ?
       UNION SELECT id FROM projects WHERE is_demo = 1`;

  /** Only the ids — for permission checks across projects (readableProjectIds) */
  async findReadableIds(userId: string): Promise<string[]> {
    const rows: Array<{ id: string }> = await this.queryRaw(ProjectRepository.READABLE, [userId, userId]);
    return rows.map(r => r.id);
  }

  async findByUserId(userId: string): Promise<Project[]> {
    const rows = await this.queryRaw(
      `SELECT STRAIGHT_JOIN p.* FROM (${ProjectRepository.READABLE}) r
       JOIN projects p ON p.id = r.id
       ORDER BY p.is_demo ASC, p.created_at DESC`,
      [userId, userId],
    );
    return this.mapRows(rows);
  }

  /** Live projects this person has (trial limit) — the sample project never counts */
  async countByUser(userId: string): Promise<number> {
    const rows = await this.queryRaw(
      `SELECT STRAIGHT_JOIN COUNT(*) as count FROM (${ProjectRepository.READABLE}) r
       JOIN projects p ON p.id = r.id
       WHERE p.archived_at IS NULL AND COALESCE(p.is_demo, 0) = 0`,
      [userId, userId],
    );
    return Number(rows[0]?.count ?? 0);
  }

  async findByUserIdPaginated(userId: string, limit: number, offset: number, includeArchived = false): Promise<{ rows: Project[]; total: number }> {
    const archiveFilter = includeArchived ? '' : ' AND p.archived_at IS NULL';
    const countRows = await this.queryRaw(
      `SELECT STRAIGHT_JOIN COUNT(*) as count FROM (${ProjectRepository.READABLE}) r
       JOIN projects p ON p.id = r.id
       WHERE 1 = 1${archiveFilter}`,
      [userId, userId],
    );
    const total = Number(countRows[0]?.count ?? 0);
    const rows = await this.queryRaw(
      `SELECT STRAIGHT_JOIN p.* FROM (${ProjectRepository.READABLE}) r
       JOIN projects p ON p.id = r.id
       WHERE 1 = 1${archiveFilter}
       ORDER BY p.is_demo ASC, p.created_at DESC
       LIMIT ? OFFSET ?`,
      [userId, userId, limit, offset],
    );
    return { rows: this.mapRows(rows), total };
  }

  async create(data: CreateProjectData): Promise<Project> {
    // The code is the next PRJ-n; two projects created at the same moment can pick the same one,
    // so a code clash just takes the next number (2026-10-07: it surfaced as "code already in use")
    for (let attempt = 1; ; attempt++) {
      try {
        // eslint-disable-next-line no-await-in-loop -- retry loop: on a project-code clash, try again with the next code (at most 5 attempts)
        return await this.insertProject(data, await this.generateProjectCode());
      } catch (err) {
        if (!isDuplicateCodeDbError(err) || attempt >= 5) throw err;
      }
    }
  }

  /** The live (not archived) project with this name, if any */
  async findLiveIdByName(name: string): Promise<string | null> {
    const rows = await this.queryRaw('SELECT id FROM projects WHERE live_name = ? LIMIT 1', [name]);
    return rows[0]?.id ?? null;
  }

  private async insertProject(data: CreateProjectData, projectCode: string): Promise<Project> {
    const id = uuidv4();
    await this.queryRaw(
      `INSERT INTO projects (id, name, project_code, description, category, project_type, methodology, status, priority,
        budget_allocated, budget_spent, currency, location, location_lat, location_lon,
        start_date, end_date, created_by)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        id,
        data.name,
        projectCode,
        data.description || null,
        data.category || null,
        data.projectType || 'other',
        // Was missing from this INSERT entirely — every new project's methodology
        // column was left NULL, and rowToProject's `row.methodology || 'waterfall'`
        // fallback silently papered over it, so a project created as 'hybrid' read
        // back as 'waterfall'. Not the same bug as the update-time Zod-defaults
        // issue (that one only affects PUT, this one is CREATE-only).
        data.methodology || 'waterfall',
        data.status || 'planning',
        data.priority || 'medium',
        data.budgetAllocated ?? null,
        0,
        data.currency || 'USD',
        data.location || null,
        data.locationLat ?? null,
        data.locationLon ?? null,
        toDateStr(data.startDate) || null,
        toDateStr(data.endDate) || null,
        data.userId,
      ],
    );
    forgetReadableProjects(); // saved: its creator can read it from now on
    return (await this.findById(id))!;
  }

  private async generateProjectCode(): Promise<string> {
    const rows = await this.queryRaw(
      `SELECT project_code FROM projects WHERE project_code LIKE 'PRJ-%' ORDER BY CAST(SUBSTRING(project_code, 5) AS UNSIGNED) DESC LIMIT 1`,
      [],
    );
    const lastNum = rows.length > 0 ? parseInt(rows[0].project_code.replace('PRJ-', ''), 10) : 0;
    return `PRJ-${String(lastNum + 1).padStart(3, '0')}`;
  }

  async update(id: string, data: Record<string, any>): Promise<Project | null> {
    const result = this.buildUpdate(data, PROJECT_COLUMN_MAP, (key, val) => {
      if ((key === 'startDate' || key === 'endDate' || key === 'statusDate') && val) {
        return toDateStr(val);
      }
      return val;
    });
    if (!result) return null;

    result.values.push(id);
    await this.queryRaw(result.sql, result.values);
    return (await this.findById(id))!;
  }

  async archiveProject(id: string): Promise<boolean> {
    const rows = await this.queryRaw(
      'UPDATE projects SET archived_at = NOW() WHERE id = ? AND archived_at IS NULL',
      [id],
    );
    return (rows as any)?.affectedRows > 0;
  }

  async unarchiveProject(id: string): Promise<boolean> {
    const rows = await this.queryRaw(
      'UPDATE projects SET archived_at = NULL WHERE id = ? AND archived_at IS NOT NULL',
      [id],
    );
    return (rows as any)?.affectedRows > 0;
  }

  async findByName(name: string): Promise<Project | null> {
    const rows = await this.queryRaw(
      // the column's collation is case-insensitive already; LOWER() stopped the index being used
      'SELECT * FROM projects WHERE name = ? LIMIT 1',
      [name],
    );
    return rows.length > 0 ? rowToProject(rows[0]) : null;
  }

  async deleteForUser(id: string, userId: string): Promise<boolean> {
    return this.deleteById(id, { column: 'created_by', value: userId });
  }
}

export const projectRepository = new ProjectRepository();
