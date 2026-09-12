import { databaseService } from './connection';
import { v4 as uuidv4 } from 'uuid';

export interface MarketplaceAutomation {
  id: string;
  name: string;
  description: string | null;
  category: string | null;
  tags: string[] | null;
  triggerEventType: string;
  scope: string;
  definition: any;
  maxRunsPerDay: number;
  cooldownSeconds: number;
  publishedByOrgId: string;
  publishedByOrgName: string;
  publishedByUserId: string;
  downloadCount: number;
  createdAt: string;
}

class AutomationMarketplaceRepository {
  async findAll(limit = 50, offset = 0, category?: string): Promise<{ rows: MarketplaceAutomation[]; total: number }> {
    const conditions: string[] = [];
    const params: any[] = [];

    if (category) {
      conditions.push('category = ?');
      params.push(category);
    }

    const where = conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : '';

    const [rows, countRows] = await Promise.all([
      databaseService.queryControlPlane<any>(
        `SELECT * FROM automation_marketplace ${where} ORDER BY download_count DESC, created_at DESC LIMIT ? OFFSET ?`,
        [...params, limit, offset],
      ),
      databaseService.queryControlPlane<{ cnt: number }>(
        `SELECT COUNT(*) as cnt FROM automation_marketplace ${where}`,
        params,
      ),
    ]);

    return {
      rows: rows.map(this.mapRow),
      total: countRows[0]?.cnt ?? 0,
    };
  }

  async findById(id: string): Promise<MarketplaceAutomation | null> {
    const rows = await databaseService.queryControlPlane<any>(
      `SELECT * FROM automation_marketplace WHERE id = ?`,
      [id],
    );
    return rows.length > 0 ? this.mapRow(rows[0]) : null;
  }

  async create(data: {
    name: string;
    description: string | null;
    category: string | null | undefined;
    tags: string[] | null;
    triggerEventType: string;
    scope: string;
    definition: string;
    maxRunsPerDay: number;
    cooldownSeconds: number;
    publishedByOrgId: string;
    publishedByOrgName: string;
    publishedByUserId: string;
  }): Promise<MarketplaceAutomation> {
    const id = uuidv4();
    await databaseService.queryControlPlane(
      `INSERT INTO automation_marketplace (id, name, description, category, tags, trigger_event_type, scope, definition, max_runs_per_day, cooldown_seconds, published_by_org_id, published_by_org_name, published_by_user_id)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [id, data.name, data.description, data.category || null, JSON.stringify(data.tags), data.triggerEventType, data.scope, data.definition, data.maxRunsPerDay, data.cooldownSeconds, data.publishedByOrgId, data.publishedByOrgName, data.publishedByUserId],
    );
    return (await this.findById(id))!;
  }

  async incrementDownloadCount(id: string): Promise<void> {
    await databaseService.queryControlPlane(
      `UPDATE automation_marketplace SET download_count = download_count + 1 WHERE id = ?`,
      [id],
    );
  }

  async delete(id: string): Promise<boolean> {
    const result = await databaseService.queryControlPlane(
      `DELETE FROM automation_marketplace WHERE id = ?`,
      [id],
    ) as any;
    return (result?.affectedRows ?? 0) > 0;
  }

  private mapRow(row: any): MarketplaceAutomation {
    return {
      id: row.id,
      name: row.name,
      description: row.description,
      category: row.category,
      tags: row.tags ? (typeof row.tags === 'string' ? JSON.parse(row.tags) : row.tags) : null,
      triggerEventType: row.trigger_event_type,
      scope: row.scope || 'project',
      definition: row.definition ? (typeof row.definition === 'string' ? JSON.parse(row.definition) : row.definition) : null,
      maxRunsPerDay: Number(row.max_runs_per_day) || 50,
      cooldownSeconds: Number(row.cooldown_seconds) || 0,
      publishedByOrgId: row.published_by_org_id,
      publishedByOrgName: row.published_by_org_name,
      publishedByUserId: row.published_by_user_id,
      downloadCount: Number(row.download_count) || 0,
      createdAt: row.created_at,
    };
  }
}

export const automationMarketplaceRepository = new AutomationMarketplaceRepository();
