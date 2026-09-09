import { databaseService } from '../../database/connection';
import { ragService } from '../RagService';
import { embeddingService } from '../EmbeddingService';
import logger from '../../utils/logger';
import { randomUUID } from 'crypto';
import {
  type LessonLearned,
  type Pattern,
  type MitigationSuggestion,
  type KnowledgeBaseOverview,
  type LessonsReport,
  type SourceArtifact,
} from '../../schemas/lessonsLearnedSchemas';
import { seedFromProjects } from './seeder';
import { extractLessons } from './extractor';
import { detectPatterns } from './patternDetector';
import { suggestMitigations, type SuggestionField } from './mitigationAdvisor';

// ── Row mapper ────────────────────────────────────────────────────────────

function parseJson<T>(val: any, fallback: T): T {
  if (!val) return fallback;
  try { return typeof val === 'string' ? JSON.parse(val) : val; } catch { return fallback; }
}

function rowToLesson(row: any): LessonLearned {
  return {
    id: row.id,
    projectId: row.project_id,
    projectName: row.project_name,
    projectType: row.project_type,
    category: row.category,
    title: row.title,
    description: row.description,
    impact: row.impact,
    recommendation: row.recommendation,
    rootCause: row.root_cause ?? null,
    severity: row.severity ?? null,
    recurrenceScore: row.recurrence_score ?? 0,
    isElevated: row.is_elevated === 1 || row.is_elevated === true,
    sourceArtifacts: parseJson<SourceArtifact[] | null>(row.source_artifacts, null),
    confidence: row.confidence,
    status: row.status ?? 'approved',
    createdBy: row.created_by ?? null,
    sourceType: row.source_type ?? 'manual',
    tags: parseJson<string[] | null>(row.tags, null),
    appliedCount: row.applied_count ?? 0,
    effectivenessRating: row.effectiveness_rating ?? null,
    helpfulCount: row.helpful_count ?? 0,
    dismissedCount: row.dismissed_count ?? 0,
    createdAt: row.created_at instanceof Date ? row.created_at.toISOString() : String(row.created_at),
  };
}

function rowToPattern(row: any): Pattern {
  let projectTypes: string[] = [];
  if (row.project_types) {
    try { projectTypes = typeof row.project_types === 'string' ? JSON.parse(row.project_types) : row.project_types; } catch { projectTypes = []; }
  }
  return {
    id: row.id,
    title: row.title,
    description: row.description,
    frequency: row.frequency,
    projectTypes,
    category: row.category,
    recommendation: row.recommendation,
    confidence: row.confidence,
    detectedAt: row.detected_at instanceof Date ? row.detected_at.toISOString() : String(row.detected_at ?? ''),
  };
}

// ── Service ───────────────────────────────────────────────────────────────

export class LessonsLearnedService {
  async persistLesson(lesson: LessonLearned): Promise<void> {
    await databaseService.query(
      `INSERT INTO lessons_learned (id, project_id, project_name, project_type, category, title, description, impact, recommendation, root_cause, severity, recurrence_score, is_elevated, source_artifacts, confidence, status, created_by, source_type, tags, applied_count, effectiveness_rating, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
       ON DUPLICATE KEY UPDATE title = VALUES(title), description = VALUES(description), recommendation = VALUES(recommendation), root_cause = VALUES(root_cause), severity = VALUES(severity), recurrence_score = VALUES(recurrence_score), is_elevated = VALUES(is_elevated), source_artifacts = VALUES(source_artifacts), confidence = VALUES(confidence)`,
      [
        lesson.id, lesson.projectId, lesson.projectName, lesson.projectType,
        lesson.category, lesson.title, lesson.description, lesson.impact,
        lesson.recommendation,
        lesson.rootCause ?? null,
        lesson.severity ?? null,
        lesson.recurrenceScore ?? 0,
        lesson.isElevated ? 1 : 0,
        lesson.sourceArtifacts ? JSON.stringify(lesson.sourceArtifacts) : null,
        lesson.confidence,
        lesson.status ?? 'approved',
        lesson.createdBy ?? null,
        lesson.sourceType ?? 'manual',
        lesson.tags ? JSON.stringify(lesson.tags) : null,
        lesson.appliedCount ?? 0,
        lesson.effectivenessRating ?? null,
        lesson.createdAt,
      ],
    );

    // Index + recurrence check (fire-and-forget)
    ragService.indexLesson(lesson).catch((err) => {
      logger.error(`[RAG] Failed to index lesson ${lesson.id}:`, (err as Error).message);
    });
    this.checkRecurrence(lesson).catch((err) => {
      logger.error(`[Recurrence] Failed for lesson ${lesson.id}:`, (err as Error).message);
    });
  }

