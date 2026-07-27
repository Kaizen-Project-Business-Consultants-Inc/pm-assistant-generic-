import { databaseService } from './connection';

export interface PortalLink {
  id: string;
  projectId: string;
  token: string;
  label: string | null;
  permissions: Record<string, boolean>;
  expiresAt: string | null;
  isActive: boolean;
  createdBy: string;
  createdAt: string;
}

export interface PortalComment {
  id: string;
  portalLinkId: string;
  projectId: string;
  entityType: string;
  entityId: string;
  authorName: string;
  content: string;
  createdAt: string;
}

function parsePerms(val: any): Record<string, boolean> {
  if (!val) return {};
  try { return typeof val === 'string' ? JSON.parse(val) : val; } catch { return {}; }
}

function linkRowToDTO(row: any): PortalLink {
  return {
    id: row.id, projectId: row.project_id, token: row.token,
    label: row.label, permissions: parsePerms(row.permissions),
    expiresAt: row.expires_at, isActive: !!row.is_active,
    createdBy: row.created_by, createdAt: row.created_at,
  };
}

function commentRowToDTO(row: any): PortalComment {
  return {
    id: row.id, portalLinkId: row.portal_link_id, projectId: row.project_id,
    entityType: row.entity_type, entityId: row.entity_id,
    authorName: row.author_name, content: row.content, createdAt: row.created_at,
  };
}

class PortalRepository {
  async insertLink(
    id: string, projectId: string, token: string, label: string | null,
    permissions: Record<string, boolean>, expiresAt: string | null, createdBy: string,
  ): Promise<PortalLink> {
    await databaseService.query(
      `INSERT INTO portal_links (id, project_id, token, label, permissions, expires_at, is_active, created_by)
       VALUES (?, ?, ?, ?, ?, ?, TRUE, ?)`,
      [id, projectId, token, label, JSON.stringify(permissions), expiresAt, createdBy],
    );
    const rows = await databaseService.query('SELECT * FROM portal_links WHERE id = ?', [id]);
    return linkRowToDTO(rows[0]);
  }

  async findLinksByProject(projectId: string): Promise<PortalLink[]> {
    const rows = await databaseService.query(
      'SELECT * FROM portal_links WHERE project_id = ? ORDER BY created_at DESC',
      [projectId],
    );
    return rows.map(linkRowToDTO);
  }

  async findLinkById(id: string): Promise<PortalLink | null> {
    const rows = await databaseService.query('SELECT * FROM portal_links WHERE id = ?', [id]);
    return rows.length > 0 ? linkRowToDTO(rows[0]) : null;
  }

  async updateLink(id: string, sets: string[], params: any[]): Promise<void> {
    if (sets.length === 0) return;
    await databaseService.query(`UPDATE portal_links SET ${sets.join(', ')} WHERE id = ?`, [...params, id]);
  }

  async deactivateLink(id: string): Promise<void> {
    await databaseService.query('UPDATE portal_links SET is_active = FALSE WHERE id = ?', [id]);
  }

  async deleteLink(id: string): Promise<void> {
    await databaseService.query('DELETE FROM portal_links WHERE id = ?', [id]);
  }

  async validateToken(token: string): Promise<(PortalLink & { projectName: string; projectStatus: string }) | null> {
    const rows = await databaseService.query(
      `SELECT pl.*, p.name AS project_name, p.status AS project_status
       FROM portal_links pl
       JOIN projects p ON p.id = pl.project_id
       WHERE pl.token = ? AND pl.is_active = TRUE AND (pl.expires_at IS NULL OR pl.expires_at > NOW())`,
      [token],
    );
    if (rows.length === 0) return null;
    const row = rows[0];
    return { ...linkRowToDTO(row), projectName: row.project_name, projectStatus: row.project_status };
  }

