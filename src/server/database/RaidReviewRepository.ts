import { databaseService } from './connection';
import type { RaidFinding } from '../services/raidReview/rules';

/** Tenant tables from T061: raid_reviews, raid_review_settings, raid_fix_batches */

export interface RaidReviewRow {
  id: string;
  projectId: string;
  score: number;
  rulesVersion: string;
  itemsChecked: number;
  findings: RaidFinding[];
  createdBy: string | null;
  createdAt: string;
}

export interface RaidFixBatch {
  id: string;
  projectId: string;
  summary: string;
  /** Per item id, the field values before the fixes */
  previous: Record<string, Record<string, unknown>>;
  itemIds: string[];
  createdBy: string | null;
  createdAt: string;
  undoneAt: string | null;
  undoneBy: string | null;
}

const KEEP_REVIEWS = 20;

function parseJson<T>(v: unknown, fallback: T): T {
  if (v == null) return fallback;
  if (typeof v !== 'string') return v as T;
  try { return JSON.parse(v) as T; } catch { return fallback; }
}

class RaidReviewRepository {
  async insertReview(r: Omit<RaidReviewRow, 'createdAt'>): Promise<void> {
    await databaseService.query(
      `INSERT INTO raid_reviews (id, project_id, score, rules_version, items_checked, findings, created_by)
       VALUES (?, ?, ?, ?, ?, ?, ?)`,
      [r.id, r.projectId, r.score, r.rulesVersion, r.itemsChecked, JSON.stringify(r.findings), r.createdBy],
    );
  }

  async findReviewById(id: string): Promise<RaidReviewRow | null> {
    const rows = await databaseService.query<any>('SELECT * FROM raid_reviews WHERE id = ?', [id]);
    return rows[0] ? mapReview(rows[0]) : null;
  }

  async findLatestReview(projectId: string): Promise<RaidReviewRow | null> {
    const rows = await databaseService.query<any>(
      'SELECT * FROM raid_reviews WHERE project_id = ? ORDER BY created_at DESC, id DESC LIMIT 1',
      [projectId],
    );
    return rows[0] ? mapReview(rows[0]) : null;
  }

  /** Keep the most recent runs per project; older ones are history nobody reads */
  async pruneReviews(projectId: string): Promise<void> {
    const rows = await databaseService.query<{ created_at: string }>(
      `SELECT created_at FROM raid_reviews WHERE project_id = ? ORDER BY created_at DESC LIMIT 1 OFFSET ${KEEP_REVIEWS - 1}`,
      [projectId],
    );
    if (!rows[0]) return;
    await databaseService.query('DELETE FROM raid_reviews WHERE project_id = ? AND created_at < ?', [projectId, rows[0].created_at]);
  }

  async getDisabledRules(projectId: string): Promise<string[]> {
    const rows = await databaseService.query<{ disabled_rules: unknown }>(
      'SELECT disabled_rules FROM raid_review_settings WHERE project_id = ?',
      [projectId],
    );
    const list = parseJson<unknown>(rows[0]?.disabled_rules, []);
    return Array.isArray(list) ? list.map(String) : [];
  }

  async setDisabledRules(projectId: string, rules: string[]): Promise<void> {
    await databaseService.query(
      `INSERT INTO raid_review_settings (project_id, disabled_rules) VALUES (?, ?)
       ON DUPLICATE KEY UPDATE disabled_rules = VALUES(disabled_rules)`,
      [projectId, JSON.stringify(rules)],
    );
  }

  async insertBatch(b: Omit<RaidFixBatch, 'createdAt' | 'undoneAt' | 'undoneBy'>): Promise<void> {
    await databaseService.query(
      `INSERT INTO raid_fix_batches (id, project_id, summary, previous, item_ids, created_by)
       VALUES (?, ?, ?, ?, ?, ?)`,
      [b.id, b.projectId, b.summary.slice(0, 500), JSON.stringify(b.previous), JSON.stringify(b.itemIds), b.createdBy],
    );
  }

  async findBatch(id: string): Promise<RaidFixBatch | null> {
    const rows = await databaseService.query<any>('SELECT * FROM raid_fix_batches WHERE id = ?', [id]);
    const r = rows[0];
    if (!r) return null;
    return {
      id: r.id,
      projectId: r.project_id,
      summary: r.summary,
      previous: parseJson(r.previous, {}),
      itemIds: parseJson(r.item_ids, []),
      createdBy: r.created_by ?? null,
      createdAt: r.created_at,
      undoneAt: r.undone_at ?? null,
      undoneBy: r.undone_by ?? null,
    };
  }

  async markUndone(id: string, userId: string | null): Promise<void> {
    await databaseService.query(
      'UPDATE raid_fix_batches SET undone_at = CURRENT_TIMESTAMP, undone_by = ? WHERE id = ?',
      [userId, id],
    );
  }
}

function mapReview(r: any): RaidReviewRow {
  return {
    id: r.id,
    projectId: r.project_id,
    score: Number(r.score),
    rulesVersion: r.rules_version,
    itemsChecked: Number(r.items_checked) || 0,
    findings: parseJson<RaidFinding[]>(r.findings, []),
    createdBy: r.created_by ?? null,
    createdAt: r.created_at,
  };
}

export const raidReviewRepository = new RaidReviewRepository();
