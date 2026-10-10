import { describe, it, expect, vi } from 'vitest';

/**
 * 2026-10-10 review of audit M5: after migration 134 the backfill ran with no company (the owner
 * check throws) and joined a company table to the shared embeddings with no owner. It now does each
 * company in its own context, skips what THAT company already has, and writes under that company.
 */
vi.mock('../../config', () => ({ config: { MULTI_TENANT_ENABLED: true } }));
vi.mock('../../database/connection', () => ({
  databaseService: {
    queryControlPlane: vi.fn(async (sql: string, params: unknown[] = []) => {
      if (/FROM organizations/.test(sql)) return [{ id: 'org-a', db_name: 'pmassist_t_a', name: 'A' }, { id: 'org-b', db_name: 'pmassist_t_b', name: 'B' }];
      // org-a already has lesson l1 embedded
      if (/FROM embeddings/.test(sql)) return params[0] === 'org-a' ? [{ document_type: 'lesson', document_id: 'l1' }] : [];
      return [];
    }),
    query: vi.fn(async (sql: string) => {
      const { getRequestContext } = await import('../../middleware/requestContext');
      const db = getRequestContext()?.tenantDbName;
      if (/FROM lessons_learned/.test(sql)) return db === 'pmassist_t_a' ? [{ id: 'l1' }, { id: 'l2' }] : [{ id: 'l1' }];
      if (/FROM meeting_analyses/.test(sql)) return db === 'pmassist_t_b' ? [{ id: 'm1', action_items: '[]' }] : [];
      return [];
    }),
  },
}));
vi.mock('../../services/RagService', () => ({ RagService: class {} }));
vi.mock('../../services/EmbeddingService', () => ({ EmbeddingService: class {} }));

import { backfillAll } from '../../scripts/backfillEmbeddings';
import { getRequestContext } from '../../middleware/requestContext';

describe('embeddings backfill, company by company', () => {
  it('indexes what each company is missing, inside that company', async () => {
    const seen: string[] = [];
    const rag = {
      indexLesson: vi.fn(async (l: { id: string }) => { seen.push(`${getRequestContext()?.organizationId}:lesson:${l.id}`); }),
      indexMeeting: vi.fn(async (m: { id: string }) => { seen.push(`${getRequestContext()?.organizationId}:meeting:${m.id}`); }),
    } as any;
    vi.spyOn(console, 'log').mockImplementation(() => {});
    await backfillAll(rag);
    // A's l1 is already there; B's l1 is a different lesson in another company and is indexed
    expect(seen.sort()).toEqual(['org-a:lesson:l2', 'org-b:lesson:l1', 'org-b:meeting:m1']);
  });
});
