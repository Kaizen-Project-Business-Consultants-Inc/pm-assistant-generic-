import { databaseService } from '../../database/connection';
import { ragService } from '../RagService';
import { embeddingService } from '../EmbeddingService';
import logger from '../../utils/logger';
import {
  type LessonLearned,
  type Pattern,
  type MitigationSuggestion,
  type KnowledgeBaseOverview,
} from '../../schemas/lessonsLearnedSchemas';
import { seedFromProjects } from './seeder';
import { extractLessons } from './extractor';
import { detectPatterns } from './patternDetector';
import { suggestMitigations, type SuggestionField } from './mitigationAdvisor';

// ── Row mapper ────────────────────────────────────────────────────────────

function rowToLesson(row: any): LessonLearned {
  let tags: string[] | null = null;
  if (row.tags) {
    try { tags = typeof row.tags === 'string' ? JSON.parse(row.tags) : row.tags; } catch { tags = null; }
  }
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
    confidence: row.confidence,
    status: row.status ?? 'approved',
    createdBy: row.created_by ?? null,
    sourceType: row.source_type ?? 'manual',
    tags,
    appliedCount: row.applied_count ?? 0,
    effectivenessRating: row.effectiveness_rating ?? null,
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
      `INSERT INTO lessons_learned (id, project_id, project_name, project_type, category, title, description, impact, recommendation, confidence, status, created_by, source_type, tags, applied_count, effectiveness_rating, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
       ON DUPLICATE KEY UPDATE title = VALUES(title), description = VALUES(description), recommendation = VALUES(recommendation), confidence = VALUES(confidence)`,
      [
        lesson.id, lesson.projectId, lesson.projectName, lesson.projectType,
        lesson.category, lesson.title, lesson.description, lesson.impact,
        lesson.recommendation, lesson.confidence,
        lesson.status ?? 'approved',
        lesson.createdBy ?? null,
        lesson.sourceType ?? 'manual',
        lesson.tags ? JSON.stringify(lesson.tags) : null,
        lesson.appliedCount ?? 0,
        lesson.effectivenessRating ?? null,
        lesson.createdAt,
      ],
    );

    ragService.indexLesson(lesson).catch((err) => {
      logger.error(`[RAG] Failed to index lesson ${lesson.id}:`, (err as Error).message);
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

  async findRelevantLessons(projectType?: string, category?: string): Promise<LessonLearned[]> {
    let sql = 'SELECT * FROM lessons_learned WHERE status = ?';
    const params: any[] = ['approved'];
    if (projectType) { sql += ' AND project_type = ?'; params.push(projectType); }
    if (category) { sql += ' AND category = ?'; params.push(category); }
    sql += ' ORDER BY confidence DESC';
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

  async updateStatus(id: string, status: 'draft' | 'reviewed' | 'approved' | 'archived'): Promise<boolean> {
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
      confidence: data.confidence ?? 80,
      status: data.status ?? (data.sourceType === 'manual' ? 'approved' : 'draft'),
      createdBy: data.createdBy ?? null,
      sourceType: data.sourceType ?? 'manual',
      tags: data.tags ?? null,
      appliedCount: 0,
      effectivenessRating: null,
      createdAt: new Date().toISOString(),
    };
    await this.persistLesson(lesson);
    return lesson;
  }

  async getLessons(limit = 20, offset = 0): Promise<LessonLearned[]> {
    const rows = await databaseService.query<any>(
      'SELECT * FROM lessons_learned ORDER BY created_at DESC LIMIT ? OFFSET ?',
      [limit, offset],
    );
    return rows.map(rowToLesson);
  }

  async countLessons(): Promise<number> {
    const rows = await databaseService.query<{ cnt: number }>(
      'SELECT COUNT(*) as cnt FROM lessons_learned',
    );
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

  async updateLesson(id: string, data: { title?: string; description?: string; category?: string; impact?: string; recommendation?: string; tags?: string[]; status?: string }): Promise<boolean> {
    const fields: string[] = [];
    const values: any[] = [];
    if (data.title !== undefined) { fields.push('title = ?'); values.push(data.title); }
    if (data.description !== undefined) { fields.push('description = ?'); values.push(data.description); }
    if (data.category !== undefined) { fields.push('category = ?'); values.push(data.category); }
    if (data.impact !== undefined) { fields.push('impact = ?'); values.push(data.impact); }
    if (data.recommendation !== undefined) { fields.push('recommendation = ?'); values.push(data.recommendation); }
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
