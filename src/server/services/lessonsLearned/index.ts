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
    createdAt: row.created_at instanceof Date ? row.created_at.toISOString() : String(row.created_at),
  };
}

// ── Service ───────────────────────────────────────────────────────────────

export class LessonsLearnedService {
  private static patterns: Pattern[] = [];

  private async persistLesson(lesson: LessonLearned): Promise<void> {
    await databaseService.query(
      `INSERT INTO lessons_learned (id, project_id, project_name, project_type, category, title, description, impact, recommendation, confidence, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
       ON DUPLICATE KEY UPDATE title = VALUES(title), description = VALUES(description), recommendation = VALUES(recommendation), confidence = VALUES(confidence)`,
      [
        lesson.id, lesson.projectId, lesson.projectName, lesson.projectType,
        lesson.category, lesson.title, lesson.description, lesson.impact,
        lesson.recommendation, lesson.confidence, lesson.createdAt,
      ],
    );

    ragService.indexLesson(lesson).catch((err) => {
      logger.error(`[RAG] Failed to index lesson ${lesson.id}:`, (err as Error).message);
    });
  }

  async seedFromProjects(): Promise<number> {
    return seedFromProjects(this.persistLesson.bind(this));
  }

  async extractLessons(projectId: string, _userId?: string): Promise<LessonLearned[]> {
    return extractLessons(projectId, this.persistLesson.bind(this));
  }

  async getKnowledgeBase(): Promise<KnowledgeBaseOverview> {
    const lessons = await this.getAllLessons();
    const patterns = LessonsLearnedService.patterns;

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
    let sql = 'SELECT * FROM lessons_learned WHERE 1=1';
    const params: any[] = [];
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
    return detectPatterns(lessons, (p) => { LessonsLearnedService.patterns = p; });
  }

  async suggestMitigations(riskDescription: string, projectType: string, _userId?: string, field: SuggestionField = 'mitigation'): Promise<MitigationSuggestion[]> {
    return suggestMitigations(
      riskDescription,
      projectType,
      this.getAllLessons.bind(this),
      this.findSimilarLessons.bind(this),
      field,
    );
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

  private async getAllLessons(): Promise<LessonLearned[]> {
    const rows = await databaseService.query<any>(
      'SELECT * FROM lessons_learned ORDER BY created_at DESC LIMIT 1000',
    );
    return rows.map(rowToLesson);
  }

  async updateLesson(id: string, data: { title?: string; description?: string; category?: string; impact?: string; recommendation?: string }): Promise<boolean> {
    const fields: string[] = [];
    const values: any[] = [];
    if (data.title !== undefined) { fields.push('title = ?'); values.push(data.title); }
    if (data.description !== undefined) { fields.push('description = ?'); values.push(data.description); }
    if (data.category !== undefined) { fields.push('category = ?'); values.push(data.category); }
    if (data.impact !== undefined) { fields.push('impact = ?'); values.push(data.impact); }
    if (data.recommendation !== undefined) { fields.push('recommendation = ?'); values.push(data.recommendation); }
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
