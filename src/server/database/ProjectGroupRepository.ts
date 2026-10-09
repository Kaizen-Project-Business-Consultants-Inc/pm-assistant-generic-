import { v4 as uuidv4 } from 'uuid';
import { databaseService } from './connection';
import { chunksOf } from '../utils/chunksOf';

export interface ProjectGroup {
  id: string;
  name: string;
  color: string;
  icon: string | null;
  sortOrder: number;
  createdBy: string;
  createdAt: string;
  updatedAt: string;
}

function mapRow(row: any): ProjectGroup {
  return {
    id: row.id,
    name: row.name,
    color: row.color,
    icon: row.icon,
    sortOrder: row.sort_order,
    createdBy: row.created_by,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

class ProjectGroupRepository {
  async findAll(): Promise<ProjectGroup[]> {
    const rows = await databaseService.query<any>(
      'SELECT * FROM project_groups ORDER BY sort_order ASC, name ASC',
    );
    return rows.map(mapRow);
  }

  async findById(id: string): Promise<ProjectGroup | null> {
    const rows = await databaseService.query<any>(
      'SELECT * FROM project_groups WHERE id = ?',
      [id],
    );
    return rows.length > 0 ? mapRow(rows[0]) : null;
  }

  async findByName(name: string): Promise<ProjectGroup | null> {
    const rows = await databaseService.query<any>(
      'SELECT * FROM project_groups WHERE name = ?',
      [name],
    );
    return rows.length > 0 ? mapRow(rows[0]) : null;
  }

  async create(data: { name: string; color?: string; icon?: string; createdBy: string }): Promise<ProjectGroup> {
    const id = uuidv4();
    const maxOrder = await databaseService.query<any>(
      'SELECT COALESCE(MAX(sort_order), -1) AS mx FROM project_groups',
    );
    const sortOrder = (maxOrder[0]?.mx ?? -1) + 1;

    await databaseService.query(
      `INSERT INTO project_groups (id, name, color, icon, sort_order, created_by)
       VALUES (?, ?, ?, ?, ?, ?)`,
      [id, data.name, data.color || '#6366f1', data.icon || null, sortOrder, data.createdBy],
    );
    return (await this.findById(id))!;
  }

  async update(id: string, data: { name?: string; color?: string; icon?: string }): Promise<ProjectGroup> {
    const sets: string[] = [];
    const params: any[] = [];
    if (data.name !== undefined) { sets.push('name = ?'); params.push(data.name); }
    if (data.color !== undefined) { sets.push('color = ?'); params.push(data.color); }
    if (data.icon !== undefined) { sets.push('icon = ?'); params.push(data.icon); }
    if (sets.length === 0) return (await this.findById(id))!;

    params.push(id);
    await databaseService.query(
      `UPDATE project_groups SET ${sets.join(', ')} WHERE id = ?`,
      params,
    );
    return (await this.findById(id))!;
  }

  async delete(id: string): Promise<void> {
    // Unset group_id on assigned projects
    await databaseService.query(
      'UPDATE projects SET group_id = NULL WHERE group_id = ?',
      [id],
    );
    await databaseService.query(
      'DELETE FROM project_groups WHERE id = ?',
      [id],
    );
  }

  /**
   * Each group's position in the list: one `CASE id` UPDATE per 200 groups, not one per group
   * (2026-10-09). An id listed twice keeps its last position, as the one-row updates left it.
   */
  async reorder(orderedIds: string[]): Promise<void> {
    const position = new Map(orderedIds.map((id, i) => [id, i]));
    for (const chunk of chunksOf([...position], 200)) {
      // eslint-disable-next-line no-await-in-loop -- one statement per 200 groups
      await databaseService.query(
        `UPDATE project_groups SET sort_order = CASE id ${chunk.map(() => 'WHEN ? THEN ?').join(' ')} END
          WHERE id IN (${chunk.map(() => '?').join(',')})`,
        [...chunk.flat(), ...chunk.map(([id]) => id)],
      );
    }
  }

  async assignProject(projectId: string, groupId: string): Promise<void> {
    await databaseService.query(
      'UPDATE projects SET group_id = ? WHERE id = ?',
      [groupId, projectId],
    );
  }

  async unassignProject(projectId: string): Promise<void> {
    await databaseService.query(
      'UPDATE projects SET group_id = NULL WHERE id = ?',
      [projectId],
    );
  }
}

export const projectGroupRepository = new ProjectGroupRepository();
