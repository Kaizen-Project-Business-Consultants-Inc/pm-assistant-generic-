/**
 * One-time backfill script: generates embeddings for all lessons_learned
 * and meeting_analyses rows that don't yet have an embedding.
 *
 * Usage:
 *   npx tsx src/server/scripts/backfillEmbeddings.ts
 */

import { databaseService } from '../database/connection';
import { EmbeddingService } from '../services/EmbeddingService';
import { RagService } from '../services/RagService';
import type { LessonLearned } from '../schemas/lessonsLearnedSchemas';
import type { MeetingAnalysis } from '../schemas/meetingSchemas';

async function backfill() {
  const embeddingService = new EmbeddingService();
  const ragService = new RagService(embeddingService);

  if (!embeddingService.isAvailable()) {
    console.error('Embedding service is not available. Set OPENAI_API_KEY and EMBEDDING_ENABLED=true.');
    process.exit(1);
  }

  // Find lessons without embeddings
  const lessonsToIndex = await databaseService.query<any>(
    `SELECT ll.* FROM lessons_learned ll
     LEFT JOIN embeddings e ON e.document_type = 'lesson' AND e.document_id = ll.id
     WHERE e.id IS NULL`,
  );

  console.log(`Found ${lessonsToIndex.length} lessons without embeddings`);

  let indexed = 0;
  for (const row of lessonsToIndex) {
    const lesson: LessonLearned = {
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
      tags: null,
      appliedCount: row.applied_count ?? 0,
      effectivenessRating: row.effectiveness_rating ?? null,
      createdAt: row.created_at instanceof Date ? row.created_at.toISOString() : String(row.created_at),
    };

    try {
      await ragService.indexLesson(lesson);
      indexed++;
      if (indexed % 10 === 0) {
        console.log(`  Indexed ${indexed}/${lessonsToIndex.length} lessons`);
      }
    } catch (err) {
      console.error(`  Failed to index lesson ${lesson.id}:`, err);
    }
  }

  console.log(`Indexed ${indexed} lessons`);

  // Find meetings without embeddings
  const meetingsToIndex = await databaseService.query<any>(
    `SELECT ma.* FROM meeting_analyses ma
     LEFT JOIN embeddings e ON e.document_type = 'meeting' AND e.document_id = ma.id
     WHERE e.id IS NULL`,
  );

  console.log(`Found ${meetingsToIndex.length} meetings without embeddings`);

  let meetingsIndexed = 0;
  for (const row of meetingsToIndex) {
    const parseJson = (val: any) => {
      if (typeof val === 'string') return JSON.parse(val);
      return val ?? [];
    };

    const analysis: MeetingAnalysis = {
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

    try {
      await ragService.indexMeeting(analysis);
      meetingsIndexed++;
      if (meetingsIndexed % 10 === 0) {
        console.log(`  Indexed ${meetingsIndexed}/${meetingsToIndex.length} meetings`);
      }
    } catch (err) {
      console.error(`  Failed to index meeting ${analysis.id}:`, err);
    }
  }

  console.log(`Indexed ${meetingsIndexed} meetings`);
  console.log('Backfill complete.');

  await databaseService.close();
  process.exit(0);
}

backfill().catch((err) => {
  console.error('Backfill failed:', err);
  process.exit(1);
});
