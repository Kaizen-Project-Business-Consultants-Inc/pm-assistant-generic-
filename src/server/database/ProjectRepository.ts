import { v4 as uuidv4 } from 'uuid';
import { BaseRepository } from './BaseRepository';
import type { Project, CreateProjectData } from '../services/ProjectService';

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
    budgetSpent: Number(row.budget_spent),
    currency: row.currency,
    location: row.location ?? undefined,
    locationLat: row.location_lat != null ? Number(row.location_lat) : undefined,
    locationLon: row.location_lon != null ? Number(row.location_lon) : undefined,
    startDate: row.start_date ? String(row.start_date) : undefined,
    endDate: row.end_date ? String(row.end_date) : undefined,
    projectManagerId: row.project_manager_id ?? undefined,
    createdBy: row.created_by,
    createdAt: String(row.created_at),
    updatedAt: String(row.updated_at),
    archivedAt: row.archived_at ? String(row.archived_at) : undefined,
    groupId: row.group_id ?? undefined,
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
  currency: 'currency',
  location: 'location',
  locationLat: 'location_lat',
  locationLon: 'location_lon',
  startDate: 'start_date',
  endDate: 'end_date',
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
       WHERE p.id = ? AND (p.created_by = ? OR pm.user_id IS NOT NULL)`,
      [userId, id, userId],
    );
    return rows.length > 0 ? rowToProject(rows[0]) : null;
  }

  async findAllPaginated(limit: number, offset: number, includeArchived = false): Promise<{ rows: Project[]; total: number }> {
    const where = includeArchived ? '1=1' : 'archived_at IS NULL';
    return this.queryPaginated(where, [], 'created_at DESC', limit, offset);
  }

  async findByUserId(userId: string): Promise<Project[]> {
    const rows = await this.queryRaw(
      `SELECT DISTINCT p.* FROM projects p
       LEFT JOIN project_members pm ON pm.project_id = p.id AND pm.user_id = ?
       WHERE p.created_by = ? OR pm.user_id IS NOT NULL
       ORDER BY p.created_at DESC`,
      [userId, userId],
    );
    return this.mapRows(rows);
  }

  async countByUser(userId: string): Promise<number> {
    const rows = await this.queryRaw(
      `SELECT COUNT(DISTINCT p.id) as count FROM projects p
       LEFT JOIN project_members pm ON pm.project_id = p.id AND pm.user_id = ?
       WHERE (p.created_by = ? OR pm.user_id IS NOT NULL) AND p.archived_at IS NULL`,
      [userId, userId],
    );
    return Number(rows[0]?.count ?? 0);
  }

  async findByUserIdPaginated(userId: string, limit: number, offset: number, includeArchived = false): Promise<{ rows: Project[]; total: number }> {
    const archiveFilter = includeArchived ? '' : ' AND p.archived_at IS NULL';
    const countRows = await this.queryRaw(
      `SELECT COUNT(DISTINCT p.id) as count FROM projects p
       LEFT JOIN project_members pm ON pm.project_id = p.id AND pm.user_id = ?
       WHERE (p.created_by = ? OR pm.user_id IS NOT NULL)${archiveFilter}`,
      [userId, userId],
    );
    const total = Number(countRows[0]?.count ?? 0);
    const rows = await this.queryRaw(
      `SELECT DISTINCT p.* FROM projects p
       LEFT JOIN project_members pm ON pm.project_id = p.id AND pm.user_id = ?
       WHERE (p.created_by = ? OR pm.user_id IS NOT NULL)${archiveFilter}
       ORDER BY p.created_at DESC
       LIMIT ? OFFSET ?`,
      [userId, userId, limit, offset],
    );
    return { rows: this.mapRows(rows), total };
  }

  async create(data: CreateProjectData): Promise<Project> {
    const id = uuidv4();
    await this.queryRaw(
      `INSERT INTO projects (id, name, description, category, project_type, status, priority,
        budget_allocated, budget_spent, currency, location, location_lat, location_lon,
        start_date, end_date, created_by)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        id,
        data.name,
        data.description || null,
        data.category || null,
        data.projectType || 'other',
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
    return (await this.findById(id))!;
  }

  async update(id: string, data: Record<string, any>): Promise<Project | null> {
    const result = this.buildUpdate(data, PROJECT_COLUMN_MAP, (key, val) => {
      if ((key === 'startDate' || key === 'endDate') && val) {
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
      'SELECT * FROM projects WHERE LOWER(name) = LOWER(?) LIMIT 1',
      [name],
    );
    return rows.length > 0 ? rowToProject(rows[0]) : null;
  }

  async deleteForUser(id: string, userId: string): Promise<boolean> {
    return this.deleteById(id, { column: 'created_by', value: userId });
  }
}

export const projectRepository = new ProjectRepository();
