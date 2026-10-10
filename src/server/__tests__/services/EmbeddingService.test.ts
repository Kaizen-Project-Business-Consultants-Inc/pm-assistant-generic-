import { describe, it, expect, vi, beforeEach } from 'vitest';

// Mock database
vi.mock('../../database/connection', () => ({
  databaseService: {
    query: vi.fn().mockResolvedValue([]),
    queryControlPlane: vi.fn().mockResolvedValue([]),
  },
}));

const ctx = vi.hoisted(() => ({ value: undefined as { organizationId?: string } | undefined }));
vi.mock('../../middleware/requestContext', () => ({ getRequestContext: () => ctx.value }));

// Mock config
vi.mock('../../config', () => ({
  config: {
    MULTI_TENANT_ENABLED: false,
    OPENAI_API_KEY: 'sk-test-key',
    EMBEDDING_ENABLED: true,
    EMBEDDING_MODEL: 'text-embedding-3-small',
    EMBEDDING_DIMENSIONS: 1536,
    RAG_TOP_K: 5,
    RAG_SIMILARITY_THRESHOLD: 0.3,
  },
}));

import { EmbeddingService } from '../../services/EmbeddingService';
import { databaseService } from '../../database/connection';

// Helper: create a fake embedding vector
function fakeVector(dims: number, seed: number): number[] {
  const v = [];
  for (let i = 0; i < dims; i++) {
    v.push(Math.sin(seed + i));
  }
  return v;
}

describe('EmbeddingService', () => {
  let service: EmbeddingService;

  beforeEach(() => {
    service = new EmbeddingService();
    vi.clearAllMocks();
  });

  // --- cosineSimilarity ---
  describe('cosineSimilarity', () => {
    it('returns 1 for identical vectors', () => {
      const v = [1, 2, 3];
      expect(EmbeddingService.cosineSimilarity(v, v)).toBeCloseTo(1.0);
    });

    it('returns 0 for orthogonal vectors', () => {
      const a = [1, 0, 0];
      const b = [0, 1, 0];
      expect(EmbeddingService.cosineSimilarity(a, b)).toBeCloseTo(0.0);
    });

    it('returns -1 for opposite vectors', () => {
      const a = [1, 0, 0];
      const b = [-1, 0, 0];
      expect(EmbeddingService.cosineSimilarity(a, b)).toBeCloseTo(-1.0);
    });

    it('returns 0 for empty vectors', () => {
      expect(EmbeddingService.cosineSimilarity([], [])).toBe(0);
    });

    it('returns 0 for mismatched lengths', () => {
      expect(EmbeddingService.cosineSimilarity([1], [1, 2])).toBe(0);
    });

    it('handles zero vectors', () => {
      expect(EmbeddingService.cosineSimilarity([0, 0], [1, 1])).toBe(0);
    });
  });

  // --- isAvailable ---
  describe('isAvailable', () => {
    it('returns true when key and enabled are set', () => {
      expect(service.isAvailable()).toBe(true);
    });
  });

  // --- embed ---
  describe('embed', () => {
    it('returns vector from mocked fetch', async () => {
      const mockVector = fakeVector(8, 42);
      const mockResponse = {
        ok: true,
        json: vi.fn().mockResolvedValue({
          data: [{ embedding: mockVector }],
        }),
      };
      vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce(mockResponse as any);

      const result = await service.embed('test text');
      expect(result).toEqual(mockVector);
      expect(globalThis.fetch).toHaveBeenCalledWith(
        'https://api.openai.com/v1/embeddings',
        expect.objectContaining({ method: 'POST' }),
      );
    });

    it('throws on API error', async () => {
      const mockResponse = {
        ok: false,
        status: 429,
        text: vi.fn().mockResolvedValue('rate limited'),
      };
      vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce(mockResponse as any);

      await expect(service.embed('test')).rejects.toThrow('OpenAI embeddings API error 429');
    });
  });

  // --- upsertEmbedding ---
  describe('upsertEmbedding', () => {
    it('skips when content hash matches', async () => {
      const contentHash = 'dffd6021bb2bd5b0af676290809ec3a53191dd81c7f70a4b28688a362182986f'; // sha256 of 'Hello, World!'

      vi.mocked(databaseService.queryControlPlane).mockResolvedValueOnce([
        { id: 'existing-id', content_hash: contentHash },
      ] as any);

      const result = await service.upsertEmbedding('lesson', 'doc-1', 'Hello, World!');
      expect(result.skipped).toBe(true);
      expect(result.id).toBe('existing-id');
    });

    it('generates embedding and upserts when hash differs', async () => {
      vi.mocked(databaseService.queryControlPlane)
        .mockResolvedValueOnce([]) // no existing
        .mockResolvedValueOnce([] as any); // INSERT

      const mockVector = [0.1, 0.2, 0.3];
      vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce({
        ok: true,
        json: vi.fn().mockResolvedValue({
          data: [{ embedding: mockVector }],
        }),
      } as any);

      const result = await service.upsertEmbedding('lesson', 'doc-1', 'new text');
      expect(result.skipped).toBe(false);
      // Verify INSERT was called with VEC_FromText
      expect(databaseService.queryControlPlane).toHaveBeenCalledTimes(2);
      const insertCall = vi.mocked(databaseService.queryControlPlane).mock.calls[1];
      expect(insertCall[0]).toContain('VEC_FromText');
    });
  });

  // --- searchSimilar ---
  describe('searchSimilar', () => {
    it('returns results from SQL-based vector search', async () => {
      const queryVector = [1, 0, 0];

      // Mock embed call
      vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce({
        ok: true,
        json: vi.fn().mockResolvedValue({
          data: [{ embedding: queryVector }],
        }),
      } as any);

      // Mock DB query — SQL returns pre-scored results
      vi.mocked(databaseService.queryControlPlane).mockResolvedValueOnce([
        { document_type: 'lesson', document_id: 'good', score: 0.95 },
        { document_type: 'lesson', document_id: 'ok', score: 0.6 },
      ] as any);

      const results = await service.searchSimilar('test query', 'lesson', 5, 0.3);

      expect(results).toHaveLength(2);
      expect(results[0].documentId).toBe('good');
      expect(results[0].score).toBe(0.95);
      expect(results[1].documentId).toBe('ok');
      expect(results[1].score).toBe(0.6);

      // Verify SQL uses VEC_DISTANCE_COSINE
      const sqlCall = vi.mocked(databaseService.queryControlPlane).mock.calls[0];
      expect(sqlCall[0]).toContain('VEC_DISTANCE_COSINE');
      expect(sqlCall[0]).toContain('VEC_FromText');
    });

    it('passes documentType filter to SQL', async () => {
      vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce({
        ok: true,
        json: vi.fn().mockResolvedValue({ data: [{ embedding: [1, 0] }] }),
      } as any);

      vi.mocked(databaseService.queryControlPlane).mockResolvedValueOnce([] as any);

      await service.searchSimilar('test', 'meeting', 3, 0.5);

      const sqlCall = vi.mocked(databaseService.queryControlPlane).mock.calls[0];
      expect(sqlCall[0]).toContain('AND document_type = ?');
      expect(sqlCall[1]).toContain('meeting');
    });
  });

  // --- deleteEmbedding ---
  describe('deleteEmbedding', () => {
    it('calls DELETE query', async () => {
      vi.mocked(databaseService.queryControlPlane).mockResolvedValueOnce([] as any);
      await service.deleteEmbedding('lesson', 'doc-1');
      expect(databaseService.queryControlPlane).toHaveBeenCalledWith(
        'DELETE FROM embeddings WHERE org_id = ? AND document_type = ? AND document_id = ?',
        ['', 'lesson', 'doc-1'],
      );
    });
  });
});

