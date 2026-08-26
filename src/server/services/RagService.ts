import { databaseService } from '../database/connection';
import { embeddingService as embeddingServiceSingleton, EmbeddingService, type SimilarityResult, type EmbeddingDocumentType } from './EmbeddingService';
import type { LessonLearned } from '../schemas/lessonsLearnedSchemas';
import type { MeetingAnalysis } from '../schemas/meetingSchemas';
import logger from '../utils/logger';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface RagResult {
  documentType: EmbeddingDocumentType;
  documentId: string;
  score: number;
  document: LessonLearned | MeetingAnalysis | null;
}

export interface RagSearchOptions {
  documentType?: EmbeddingDocumentType;
  topK?: number;
  threshold?: number;
}

// ---------------------------------------------------------------------------
// RagService
// ---------------------------------------------------------------------------

export class RagService {
  private embeddingService: EmbeddingService;

  constructor(embeddingService?: EmbeddingService) {
    this.embeddingService = embeddingService ?? embeddingServiceSingleton;
  }

  isAvailable(): boolean {
    return this.embeddingService.isAvailable();
  }

  // -------------------------------------------------------------------------
  // Index a lesson learned
  // -------------------------------------------------------------------------

  async indexLesson(lesson: LessonLearned): Promise<void> {
    if (!this.isAvailable()) return;

    const text = this.lessonToText(lesson);
    try {
      await this.embeddingService.upsertEmbedding('lesson', lesson.id, text);
    } catch (err) {
      logger.error(`Failed to index lesson ${lesson.id}:`, err);
    }
  }

  // -------------------------------------------------------------------------
  // Index a meeting analysis
  // -------------------------------------------------------------------------

  async indexMeeting(analysis: MeetingAnalysis): Promise<void> {
    if (!this.isAvailable()) return;

    const text = this.meetingToText(analysis);
    try {
      await this.embeddingService.upsertEmbedding('meeting', analysis.id, text);
    } catch (err) {
      logger.error(`Failed to index meeting ${analysis.id}:`, err);
    }
  }

  // -------------------------------------------------------------------------
  // Search and enrich with full documents
  // -------------------------------------------------------------------------

  async search(query: string, options?: RagSearchOptions): Promise<RagResult[]> {
    if (!this.isAvailable()) return [];

    const similar = await this.embeddingService.searchSimilar(
      query,
      options?.documentType,
      options?.topK,
      options?.threshold,
    );

    return this.enrichResults(similar);
  }

  // -------------------------------------------------------------------------
  // Build a context string for AI prompts
  // -------------------------------------------------------------------------

  async buildContextString(query: string, topK?: number): Promise<string> {
    const results = await this.search(query, { topK });
    if (results.length === 0) return '';

    const parts: string[] = ['## Relevant Historical Context\n'];

    for (const result of results) {
      if (!result.document) continue;

      if (result.documentType === 'lesson') {
        const lesson = result.document as LessonLearned;
        parts.push(
          `### Lesson: ${lesson.title} (score: ${result.score.toFixed(2)})`,
          `- Category: ${lesson.category} | Impact: ${lesson.impact} | Project: ${lesson.projectName} (${lesson.projectType})`,
          `- ${lesson.description}`,
          `- Recommendation: ${lesson.recommendation}`,
          '',
        );
      } else {
        const meeting = result.document as MeetingAnalysis;
        parts.push(
          `### Meeting Analysis (score: ${result.score.toFixed(2)})`,
          `- Summary: ${meeting.summary}`,
          `- Decisions: ${meeting.decisions.map((d) => d.decision).join('; ') || 'None'}`,
          `- Risks: ${meeting.risks.map((r) => r.description).join('; ') || 'None'}`,
          '',
        );
      }
    }

    return parts.join('\n');
  }

  // -------------------------------------------------------------------------
  // Private helpers
  // -------------------------------------------------------------------------

  private lessonToText(lesson: LessonLearned): string {
    return [
      lesson.category,
      lesson.impact,
      lesson.projectType,
      lesson.title,
      lesson.description,
      lesson.recommendation,
    ].join(' | ');
  }

  private meetingToText(analysis: MeetingAnalysis): string {
    return [
      analysis.summary,
      analysis.decisions.map((d) => d.decision).join('; '),
      analysis.risks.map((r) => r.description).join('; '),
      analysis.actionItems.map((a) => a.description).join('; '),
    ].join(' | ');
  }

  private async enrichResults(similar: SimilarityResult[]): Promise<RagResult[]> {
    if (similar.length === 0) return [];

    // Collect IDs by document type
    const lessonIds = similar.filter(s => s.documentType === 'lesson').map(s => s.documentId);
    const meetingIds = similar.filter(s => s.documentType === 'meeting').map(s => s.documentId);

    // Batch fetch — at most 2 queries instead of N
    const lessonMap = new Map<string, LessonLearned>();
    const meetingMap = new Map<string, MeetingAnalysis>();

    if (lessonIds.length > 0) {
      const placeholders = lessonIds.map(() => '?').join(', ');
      const rows = await databaseService.query<any>(
        `SELECT * FROM lessons_learned WHERE id IN (${placeholders})`,
        lessonIds,
      );
      for (const row of rows) {
        lessonMap.set(row.id, this.rowToLesson(row));
      }
    }

    if (meetingIds.length > 0) {
      const placeholders = meetingIds.map(() => '?').join(', ');
      const rows = await databaseService.query<any>(
        `SELECT * FROM meeting_analyses WHERE id IN (${placeholders})`,
        meetingIds,
      );
      for (const row of rows) {
        meetingMap.set(row.id, this.rowToMeetingAnalysis(row));
      }
    }

    return similar.map(item => ({
      documentType: item.documentType,
      documentId: item.documentId,
      score: item.score,
      document: item.documentType === 'lesson'
        ? lessonMap.get(item.documentId) ?? null
        : meetingMap.get(item.documentId) ?? null,
    }));
  }

  private rowToLesson(row: any): LessonLearned {
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

  private rowToMeetingAnalysis(row: any): MeetingAnalysis {
    const parseJson = (val: any) => {
      if (typeof val === 'string') return JSON.parse(val);
      return val ?? [];
    };

    return {
      id: row.id,
      projectId: row.project_id,
      scheduleId: row.schedule_id,
      transcript: row.transcript,
      summary: row.summary,
      actionItems: parseJson(row.action_items),
      decisions: parseJson(row.decisions),
      risks: parseJson(row.risks),
      issues: parseJson(row.issues),
      dependencies: parseJson(row.dependencies),
      taskUpdates: parseJson(row.task_updates),
      appliedItems: parseJson(row.applied_items),
      createdAt: row.created_at instanceof Date ? row.created_at.toISOString() : String(row.created_at),
    };
  }
}

export const ragService = new RagService();
