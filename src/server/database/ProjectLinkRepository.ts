import { BaseRepository } from './BaseRepository';
import { randomUUID } from 'crypto';

export interface ProjectLink {
  id: string;
  projectId: string;
  label: string;
  url: string;
  icon: string | null;
  sortOrder: number;
  createdBy: string;
  createdAt: string;
  updatedAt: string;
}

function mapRow(row: any): ProjectLink {
  return {
    id: row.id,
    projectId: row.project_id,
    label: row.label,
    url: row.url,
    icon: row.icon || null,
    sortOrder: row.sort_order ?? 0,
    createdBy: row.created_by,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

class ProjectLinkRepository extends BaseRepository<ProjectLink> {
  constructor() {
    super('project_links', mapRow);
  }

  async findByProject(projectId: string): Promise<ProjectLink[]> {
    const rows = await this.queryRaw(
      'SELECT * FROM project_links WHERE project_id = ? ORDER BY sort_order ASC, created_at ASC',
      [projectId],
    );
    return rows.map(mapRow);
  }

  async create(data: { projectId: string; label: string; url: string; icon?: string; createdBy: string }): Promise<ProjectLink> {
    const id = randomUUID();
    // Get next sort order
    const maxRows = await this.queryRaw(
      'SELECT COALESCE(MAX(sort_order), -1) + 1 AS next_order FROM project_links WHERE project_id = ?',
      [data.projectId],
    );
    const sortOrder = Number(maxRows[0]?.next_order ?? 0);

    await this.queryRaw(
      'INSERT INTO project_links (id, project_id, label, url, icon, sort_order, created_by) VALUES (?, ?, ?, ?, ?, ?, ?)',
      [id, data.projectId, data.label, data.url, data.icon || null, sortOrder, data.createdBy],
    );
    return (await this.findById(id))!;
  }

  async update(id: string, projectId: string, data: { label?: string; url?: string; icon?: string | null }): Promise<ProjectLink | null> {
    const existing = await this.findById(id);
    if (!existing || existing.projectId !== projectId) return null;

    const fields: string[] = [];
    const values: any[] = [];
    if (data.label !== undefined) { fields.push('label = ?'); values.push(data.label); }
    if (data.url !== undefined) { fields.push('url = ?'); values.push(data.url); }
    if (data.icon !== undefined) { fields.push('icon = ?'); values.push(data.icon); }

    if (fields.length === 0) return existing;

    values.push(id, projectId);
    await this.queryRaw(
      `UPDATE project_links SET ${fields.join(', ')} WHERE id = ? AND project_id = ?`,
      values,
    );
    return (await this.findById(id))!;
  }

  async remove(id: string, projectId: string): Promise<boolean> {
    return this.deleteById(id, { column: 'project_id', value: projectId });
  }

  async reorder(projectId: string, orderedIds: string[]): Promise<void> {
    for (let i = 0; i < orderedIds.length; i++) {
      await this.queryRaw(
        'UPDATE project_links SET sort_order = ? WHERE id = ? AND project_id = ?',
        [i, orderedIds[i], projectId],
      );
    }
  }
}

export const projectLinkRepository = new ProjectLinkRepository();
