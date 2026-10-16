import { databaseService } from './connection';
import type { ProjectTemplate } from '../schemas/templateSchemas';

/**
 * A company's own project templates (T092), in its own database — so another company never sees
 * them, and a restart or deploy no longer loses them (they used to live in the server's memory).
 * The template is stored whole as JSON; id, name and usage count also have their own columns.
 */
interface Row { id: string; body: unknown; usage_count: number }

const toTemplate = (r: Row): ProjectTemplate => {
  const body = (typeof r.body === 'string' ? JSON.parse(r.body) : r.body) as ProjectTemplate;
  return { ...body, id: r.id, isBuiltIn: false, usageCount: Number(r.usage_count) || 0 };
};

/** a company's saved templates, newest first: a handful, never thousands (past the cap the oldest drop off the list) */
const LIST_LIMIT = 500;

class CustomTemplateRepository {
  async list(): Promise<ProjectTemplate[]> {
    const rows = await databaseService.query<Row>(
      `SELECT id, body, usage_count FROM custom_templates ORDER BY created_at DESC LIMIT ${LIST_LIMIT}`);
    return rows.map(toTemplate);
  }

  async find(id: string): Promise<ProjectTemplate | null> {
    const rows = await databaseService.query<Row>('SELECT id, body, usage_count FROM custom_templates WHERE id = ?', [id]);
    return rows[0] ? toTemplate(rows[0]) : null;
  }

  async insert(t: ProjectTemplate): Promise<void> {
    const { id, usageCount: _u, ...body } = t;
    await databaseService.query(
      'INSERT INTO custom_templates (id, name, body, usage_count, created_by) VALUES (?, ?, ?, 0, ?)',
      [id, t.name, JSON.stringify(body), t.createdBy ?? null]);
  }

  async replace(t: ProjectTemplate): Promise<void> {
    const { id, usageCount: _u, ...body } = t;
    await databaseService.query('UPDATE custom_templates SET name = ?, body = ? WHERE id = ?', [t.name, JSON.stringify(body), id]);
  }

  async remove(id: string): Promise<boolean> {
    const result: any = await databaseService.query('DELETE FROM custom_templates WHERE id = ?', [id]);
    return (result?.affectedRows ?? 0) > 0;
  }

  async countUse(id: string): Promise<void> {
    await databaseService.query('UPDATE custom_templates SET usage_count = usage_count + 1 WHERE id = ?', [id]);
  }
}

export const customTemplateRepository = new CustomTemplateRepository();
