import { databaseService } from './connection';
import type { Band, Finding, Severity, SkippedRule } from '../services/scheduleReview/rules';

export type ReviewTrigger = 'import' | 'manual' | 'agent' | 'post_proposal' | 'auto';

export interface ScheduleReviewRecord {
  id: string;
  scheduleId: string;
  projectId: string;
  score: number;
  band: Band;
  counts: Record<Severity, number>;
  leafTaskCount: number;
  findings: Finding[];
  skippedRules: SkippedRule[];
  trigger: ReviewTrigger;
  proposalId: string | null;
  rulesVersion: string;
  createdBy: string | null;
  createdAt: string;
}

export interface ScheduleReviewSummary {
  id: string;
  score: number;
  band: Band;
  counts: Record<Severity, number>;
  trigger: ReviewTrigger;
  createdAt: string;
}

const KEEP_RUNS_PER_SCHEDULE = 50;

function parseJson<T>(v: unknown, fallback: T): T {
  if (v == null) return fallback;
  if (typeof v === 'string') { try { return JSON.parse(v) as T; } catch { return fallback; } }
  return v as T;
}

function counts(row: any): Record<Severity, number> {
  return {
    critical: Number(row.critical_count ?? 0),
    high: Number(row.high_count ?? 0),
    medium: Number(row.medium_count ?? 0),
    low: Number(row.low_count ?? 0),
    info: Number(row.info_count ?? 0),
  };
}

function mapRow(row: any): ScheduleReviewRecord {
  return {
    id: row.id,
    scheduleId: row.schedule_id,
    projectId: row.project_id,
    score: Number(row.score),
    band: row.band,
    counts: counts(row),
    leafTaskCount: Number(row.leaf_task_count ?? 0),
    findings: parseJson<Finding[]>(row.findings, []),
    skippedRules: parseJson<SkippedRule[]>(row.skipped_rules, []),
    trigger: row.trigger_source,
    proposalId: row.proposal_id ?? null,
    rulesVersion: row.rules_version,
    createdBy: row.created_by ?? null,
    createdAt: new Date(row.created_at).toISOString(),
  };
}

function mapSummary(row: any): ScheduleReviewSummary {
  return {
    id: row.id,
    score: Number(row.score),
    band: row.band,
    counts: counts(row),
    trigger: row.trigger_source,
    createdAt: new Date(row.created_at).toISOString(),
  };
}

export class ScheduleReviewRepository {
  async insert(record: Omit<ScheduleReviewRecord, 'createdAt'>): Promise<ScheduleReviewRecord> {
    await databaseService.query(
      `INSERT INTO schedule_reviews
        (id, schedule_id, project_id, score, band, critical_count, high_count, medium_count, low_count, info_count,
         leaf_task_count, findings, skipped_rules, trigger_source, proposal_id, rules_version, created_by)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        record.id, record.scheduleId, record.projectId, record.score, record.band,
        record.counts.critical, record.counts.high, record.counts.medium, record.counts.low, record.counts.info,
        record.leafTaskCount, JSON.stringify(record.findings), JSON.stringify(record.skippedRules),
        record.trigger, record.proposalId, record.rulesVersion, record.createdBy,
      ],
    );
    const rows = await databaseService.query('SELECT * FROM schedule_reviews WHERE id = ?', [record.id]);
    return mapRow(rows[0]);
  }

  async findLatest(scheduleId: string): Promise<ScheduleReviewRecord | null> {
    const rows = await databaseService.query(
      'SELECT * FROM schedule_reviews WHERE schedule_id = ? ORDER BY created_at DESC, id DESC LIMIT 1',
      [scheduleId],
    );
    return rows.length ? mapRow(rows[0]) : null;
  }

  async findHistory(scheduleId: string, limit = 8): Promise<ScheduleReviewSummary[]> {
    const safeLimit = Math.max(1, Math.min(50, Math.floor(limit)));
    const rows = await databaseService.query(
      `SELECT id, score, band, critical_count, high_count, medium_count, low_count, info_count, trigger_source, created_at
       FROM schedule_reviews WHERE schedule_id = ? ORDER BY created_at DESC, id DESC LIMIT ${safeLimit}`,
      [scheduleId],
    );
    return rows.map(mapSummary);
  }

  /** Keep the most recent runs per schedule; delete the rest. */
  async prune(scheduleId: string, keep = KEEP_RUNS_PER_SCHEDULE): Promise<void> {
    const rows = await databaseService.query(
      'SELECT id FROM schedule_reviews WHERE schedule_id = ? ORDER BY created_at DESC, id DESC',
      [scheduleId],
    );
    const stale = rows.slice(keep).map((r: any) => r.id);
    if (stale.length === 0) return;
    const placeholders = stale.map(() => '?').join(',');
    await databaseService.query(`DELETE FROM schedule_reviews WHERE id IN (${placeholders})`, stale);
  }
}

export const scheduleReviewRepository = new ScheduleReviewRepository();
