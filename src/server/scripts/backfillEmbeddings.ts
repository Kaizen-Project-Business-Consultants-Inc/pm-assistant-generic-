/**
 * Backfill: embeds every lesson and meeting analysis that has no embedding yet, company by company.
 *
 * Embeddings live in the SHARED `embeddings` table with an owner (`org_id`, migration 134), while
 * lessons and meetings live in each company's own database. So each company is done inside its own
 * context (runWithTenantContext): its rows are read from its database, the ids it already has are
 * read from the shared table for THAT company, and new rows are written under that company
 * (EmbeddingRepository takes the owner from the context). Until 2026-10-10 the script joined a
 * company table to `embeddings` in one query with no company at all.
 *
 * Usage:
 *   npx tsx src/server/scripts/backfillEmbeddings.ts
 */

import { databaseService } from '../database/connection';
import { config } from '../config';
import { runWithTenantContext } from '../middleware/requestContext';
import { EmbeddingService } from '../services/EmbeddingService';
import { RagService } from '../services/RagService';
import type { LessonLearned } from '../schemas/lessonsLearnedSchemas';
import type { MeetingAnalysis } from '../schemas/meetingSchemas';

function toLesson(row: any): LessonLearned {
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
    sourceArtifacts: null,
    confidence: row.confidence,
    status: row.status ?? 'approved',
    createdBy: row.created_by ?? null,
    sourceType: row.source_type ?? 'manual',
    tags: null,
    appliedCount: row.applied_count ?? 0,
    effectivenessRating: row.effectiveness_rating ?? null,
    helpfulCount: 0,
    dismissedCount: 0,
    createdAt: row.created_at instanceof Date ? row.created_at.toISOString() : String(row.created_at),
  };
}

function toMeeting(row: any): MeetingAnalysis {
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

/** One company (the current context): index what it has that isn't embedded yet */
export async function backfillCompany(ragService: RagService, orgId: string): Promise<{ lessons: number; meetings: number }> {
  const have = await databaseService.queryControlPlane<{ document_type: string; document_id: string }>(
    `SELECT document_type, document_id FROM embeddings WHERE org_id = ? AND document_type IN ('lesson', 'meeting')`,
    [orgId],
  );
  const done = new Set(have.map(r => `${r.document_type}:${r.document_id}`));
  const lessons = (await databaseService.query<any>('SELECT * FROM lessons_learned')).filter(r => !done.has(`lesson:${r.id}`));
  const meetings = (await databaseService.query<any>('SELECT * FROM meeting_analyses')).filter(r => !done.has(`meeting:${r.id}`));

  let lessonCount = 0;
  for (const row of lessons) {
    try {
      // eslint-disable-next-line no-await-in-loop -- one-off script: the embeddings API is rate-limited, so lessons are indexed one by one
      await ragService.indexLesson(toLesson(row));
      lessonCount++;
    } catch (err) {
      console.error(`  Failed to index lesson ${row.id}:`, err);
    }
  }
  let meetingCount = 0;
  for (const row of meetings) {
    try {
      // eslint-disable-next-line no-await-in-loop -- one-off script: the embeddings API is rate-limited, so meetings are indexed one by one
      await ragService.indexMeeting(toMeeting(row));
      meetingCount++;
    } catch (err) {
      console.error(`  Failed to index meeting ${row.id}:`, err);
    }
  }
  return { lessons: lessonCount, meetings: meetingCount };
}

/** Every active, provisioned company, each in its own context (one company on a single-company install) */
export async function backfillAll(ragService: RagService): Promise<void> {
  if (!config.MULTI_TENANT_ENABLED) {
    const n = await backfillCompany(ragService, '');
    console.log(`Indexed ${n.lessons} lessons and ${n.meetings} meetings`);
    return;
  }
  const orgs = await databaseService.queryControlPlane<{ id: string; db_name: string; name: string }>(
    'SELECT id, db_name, name FROM organizations WHERE is_provisioned = 1 AND is_active = 1',
  );
  for (const org of orgs) {
    try {
      // eslint-disable-next-line no-await-in-loop -- one company at a time: each switches the company database
      const n = await runWithTenantContext(org.db_name, org.id, () => backfillCompany(ragService, org.id));
      console.log(`  ${org.name}: ${n.lessons} lessons, ${n.meetings} meetings`);
    } catch (err: any) {
      console.error(`  ! ${org.name}: ${err?.message}`);
    }
  }
}

async function main() {
  const embeddingService = new EmbeddingService();
  if (!embeddingService.isAvailable()) {
    console.error('Embedding service is not available. Set OPENAI_API_KEY and EMBEDDING_ENABLED=true.');
    process.exit(1);
  }
  await backfillAll(new RagService(embeddingService));
  console.log('Backfill complete.');
  await databaseService.close();
  process.exit(0);
}

if (require.main === module) {
  main().catch((err) => {
    console.error('Backfill failed:', err);
    process.exit(1);
  });
}
