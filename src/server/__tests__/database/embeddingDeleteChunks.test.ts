import { describe, it, expect, vi, beforeEach } from 'vitest';

/** RAG-2 (2026-10-19): deleting a document removes every piece of it, however many there are */
const db = vi.hoisted(() => ({ sql: [] as Array<{ sql: string; params: any[] }> }));
vi.mock('../../database/connection', () => ({
  databaseService: {
    queryControlPlane: vi.fn(async (sql: string, params: any[] = []) => { db.sql.push({ sql, params }); return []; }),
  },
}));
vi.mock('../../config', () => ({ config: { MULTI_TENANT_ENABLED: false } }));

import { embeddingRepository } from '../../database/EmbeddingRepository';

beforeEach(() => { db.sql = []; });

describe('embeddingRepository.searchSimilar', () => {
  it('a search across types never includes project documents (searched per project only)', async () => {
    await embeddingRepository.searchSimilar('[0.1]');
    expect(db.sql[0].sql).toContain("AND document_type <> 'project_document'");
  });

  it('the project-document search asks for that type only', async () => {
    await embeddingRepository.searchSimilar('[0.1]', 'project_document');
    expect(db.sql[0].sql).toContain('AND document_type = ?');
    expect(db.sql[0].sql).not.toContain('<>');
  });
});

describe('embeddingRepository.deleteChunks', () => {
  it('one delete matching every <id>_chunk_<n>, with LIKE wildcards in the id escaped', async () => {
    await embeddingRepository.deleteChunks('project_document', 'doc_1%');
    expect(db.sql).toHaveLength(1);
    expect(db.sql[0].sql).toMatch(/^DELETE FROM embeddings WHERE org_id = \? AND document_type = \? AND document_id LIKE \?$/);
    expect(db.sql[0].params).toEqual(['', 'project_document', 'doc\\_1\\%\\_chunk\\_%']);
  });

  it('keeps the pieces still in use (a re-analysed document)', async () => {
    await embeddingRepository.deleteChunks('project_document', 'd1', ['d1_chunk_0', 'd1_chunk_1']);
    expect(db.sql[0].sql).toContain('AND document_id NOT IN (?,?)');
    expect(db.sql[0].params).toEqual(['', 'project_document', 'd1\\_chunk\\_%', 'd1_chunk_0', 'd1_chunk_1']);
  });
});
