import { databaseService } from './connection';
import type { EmbeddingRow } from '../services/EmbeddingService';
import { chunksOf } from '../utils/chunksOf';
import { config } from '../config';
import { getRequestContext } from '../middleware/requestContext';

/**
 * Embeddings live in the shared database's `embeddings` table, and every row says whose it is
 * (`org_id`, migration 134): '' = shared by everyone (the Mjuzi knowledge base, and every row on a
 * single-company install); a company id = that company's lessons, meeting notes and documents.
 *
 * Until 2026-10-09 (audit M5) there was no owner: search ranked every company's vectors together,
 * so lesson searches returned other companies' ids and scores, and a company's own results were
 * crowded out of the top K. Every read and write is now limited to the caller's company (plus the
 * shared knowledge base) IN SQL, before the top K is taken. A company document type with no
 * company in context is refused (write) or finds nothing (read) — never shared, never another's.
 */
const SHARED = '';

class NoCompanyError extends Error {
  constructor(documentType: string) {
    super(`A ${documentType} embedding belongs to a company, and there is no company in this request`);
  }
}

/** Whose row this is: '' for the shared knowledge base, else the caller's company */
function ownerFor(documentType: string): string {
  if (documentType === 'knowledge_base' || !config.MULTI_TENANT_ENABLED) return SHARED;
  const org = getRequestContext()?.organizationId;
  if (!org) throw new NoCompanyError(documentType);
  return org;
}

/** The owners a search may see: the shared rows, plus the caller's company if there is one */
function visibleOwners(): string[] {
  if (!config.MULTI_TENANT_ENABLED) return [SHARED];
  const org = getRequestContext()?.organizationId;
  return org ? [SHARED, org] : [SHARED];
}

class EmbeddingRepository {
  async findByDocument(documentType: string, documentId: string): Promise<EmbeddingRow[]> {
    return databaseService.queryControlPlane<EmbeddingRow>(
      'SELECT id, content_hash FROM embeddings WHERE org_id = ? AND document_type = ? AND document_id = ?',
      [ownerFor(documentType), documentType, documentId],
    );
  }

  async upsert(
    id: string, documentType: string, documentId: string, contentHash: string,
    embedding: string, model: string, dimensions: number,
  ): Promise<any> {
    return databaseService.queryControlPlane(
      `INSERT INTO embeddings (id, org_id, document_type, document_id, content_hash, embedding, model, dimensions)
       VALUES (?, ?, ?, ?, ?, VEC_FromText(?), ?, ?)
       ON DUPLICATE KEY UPDATE content_hash = VALUES(content_hash), embedding = VALUES(embedding), model = VALUES(model), dimensions = VALUES(dimensions)`,
      [id, ownerFor(documentType), documentType, documentId, contentHash, embedding, model, dimensions],
    );
  }

  async searchSimilar(
    queryVector: string,
    documentType?: string,
    topK = 5,
    minScore = 0.5,
  ): Promise<Array<{ document_type: string; document_id: string; score: number }>> {
    let owners = visibleOwners();
    if (documentType) {
      // a company type with no company in context finds nothing
      if (documentType !== 'knowledge_base' && config.MULTI_TENANT_ENABLED) owners = owners.filter(o => o !== SHARED);
      if (owners.length === 0) return [];
    }
    let sql = `SELECT document_type, document_id,
                      (1 - VEC_DISTANCE_COSINE(embedding, VEC_FromText(?))) AS score
               FROM embeddings
               WHERE org_id IN (${owners.map(() => '?').join(',')})`;
    const params: any[] = [queryVector, ...owners];

    if (documentType) {
      sql += ' AND document_type = ?';
      params.push(documentType);
    } else if (config.MULTI_TENANT_ENABLED) {
      // the shared rows are only ever the knowledge base
      sql += ` AND (org_id <> '' OR document_type = 'knowledge_base')`;
    }

    sql += ' HAVING score >= ? ORDER BY score DESC LIMIT ?';
    params.push(minScore, topK);

    const rows = await databaseService.queryControlPlane<any>(sql, params);
    return rows.map((r: any) => ({
      document_type: r.document_type,
      document_id: r.document_id,
      score: Number(r.score),
    }));
  }

  /** Several documents' embeddings, 500 ids per statement */
  async deleteMany(documentType: string, documentIds: string[]): Promise<void> {
    const owner = ownerFor(documentType);
    for (const chunk of chunksOf(documentIds, 500)) {
      // eslint-disable-next-line no-await-in-loop -- one statement per 500 ids
      await databaseService.queryControlPlane(
        `DELETE FROM embeddings WHERE org_id = ? AND document_type = ? AND document_id IN (${chunk.map(() => '?').join(',')})`,
        [owner, documentType, ...chunk],
      );
    }
  }

  async delete(documentType: string, documentId: string): Promise<any> {
    return databaseService.queryControlPlane(
      'DELETE FROM embeddings WHERE org_id = ? AND document_type = ? AND document_id = ?',
      [ownerFor(documentType), documentType, documentId],
    );
  }
}

export const embeddingRepository = new EmbeddingRepository();
