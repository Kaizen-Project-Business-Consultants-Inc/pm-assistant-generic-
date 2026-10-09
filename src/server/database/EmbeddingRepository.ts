import { databaseService } from './connection';
import type { EmbeddingRow } from '../services/EmbeddingService';
import { chunksOf } from '../utils/chunksOf';

class EmbeddingRepository {
  async findByDocument(documentType: string, documentId: string): Promise<EmbeddingRow[]> {
    return databaseService.queryControlPlane<EmbeddingRow>(
      'SELECT id, content_hash FROM embeddings WHERE document_type = ? AND document_id = ?',
      [documentType, documentId],
    );
  }

  upsert(
    id: string, documentType: string, documentId: string, contentHash: string,
    embedding: string, model: string, dimensions: number,
  ): Promise<any> {
    return databaseService.queryControlPlane(
      `INSERT INTO embeddings (id, document_type, document_id, content_hash, embedding, model, dimensions)
       VALUES (?, ?, ?, ?, VEC_FromText(?), ?, ?)
       ON DUPLICATE KEY UPDATE content_hash = VALUES(content_hash), embedding = VALUES(embedding), model = VALUES(model), dimensions = VALUES(dimensions)`,
      [id, documentType, documentId, contentHash, embedding, model, dimensions],
    );
  }

  async searchSimilar(
    queryVector: string,
    documentType?: string,
    topK = 5,
    minScore = 0.5,
  ): Promise<Array<{ document_type: string; document_id: string; score: number }>> {
    let sql = `SELECT document_type, document_id,
                      (1 - VEC_DISTANCE_COSINE(embedding, VEC_FromText(?))) AS score
               FROM embeddings`;
    const params: any[] = [queryVector];

    if (documentType) {
      sql += ' WHERE document_type = ?';
      params.push(documentType);
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
    for (const chunk of chunksOf(documentIds, 500)) {
      // eslint-disable-next-line no-await-in-loop -- one statement per 500 ids
      await databaseService.queryControlPlane(
        `DELETE FROM embeddings WHERE document_type = ? AND document_id IN (${chunk.map(() => '?').join(',')})`,
        [documentType, ...chunk],
      );
    }
  }

  delete(documentType: string, documentId: string): Promise<any> {
    return databaseService.queryControlPlane(
      'DELETE FROM embeddings WHERE document_type = ? AND document_id = ?',
      [documentType, documentId],
    );
  }
}

export const embeddingRepository = new EmbeddingRepository();
