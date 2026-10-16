import { databaseService } from './connection';

/**
 * The AI inbox's suggestions (T093), in the company's own database. An agent only suggests: a row
 * holds the exact change (payload) and what it is based on (evidence); after Accept it holds the
 * way back (undo_ref). See services/aiInbox.
 */
/** 'working' = being applied right now (claimed, so a double click can't apply it twice) */
export type SuggestionStatus = 'waiting' | 'working' | 'accepted' | 'rejected' | 'undone' | 'stale';

export interface AiSuggestion {
  id: string;
  projectId: string;
  scheduleId: string | null;
  agent: string;
  kind: string;
  reviewId: string | null;
  itemKey: string;
  title: string;
  detail: string | null;
  payload: any;
  evidence: string[];
  measure: number;
  status: SuggestionStatus;
  reason: string | null;
  resultSummary: string | null;
  undoRef: any;
  decidedBy: string | null;
  decidedAt: string | null;
  createdAt: string;
}

const json = (v: unknown, fallback: any) => {
  if (v == null) return fallback;
  if (typeof v !== 'string') return v;
  try { return JSON.parse(v); } catch { return fallback; }
};

const toSuggestion = (r: any): AiSuggestion => ({
  id: r.id,
  projectId: r.project_id,
  scheduleId: r.schedule_id ?? null,
  agent: r.agent,
  kind: r.kind,
  reviewId: r.review_id ?? null,
  itemKey: r.item_key,
  title: r.title,
  detail: r.detail ?? null,
  payload: json(r.payload, {}),
  evidence: json(r.evidence, []),
  measure: Number(r.measure) || 0,
  status: r.status,
  reason: r.reason ?? null,
  resultSummary: r.result_summary ?? null,
  undoRef: json(r.undo_ref, null),
  decidedBy: r.decided_by ?? null,
  decidedAt: r.decided_at ? String(r.decided_at) : null,
  createdAt: String(r.created_at),
});

/** one company's inbox: tens of rows a week, never thousands */
const LIST_LIMIT = 300;

class AiSuggestionRepository {
  async insertMany(rows: Array<Omit<AiSuggestion, 'status' | 'reason' | 'resultSummary' | 'undoRef' | 'decidedBy' | 'decidedAt' | 'createdAt'>>): Promise<void> {
    if (rows.length === 0) return;
    await databaseService.query(
      `INSERT IGNORE INTO ai_suggestions (id, project_id, schedule_id, agent, kind, review_id, item_key, title, detail, payload, evidence, measure)
       VALUES ${rows.map(() => '(?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)').join(', ')}`,
      rows.flatMap(r => [r.id, r.projectId, r.scheduleId, r.agent, r.kind, r.reviewId, r.itemKey, r.title.slice(0, 300), r.detail,
        JSON.stringify(r.payload), JSON.stringify(r.evidence ?? []), r.measure]));
  }

  /** A new review's suggestions replace the project's older ones still waiting */
  async markWaitingStale(projectId: string, agent: string): Promise<void> {
    await databaseService.query(
      `UPDATE ai_suggestions SET status = 'stale' WHERE project_id = ? AND agent = ? AND status = 'waiting'`, [projectId, agent]);
  }

  async findById(id: string): Promise<AiSuggestion | null> {
    const rows = await databaseService.query<any>('SELECT * FROM ai_suggestions WHERE id = ?', [id]);
    return rows[0] ? toSuggestion(rows[0]) : null;
  }

  /** Newest first, of the given statuses, in the given projects */
  async list(projectIds: string[], statuses: SuggestionStatus[]): Promise<AiSuggestion[]> {
    if (projectIds.length === 0 || statuses.length === 0) return [];
    const rows = await databaseService.query<any>(
      `SELECT * FROM ai_suggestions WHERE project_id IN (${projectIds.map(() => '?').join(',')})
         AND status IN (${statuses.map(() => '?').join(',')})
       ORDER BY created_at DESC, measure DESC LIMIT ${LIST_LIMIT}`,
      [...projectIds, ...statuses]);
    return rows.map(toSuggestion);
  }

  /** The projects that have suggestions waiting, with how many */
  async waitingByProject(): Promise<Map<string, number>> {
    const rows = await databaseService.query<{ project_id: string; n: number }>(
      `SELECT project_id, COUNT(*) AS n FROM ai_suggestions WHERE status = 'waiting' GROUP BY project_id`);
    return new Map(rows.map(r => [r.project_id, Number(r.n)]));
  }

  async waitingCount(projectId: string): Promise<number> {
    const [r] = await databaseService.query<{ n: number }>(
      `SELECT COUNT(*) AS n FROM ai_suggestions WHERE project_id = ? AND status = 'waiting'`, [projectId]);
    return Number(r?.n ?? 0);
  }

  /** Replaced and decided suggestions older than this are removed (the inbox is not an archive) */
  async purgeOld(projectId: string, keepDays: number): Promise<void> {
    await databaseService.query(
      `DELETE FROM ai_suggestions WHERE project_id = ? AND status IN ('stale', 'rejected', 'undone', 'accepted')
          AND created_at < UTC_TIMESTAMP() - INTERVAL ? DAY`, [projectId, keepDays]);
  }

  /** Decide a waiting suggestion; false when it was no longer waiting (someone got there first) */
  async decide(id: string, from: SuggestionStatus, to: SuggestionStatus, by: string, fields: { reason?: string | null; resultSummary?: string | null; undoRef?: unknown }): Promise<boolean> {
    const result: any = await databaseService.query(
      `UPDATE ai_suggestions SET status = ?, reason = COALESCE(?, reason), result_summary = COALESCE(?, result_summary),
              undo_ref = COALESCE(?, undo_ref), decided_by = ?, decided_at = UTC_TIMESTAMP()
        WHERE id = ? AND status = ?`,
      [to, fields.reason ?? null, fields.resultSummary?.slice(0, 500) ?? null,
        fields.undoRef === undefined ? null : JSON.stringify(fields.undoRef), by, id, from]);
    return (result?.affectedRows ?? 0) > 0;
  }
}

export const aiSuggestionRepository = new AiSuggestionRepository();
