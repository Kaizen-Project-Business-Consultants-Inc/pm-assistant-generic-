import { databaseService } from './connection';
import { v4 as uuidv4 } from 'uuid';

export interface MarketplaceTemplate {
  id: string;
  name: string;
  description: string | null;
  category: string | null;
  tags: string[] | null;
  taskCount: number;
  estimatedDays: number;
  templateData: any;
  publishedByOrgId: string;
  publishedByOrgName: string;
  publishedByUserId: string;
  downloadCount: number;
  createdAt: string;
}

class TemplateMarketplaceRepository {
  async findAll(limit = 50, offset = 0, category?: string): Promise<{ rows: MarketplaceTemplate[]; total: number }> {
    const conditions: string[] = [];
    const params: any[] = [];

    if (category) {
      conditions.push('category = ?');
      params.push(category);
    }

    const where = conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : '';

    const [rows, countRows] = await Promise.all([
      databaseService.queryControlPlane<any>(
        `SELECT * FROM template_marketplace ${where} ORDER BY download_count DESC, created_at DESC LIMIT ? OFFSET ?`,
        [...params, limit, offset],
      ),
      databaseService.queryControlPlane<{ cnt: number }>(
        `SELECT COUNT(*) as cnt FROM template_marketplace ${where}`,
        params,
      ),
    ]);

    return {
      rows: rows.map(this.mapRow),
      total: countRows[0]?.cnt ?? 0,
    };
  }

  async findById(id: string): Promise<MarketplaceTemplate | null> {
    const rows = await databaseService.queryControlPlane<any>(
      `SELECT * FROM template_marketplace WHERE id = ?`,
      [id],
    );
    return rows.length > 0 ? this.mapRow(rows[0]) : null;
  }

  async create(data: {
    name: string;
    description: string | null;
    category: string | null;
    tags: string[] | null;
    taskCount: number;
    estimatedDays: number;
    templateData: any;
    publishedByOrgId: string;
    publishedByOrgName: string;
    publishedByUserId: string;
  }): Promise<MarketplaceTemplate> {
    const id = uuidv4();
    await databaseService.queryControlPlane(
      `INSERT INTO template_marketplace (id, name, description, category, tags, task_count, estimated_days, template_data, published_by_org_id, published_by_org_name, published_by_user_id)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [id, data.name, data.description, data.category, JSON.stringify(data.tags), data.taskCount, data.estimatedDays, JSON.stringify(data.templateData), data.publishedByOrgId, data.publishedByOrgName, data.publishedByUserId],
    );
    return (await this.findById(id))!;
  }

  async incrementDownloadCount(id: string): Promise<void> {
    await databaseService.queryControlPlane(
      `UPDATE template_marketplace SET download_count = download_count + 1 WHERE id = ?`,
      [id],
    );
  }

  async delete(id: string): Promise<boolean> {
    const result = await databaseService.queryControlPlane(
      `DELETE FROM template_marketplace WHERE id = ?`,
      [id],
    ) as any;
    return (result?.affectedRows ?? 0) > 0;
  }

  private mapRow(row: any): MarketplaceTemplate {
    return {
      id: row.id,
      name: row.name,
      description: row.description,
      category: row.category,
      tags: row.tags ? (typeof row.tags === 'string' ? JSON.parse(row.tags) : row.tags) : null,
      taskCount: Number(row.task_count) || 0,
      estimatedDays: Number(row.estimated_days) || 0,
      templateData: row.template_data ? (typeof row.template_data === 'string' ? JSON.parse(row.template_data) : row.template_data) : null,
      publishedByOrgId: row.published_by_org_id,
      publishedByOrgName: row.published_by_org_name,
      publishedByUserId: row.published_by_user_id,
      downloadCount: Number(row.download_count) || 0,
      createdAt: row.created_at,
    };
  }
}

export const templateMarketplaceRepository = new TemplateMarketplaceRepository();