/**
 * 2026-10-09 audit M5: every company's lessons, meeting notes and documents were ranked together
 * in the shared table. Each row now has an owner, and search sees only the caller's company plus
 * the shared knowledge base — in SQL, before the top K is taken.
 */
describe('embeddings belong to a company', () => {
  let service: EmbeddingService;
  const sqlOf = () => vi.mocked(databaseService.queryControlPlane).mock.calls[0];

  beforeEach(async () => {
    vi.clearAllMocks();
    (await import('../../config')).config.MULTI_TENANT_ENABLED = true;
    service = new EmbeddingService();
    vi.spyOn(globalThis, 'fetch').mockResolvedValue({ ok: true, json: vi.fn().mockResolvedValue({ data: [{ embedding: [1, 0] }] }) } as any);
  });

  it('a lesson search sees only the caller’s company', async () => {
    ctx.value = { organizationId: 'org-a' };
    vi.mocked(databaseService.queryControlPlane).mockResolvedValueOnce([] as any);
    await service.searchSimilar('late vendor', 'lesson', 5, 0.3);
    const [sql, params] = sqlOf();
    expect(sql).toContain('WHERE org_id IN (?)');
    expect(params).toEqual([expect.any(String), 'org-a', 'lesson', 0.3, 5]);
  });

  it('with no type: the caller’s company plus the shared knowledge base only', async () => {
    ctx.value = { organizationId: 'org-a' };
    vi.mocked(databaseService.queryControlPlane).mockResolvedValueOnce([] as any);
    await service.searchSimilar('anything');
    const [sql, params] = sqlOf();
    expect(sql).toContain("AND (org_id <> '' OR document_type = 'knowledge_base')");
    expect(params.slice(1, 3)).toEqual(['', 'org-a']);
  });

  it('a company search with no company in context finds nothing (no query at all)', async () => {
    ctx.value = undefined;
    expect(await service.searchSimilar('x', 'meeting')).toEqual([]);
    expect(databaseService.queryControlPlane).not.toHaveBeenCalled();
  });

  it('a lesson is stored under the caller’s company; with no company it is refused', async () => {
    ctx.value = { organizationId: 'org-b' };
    vi.mocked(databaseService.queryControlPlane).mockResolvedValue([] as any);
    await service.upsertEmbedding('lesson', 'l1', 'text');
    const insert = vi.mocked(databaseService.queryControlPlane).mock.calls.find(c => /INSERT INTO embeddings/.test(c[0] as string))!;
    expect((insert[1] as unknown[])[1]).toBe('org-b');
    ctx.value = undefined;
    await expect(service.upsertEmbedding('lesson', 'l2', 'text')).rejects.toThrow(/belongs to a company/);
  });

  it('the knowledge base stays shared, with or without a company', async () => {
    ctx.value = undefined;
    await service.deleteEmbedding('knowledge_base', 'kb1');
    expect(databaseService.queryControlPlane).toHaveBeenCalledWith(expect.stringContaining('DELETE FROM embeddings'), ['', 'knowledge_base', 'kb1']);
  });
});