  async getProjectInfo(projectId: string): Promise<{
    id: string; name: string; status: string; description: string | null;
    budget_allocated: number; budget_spent: number;
    start_date: string | null; end_date: string | null;
    updated_at: string | null;
  } | null> {
    const rows = await databaseService.query(
      `SELECT id, name, status, description,
              COALESCE(budget_allocated, 0) as budget_allocated,
              COALESCE(budget_spent, 0) as budget_spent,
              start_date, end_date, updated_at
       FROM projects WHERE id = ?`,
      [projectId],
    );
    return rows.length > 0 ? rows[0] : null;
  }

  async getMilestones(projectId: string): Promise<{ id: string; name: string; status: string; endDate: string | null }[]> {
    const rows = await databaseService.query(
      `SELECT t.id, t.name, t.status, t.end_date
       FROM tasks t
       JOIN schedules s ON s.id = t.schedule_id
       WHERE s.project_id = ? AND t.is_milestone = TRUE
       ORDER BY t.end_date ASC, t.name ASC`,
      [projectId],
    );
    return rows.map((r: any) => ({ id: r.id, name: r.name, status: r.status, endDate: r.end_date }));
  }

  async getRecentCompletions(projectId: string, limit = 10): Promise<{ id: string; name: string; completedAt: string }[]> {
    const rows = await databaseService.query(
      `SELECT t.id, t.name, t.updated_at as completed_at
       FROM tasks t
       JOIN schedules s ON s.id = t.schedule_id
       WHERE s.project_id = ? AND t.status IN ('completed', 'done')
       ORDER BY t.updated_at DESC
       LIMIT ?`,
      [projectId, limit],
    );
    return rows.map((r: any) => ({ id: r.id, name: r.name, completedAt: r.completed_at }));
  }

  async getTaskStats(projectId: string): Promise<{ status: string; count: number }[]> {
    return databaseService.query(
      `SELECT st.status, COUNT(*) as count
       FROM tasks st
       JOIN schedules s ON s.id = st.schedule_id
       WHERE s.project_id = ?
       GROUP BY st.status`,
      [projectId],
    );
  }

  async getTimeline(projectId: string): Promise<{ min_start: string | null; max_end: string | null }> {
    const rows = await databaseService.query(
      `SELECT MIN(st.start_date) as min_start, MAX(st.end_date) as max_end
       FROM tasks st
       JOIN schedules s ON s.id = st.schedule_id
       WHERE s.project_id = ?`,
      [projectId],
    );
    return rows[0] || { min_start: null, max_end: null };
  }

  async insertComment(
    id: string, portalLinkId: string, projectId: string,
    entityType: string, entityId: string, authorName: string, content: string,
  ): Promise<PortalComment> {
    await databaseService.query(
      `INSERT INTO portal_comments (id, portal_link_id, project_id, entity_type, entity_id, author_name, content)
       VALUES (?, ?, ?, ?, ?, ?, ?)`,
      [id, portalLinkId, projectId, entityType, entityId, authorName, content],
    );
    const rows = await databaseService.query('SELECT * FROM portal_comments WHERE id = ?', [id]);
    return commentRowToDTO(rows[0]);
  }

  async findComments(projectId: string, entityType?: string, entityId?: string, limit = 100): Promise<PortalComment[]> {
    let sql = 'SELECT * FROM portal_comments WHERE project_id = ?';
    const params: any[] = [projectId];
    if (entityType) { sql += ' AND entity_type = ?'; params.push(entityType); }
    if (entityId) { sql += ' AND entity_id = ?'; params.push(entityId); }
    sql += ' ORDER BY created_at DESC LIMIT ?';
    params.push(limit);
    const rows = await databaseService.query(sql, params);
    return rows.map(commentRowToDTO);
  }

  async findCommentsByLink(portalLinkId: string, limit = 100): Promise<PortalComment[]> {
    const rows = await databaseService.query(
      'SELECT * FROM portal_comments WHERE portal_link_id = ? ORDER BY created_at DESC LIMIT ?',
      [portalLinkId, limit],
    );
    return rows.map(commentRowToDTO);
  }
}

export const portalRepository = new PortalRepository();
