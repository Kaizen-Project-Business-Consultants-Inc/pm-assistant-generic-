import { databaseService } from './connection';
import type { WeeklyItem, FineNote, Rag, Dismissal } from '../services/weeklyReview/picker';

/** Tenant tables from T079: weekly_reviews, weekly_review_responses */

export interface WeeklyReviewRow {
  id: string;
  projectId: string;
  weekStart: string;
  asOf: string;
  rag: Rag;
  ragReason: string | null;
  items: WeeklyItem[];
  fine: FineNote[];
  uncertainty: string[];
  moreFound: number;
  quietened: number;
  trigger: string;
  createdBy: string | null;
  createdAt: string;
}

export interface WeeklyResponseRow {
  itemKey: string;
  response: 'dismissed' | 'applied';
  reason: string | null;
  createdAt: string;
}

const KEEP_REVIEWS = 26;

function parseJson<T>(v: unknown, fallback: T): T {
  if (v == null) return fallback;
  if (typeof v !== 'string') return v as T;
  try { return JSON.parse(v) as T; } catch { return fallback; }
}

const ymd = (v: unknown) => (v instanceof Date ? v.toISOString().slice(0, 10) : String(v ?? '').slice(0, 10));
const stamp = (v: unknown) => (v instanceof Date ? v.toISOString() : String(v ?? ''));

function mapReview(r: any): WeeklyReviewRow {
  return {
    id: r.id,
    projectId: r.project_id,
    weekStart: ymd(r.week_start),
    asOf: ymd(r.as_of),
    rag: r.rag,
    ragReason: r.rag_reason ?? null,
    items: parseJson(r.items, []),
    fine: parseJson(r.fine, []),
    uncertainty: parseJson(r.uncertainty, []),
    moreFound: Number(r.more_found) || 0,
    quietened: Number(r.quietened) || 0,
    trigger: r.trigger,
    createdBy: r.created_by ?? null,
    createdAt: stamp(r.created_at),
  };
}

class WeeklyReviewRepository {
  async insert(r: Omit<WeeklyReviewRow, 'createdAt'>): Promise<void> {
    await databaseService.query(
      `INSERT INTO weekly_reviews (id, project_id, week_start, as_of, rag, rag_reason, items, fine, uncertainty, more_found, quietened, \`trigger\`, created_by)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [r.id, r.projectId, r.weekStart, r.asOf, r.rag, r.ragReason, JSON.stringify(r.items), JSON.stringify(r.fine),
        JSON.stringify(r.uncertainty), r.moreFound, r.quietened, r.trigger, r.createdBy],
    );
  }

  async findById(id: string): Promise<WeeklyReviewRow | null> {
    const rows = await databaseService.query<any>('SELECT * FROM weekly_reviews WHERE id = ?', [id]);
    return rows[0] ? mapReview(rows[0]) : null;
  }

  async findLatest(projectId: string): Promise<WeeklyReviewRow | null> {
    const rows = await databaseService.query<any>(
      'SELECT * FROM weekly_reviews WHERE project_id = ? ORDER BY created_at DESC, id DESC LIMIT 1',
      [projectId],
    );
    return rows[0] ? mapReview(rows[0]) : null;
  }

  /** Keep about half a year of runs per project */
  async prune(projectId: string): Promise<void> {
    const rows = await databaseService.query<{ created_at: string }>(
      `SELECT created_at FROM weekly_reviews WHERE project_id = ? ORDER BY created_at DESC LIMIT 1 OFFSET ${KEEP_REVIEWS - 1}`,
      [projectId],
    );
    if (!rows[0]) return;
    await databaseService.query('DELETE FROM weekly_reviews WHERE project_id = ? AND created_at < ?', [projectId, rows[0].created_at]);
  }

  async responsesFor(reviewId: string): Promise<WeeklyResponseRow[]> {
    const rows = await databaseService.query<any>(
      'SELECT item_key, response, reason, created_at FROM weekly_review_responses WHERE review_id = ?',
      [reviewId],
    );
    return rows.map(r => ({ itemKey: r.item_key, response: r.response, reason: r.reason ?? null, createdAt: stamp(r.created_at) }));
  }

  /** Dismissals on this project since a date (for keeping dismissed problems quiet) */
  async dismissalsSince(projectId: string, since: string): Promise<Dismissal[]> {
    const rows = await databaseService.query<any>(
      `SELECT item_key, measure, created_at FROM weekly_review_responses
        WHERE project_id = ? AND response = 'dismissed' AND created_at >= ?`,
      [projectId, since],
    );
    return rows.map(r => ({ key: r.item_key, measure: Number(r.measure) || 0, at: stamp(r.created_at).slice(0, 10) }));
  }

  /** The latest review of each project the user manages (owner/manager member), live projects only */
  async latestForManager(userId: string): Promise<Array<{ projectId: string; projectName: string; reviewId: string; rag: string; items: number; createdAt: string; done: number }>> {
    const rows = await databaseService.query<any>(
      `SELECT w.id, w.project_id, p.name AS project_name, w.rag, w.items, w.created_at,
              (SELECT COUNT(*) FROM weekly_review_responses r WHERE r.review_id = w.id) AS done
         FROM weekly_reviews w
         JOIN projects p ON p.id = w.project_id AND p.archived_at IS NULL
         JOIN project_members m ON m.project_id = w.project_id AND m.user_id = ? AND m.role IN ('owner', 'manager')
        WHERE w.created_at = (SELECT MAX(w2.created_at) FROM weekly_reviews w2 WHERE w2.project_id = w.project_id)
        LIMIT 200`,
      [userId],
    );
    return rows.map(r => ({
      projectId: r.project_id,
      projectName: r.project_name,
      reviewId: r.id,
      rag: r.rag,
      items: parseJson<unknown[]>(r.items, []).length,
      createdAt: stamp(r.created_at),
      done: Number(r.done) || 0,
    }));
  }

  async saveResponse(r: { id: string; projectId: string; reviewId: string; itemKey: string; response: 'dismissed' | 'applied'; reason: string | null; measure: number; createdBy: string }): Promise<void> {
    await databaseService.query(
      `INSERT INTO weekly_review_responses (id, project_id, review_id, item_key, response, reason, measure, created_by)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)
       ON DUPLICATE KEY UPDATE response = VALUES(response), reason = VALUES(reason), measure = VALUES(measure),
         created_by = VALUES(created_by), created_at = CURRENT_TIMESTAMP`,
      [r.id, r.projectId, r.reviewId, r.itemKey, r.response, r.reason, r.measure, r.createdBy],
    );
  }
}

export const weeklyReviewRepository = new WeeklyReviewRepository();