  async persistPatterns(patterns: Pattern[]): Promise<void> {
    // Clear old patterns and insert new ones
    await databaseService.query('DELETE FROM lesson_patterns');
    for (const p of patterns) {
      await databaseService.query(
        `INSERT INTO lesson_patterns (id, title, description, frequency, project_types, category, recommendation, confidence, detected_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [p.id, p.title, p.description, p.frequency, JSON.stringify(p.projectTypes), p.category, p.recommendation, p.confidence, p.detectedAt || new Date().toISOString()],
      );
    }
  }

  async getPersistedPatterns(): Promise<Pattern[]> {
    try {
      const rows = await databaseService.query<any>('SELECT * FROM lesson_patterns ORDER BY confidence DESC');
      return rows.map(rowToPattern);
    } catch {
      return [];
    }
  }

  async seedFromProjects(): Promise<number> {
    return seedFromProjects(this.persistLesson.bind(this));
  }

  async extractLessons(projectId: string, userId?: string): Promise<LessonLearned[]> {
    return extractLessons(projectId, this.persistLesson.bind(this), userId ? parseInt(userId, 10) : undefined);
  }

  async getKnowledgeBase(): Promise<KnowledgeBaseOverview> {
    const lessons = await this.getAllLessons();
    const patterns = await this.getPersistedPatterns();

    const byCategory: Record<string, number> = {};
    const byProjectType: Record<string, number> = {};
    const byImpact: Record<string, number> = {};

    for (const lesson of lessons) {
      byCategory[lesson.category] = (byCategory[lesson.category] || 0) + 1;
      byProjectType[lesson.projectType] = (byProjectType[lesson.projectType] || 0) + 1;
      byImpact[lesson.impact] = (byImpact[lesson.impact] || 0) + 1;
    }

    const sorted = [...lessons].sort(
      (a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime(),
    );
    const recentLessons = sorted.slice(0, 10);

    return { totalLessons: lessons.length, byCategory, byProjectType, byImpact, recentLessons, patterns };
  }

  async findRelevantLessons(projectType?: string, category?: string, limit = 5): Promise<LessonLearned[]> {
    let sql = 'SELECT * FROM lessons_learned WHERE status = ? AND confidence >= 60';
    const params: any[] = ['approved'];
    if (projectType) { sql += ' AND project_type = ?'; params.push(projectType); }
    if (category) { sql += ' AND category = ?'; params.push(category); }
    sql += ' ORDER BY is_elevated DESC, confidence DESC LIMIT ?';
    params.push(limit);
    const rows = await databaseService.query<any>(sql, params);
    return rows.map(rowToLesson);
  }

  async findSimilarLessons(query: string, topK?: number): Promise<LessonLearned[]> {
    if (!ragService.isAvailable()) return [];
    const results = await ragService.search(query, { documentType: 'lesson', topK });
    return results.filter((r) => r.document !== null).map((r) => r.document as LessonLearned);
  }

  async detectPatterns(_userId?: string): Promise<Pattern[]> {
    const lessons = await this.getAllLessons();
    return detectPatterns(lessons, async (p) => { await this.persistPatterns(p); });
  }

  async suggestMitigations(riskDescription: string, projectType: string, _userId?: string, field: SuggestionField = 'mitigation'): Promise<MitigationSuggestion[]> {
    return suggestMitigations(
      riskDescription,
      projectType,
      this.getApprovedLessons.bind(this),
      this.findSimilarLessons.bind(this),
      field,
    );
  }

  async incrementAppliedCount(lessonId: string): Promise<void> {
    await databaseService.query(
      'UPDATE lessons_learned SET applied_count = applied_count + 1 WHERE id = ?',
      [lessonId],
    );
  }

  async rateEffectiveness(lessonId: string, rating: number): Promise<boolean> {
    const result = await databaseService.query<any>(
      'UPDATE lessons_learned SET effectiveness_rating = ? WHERE id = ?',
      [rating, lessonId],
    );
    return (result as any).affectedRows > 0;
  }

  async updateStatus(id: string, status: 'draft' | 'reviewed' | 'approved' | 'archived' | 'pending_elevation'): Promise<boolean> {
    const result = await databaseService.query<any>(
      'UPDATE lessons_learned SET status = ? WHERE id = ?',
      [status, id],
    );
    return (result as any).affectedRows > 0;
  }

  async addLesson(data: {
    projectId: string;
    projectName: string;
    projectType: string;
    category: LessonLearned['category'];
    title: string;
    description: string;
    impact: LessonLearned['impact'];
    recommendation: string;
    rootCause?: string;
    severity?: LessonLearned['severity'];
    confidence?: number;
    sourceType?: LessonLearned['sourceType'];
    createdBy?: number;
    tags?: string[];
    status?: LessonLearned['status'];
  }): Promise<LessonLearned> {
    const lesson: LessonLearned = {
      id: `ll-manual-${Date.now()}-${Math.random().toString(36).substr(2, 6)}`,
      projectId: data.projectId,
      projectName: data.projectName,
      projectType: data.projectType,
      category: data.category,
      title: data.title,
      description: data.description,
      impact: data.impact,
      recommendation: data.recommendation,
      rootCause: data.rootCause ?? null,
      severity: data.severity ?? null,
      recurrenceScore: 0,
      isElevated: false,
      sourceArtifacts: null,
      confidence: data.confidence ?? 80,
      status: data.status ?? (data.sourceType === 'manual' ? 'approved' : 'draft'),
      createdBy: data.createdBy ?? null,
      sourceType: data.sourceType ?? 'manual',
      tags: data.tags ?? null,
      appliedCount: 0,
      effectivenessRating: null,
      helpfulCount: 0,
      dismissedCount: 0,
      createdAt: new Date().toISOString(),
    };
    await this.persistLesson(lesson);
    return lesson;
  }

  async getLessons(limit = 20, offset = 0, filters?: { projectId?: string; isElevated?: boolean; status?: string; category?: string; severity?: string }): Promise<LessonLearned[]> {
    let sql = 'SELECT * FROM lessons_learned WHERE 1=1';
    const params: any[] = [];
    if (filters?.projectId) { sql += ' AND project_id = ?'; params.push(filters.projectId); }
    if (filters?.isElevated !== undefined) { sql += ' AND is_elevated = ?'; params.push(filters.isElevated ? 1 : 0); }
    if (filters?.status) { sql += ' AND status = ?'; params.push(filters.status); }
    if (filters?.category) { sql += ' AND category = ?'; params.push(filters.category); }
    if (filters?.severity) { sql += ' AND severity = ?'; params.push(filters.severity); }
    sql += ' ORDER BY created_at DESC LIMIT ? OFFSET ?';
    params.push(limit, offset);
    const rows = await databaseService.query<any>(sql, params);
    return rows.map(rowToLesson);
  }

  async countLessons(filters?: { projectId?: string; isElevated?: boolean; status?: string; category?: string; severity?: string }): Promise<number> {
    let sql = 'SELECT COUNT(*) as cnt FROM lessons_learned WHERE 1=1';
    const params: any[] = [];
    if (filters?.projectId) { sql += ' AND project_id = ?'; params.push(filters.projectId); }
    if (filters?.isElevated !== undefined) { sql += ' AND is_elevated = ?'; params.push(filters.isElevated ? 1 : 0); }
    if (filters?.status) { sql += ' AND status = ?'; params.push(filters.status); }
    if (filters?.category) { sql += ' AND category = ?'; params.push(filters.category); }
    if (filters?.severity) { sql += ' AND severity = ?'; params.push(filters.severity); }
    const rows = await databaseService.query<{ cnt: number }>(sql, params);
    return Number(rows[0]?.cnt ?? 0);
  }

  /** Returns approved lessons only, capped at 15 for AI/pattern operations */
  private async getApprovedLessons(): Promise<LessonLearned[]> {
    const rows = await databaseService.query<any>(
      'SELECT * FROM lessons_learned WHERE status = ? ORDER BY confidence DESC, created_at DESC LIMIT 15',
      ['approved'],
    );
    return rows.map(rowToLesson);
  }

  /** Returns all lessons (any status) for knowledge base and pattern detection, capped at 15 */
  private async getAllLessons(): Promise<LessonLearned[]> {
    const rows = await databaseService.query<any>(
      'SELECT * FROM lessons_learned ORDER BY created_at DESC LIMIT 15',
    );
    return rows.map(rowToLesson);
  }

  async updateLesson(id: string, data: { title?: string; description?: string; category?: string; impact?: string; recommendation?: string; rootCause?: string; severity?: string; isElevated?: boolean; tags?: string[]; status?: string }): Promise<boolean> {
    const fields: string[] = [];
    const values: any[] = [];
    if (data.title !== undefined) { fields.push('title = ?'); values.push(data.title); }
    if (data.description !== undefined) { fields.push('description = ?'); values.push(data.description); }
    if (data.category !== undefined) { fields.push('category = ?'); values.push(data.category); }
    if (data.impact !== undefined) { fields.push('impact = ?'); values.push(data.impact); }
    if (data.recommendation !== undefined) { fields.push('recommendation = ?'); values.push(data.recommendation); }
    if (data.rootCause !== undefined) { fields.push('root_cause = ?'); values.push(data.rootCause); }
    if (data.severity !== undefined) { fields.push('severity = ?'); values.push(data.severity); }
    if (data.isElevated !== undefined) { fields.push('is_elevated = ?'); values.push(data.isElevated ? 1 : 0); }
    if (data.tags !== undefined) { fields.push('tags = ?'); values.push(JSON.stringify(data.tags)); }
    if (data.status !== undefined) { fields.push('status = ?'); values.push(data.status); }
    if (fields.length === 0) return false;
    values.push(id);
    const result = await databaseService.query<any>(`UPDATE lessons_learned SET ${fields.join(', ')} WHERE id = ?`, values);
    const updated = (result as any).affectedRows > 0;

    // Re-index embedding with updated content (fire-and-forget)
    if (updated) {
      const rows = await databaseService.query<any>('SELECT * FROM lessons_learned WHERE id = ?', [id]);
      if (rows.length > 0) {
        ragService.indexLesson(rowToLesson(rows[0])).catch((err) => {
          logger.error(`[RAG] Failed to re-index lesson ${id}:`, (err as Error).message);
        });
      }
    }

    return updated;
  }

  async elevateLesson(id: string): Promise<boolean> {
    const result = await databaseService.query<any>(
      'UPDATE lessons_learned SET is_elevated = 1 WHERE id = ?',
      [id],
    );
    return (result as any).affectedRows > 0;
  }

  async getLessonsReport(): Promise<LessonsReport> {
    const lessons = await this.getAllLessonsUnbounded();

    const bySeverity: Record<string, number> = {};
    const byCategory: Record<string, number> = {};
    const byImpact: Record<string, number> = {};

    const thirtyDaysAgo = new Date();
    thirtyDaysAgo.setDate(thirtyDaysAgo.getDate() - 30);
    const recentByCategory: Record<string, number> = {};

    for (const lesson of lessons) {
      if (lesson.severity) bySeverity[lesson.severity] = (bySeverity[lesson.severity] || 0) + 1;
      byCategory[lesson.category] = (byCategory[lesson.category] || 0) + 1;
      byImpact[lesson.impact] = (byImpact[lesson.impact] || 0) + 1;

      if (new Date(lesson.createdAt) >= thirtyDaysAgo) {
        recentByCategory[lesson.category] = (recentByCategory[lesson.category] || 0) + 1;
      }
    }

    const trendingCategories = Object.entries(byCategory)
      .map(([category, count]) => ({ category, count, recentCount: recentByCategory[category] || 0 }))
      .sort((a, b) => b.recentCount - a.recentCount);

    const elevatedLessons = lessons.filter(l => l.isElevated);
    const highSeverityLessons = lessons.filter(l => l.severity === 'high' || l.severity === 'critical');

    return {
      totalLessons: lessons.length,
      elevated: elevatedLessons.length,
      bySeverity,
      byCategory,
      byImpact,
      trendingCategories,
      elevatedLessons,
      highSeverityLessons,
    };
  }

  /** Returns all approved lessons without LIMIT for reporting */
  private async getAllLessonsUnbounded(): Promise<LessonLearned[]> {
    const rows = await databaseService.query<any>(
      'SELECT * FROM lessons_learned WHERE status IN (?, ?) ORDER BY is_elevated DESC, confidence DESC',
      ['approved', 'reviewed'],
    );
    return rows.map(rowToLesson);
  }

  // ── Recurrence calculation (embedding similarity) ───────────────────────

  private async checkRecurrence(lesson: LessonLearned): Promise<void> {
    if (!ragService.isAvailable()) return;

    try {
      const similar = await ragService.search(
        [lesson.title, lesson.rootCause || '', lesson.recommendation].join(' | '),
        { documentType: 'lesson', topK: 5 },
      );

      // Count similar lessons (score >= 0.85) from different projects
      const highSimilarity = similar.filter(
        r => r.score >= 0.85 && r.document && (r.document as LessonLearned).id !== lesson.id,
      );
      if (highSimilarity.length === 0) return;

      const distinctProjects = new Set(
        highSimilarity.map(r => (r.document as LessonLearned).projectId),
      );
      // Don't count the current lesson's own project
      distinctProjects.delete(lesson.projectId);

      const recurrenceCount = highSimilarity.length;
      const score = Math.min(100, recurrenceCount * 25); // 25 per match, cap at 100

      // Update recurrence score on the current lesson
      await databaseService.query(
        'UPDATE lessons_learned SET recurrence_score = ? WHERE id = ? AND recurrence_score < ?',
        [score, lesson.id, score],
      );

      // Auto-flag for elevation when recurrence >= 3 across 2+ distinct projects
      if (recurrenceCount >= 3 && distinctProjects.size >= 2) {
        await databaseService.query(
          `UPDATE lessons_learned SET status = 'pending_elevation' WHERE id = ? AND status = 'approved' AND is_elevated = 0`,
          [lesson.id],
        );
        logger.info(`[Recurrence] Lesson ${lesson.id} flagged for elevation (recurrence=${recurrenceCount}, projects=${distinctProjects.size})`);
      }
    } catch (err) {
      logger.warn(`[Recurrence] Check failed for lesson ${lesson.id}:`, (err as Error).message);
    }
  }

  // ── Feedback ─────────────────────────────────────────────────────────────

  async submitFeedback(lessonId: string, userId: number, action: 'helpful' | 'dismissed' | 'outdated', comment?: string, context?: string): Promise<void> {
    // Upsert: one feedback per user per lesson (last action wins)
    const existing = await databaseService.query<any>(
      'SELECT id FROM lesson_feedback WHERE lesson_id = ? AND user_id = ?',
      [lessonId, userId],
    );
    if (existing.length > 0) {
      await databaseService.query(
        'UPDATE lesson_feedback SET action = ?, comment = ?, context = ?, created_at = NOW() WHERE id = ?',
        [action, comment ?? null, context ?? null, existing[0].id],
      );
    } else {
      await databaseService.query(
        'INSERT INTO lesson_feedback (id, lesson_id, user_id, action, comment, context) VALUES (?, ?, ?, ?, ?, ?)',
        [randomUUID(), lessonId, userId, action, comment ?? null, context ?? null],
      );
    }
  }

  async getFeedbackCounts(lessonId: string): Promise<{ helpful: number; dismissed: number; outdated: number }> {
    const rows = await databaseService.query<{ action: string; cnt: number }>(
      'SELECT action, COUNT(*) as cnt FROM lesson_feedback WHERE lesson_id = ? GROUP BY action',
      [lessonId],
    );
    const counts = { helpful: 0, dismissed: 0, outdated: 0 };
    for (const row of rows) {
      if (row.action in counts) counts[row.action as keyof typeof counts] = Number(row.cnt);
    }
    return counts;
  }

  async getUserFeedback(lessonId: string, userId: number): Promise<string | null> {
    const rows = await databaseService.query<{ action: string }>(
      'SELECT action FROM lesson_feedback WHERE lesson_id = ? AND user_id = ?',
      [lessonId, userId],
    );
    return rows[0]?.action ?? null;
  }

  async deleteLesson(id: string): Promise<boolean> {
    const result = await databaseService.query<any>('DELETE FROM lessons_learned WHERE id = ?', [id]);
    const deleted = (result as any).affectedRows > 0;

    // Remove embedding (fire-and-forget)
    if (deleted) {
      embeddingService.deleteEmbedding('lesson', id).catch((err) => {
        logger.error(`[RAG] Failed to delete embedding for lesson ${id}:`, (err as Error).message);
      });
    }

    return deleted;
  }
}

export const lessonsLearnedService = new LessonsLearnedService();
