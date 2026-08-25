import { createHash, randomUUID } from 'crypto';
import { config } from '../config';
import { embeddingRepository } from '../database/EmbeddingRepository';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type EmbeddingDocumentType = 'lesson' | 'meeting' | 'knowledge_base';

export interface EmbeddingRow {
  id: string;
  document_type: EmbeddingDocumentType;
  document_id: string;
  content_hash: string;
  embedding: string; // BLOB from DB
  model: string;
  dimensions: number;
  created_at: string;
}

export interface SimilarityResult {
  documentType: EmbeddingDocumentType;
  documentId: string;
  score: number;
}

// ---------------------------------------------------------------------------
// EmbeddingService
// ---------------------------------------------------------------------------

export class EmbeddingService {
  isAvailable(): boolean {
    return !!(config.EMBEDDING_ENABLED && config.OPENAI_API_KEY);
  }

  // -------------------------------------------------------------------------
  // Generate an embedding vector via OpenAI
  // -------------------------------------------------------------------------

  async embed(text: string): Promise<number[]> {
    if (!this.isAvailable()) {
      throw new Error('Embedding service is not available (OPENAI_API_KEY or EMBEDDING_ENABLED missing)');
    }

    const response = await fetch('https://api.openai.com/v1/embeddings', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${config.OPENAI_API_KEY}`,
      },
      body: JSON.stringify({
        input: text,
        model: config.EMBEDDING_MODEL,
        dimensions: config.EMBEDDING_DIMENSIONS,
      }),
    });

    if (!response.ok) {
      const body = await response.text();
      throw new Error(`OpenAI embeddings API error ${response.status}: ${body}`);
    }

    const json = (await response.json()) as {
      data: Array<{ embedding: number[] }>;
    };

    return json.data[0].embedding;
  }

  // -------------------------------------------------------------------------
  // Upsert an embedding (skip if content hash unchanged)
  // -------------------------------------------------------------------------

  async upsertEmbedding(
    documentType: EmbeddingDocumentType,
    documentId: string,
    text: string,
  ): Promise<{ id: string; skipped: boolean }> {
    const contentHash = createHash('sha256').update(text).digest('hex');

    // Check for existing embedding with same content hash
    const existing = await embeddingRepository.findByDocument(documentType, documentId);

    if (existing.length > 0 && existing[0].content_hash === contentHash) {
      return { id: existing[0].id, skipped: true };
    }

    const vector = await this.embed(text);
    const id = existing.length > 0 ? existing[0].id : randomUUID();

    await embeddingRepository.upsert(
      id,
      documentType,
      documentId,
      contentHash,
      JSON.stringify(vector),
      config.EMBEDDING_MODEL,
      config.EMBEDDING_DIMENSIONS,
    );

    return { id, skipped: false };
  }

  // -------------------------------------------------------------------------
  // Search for similar documents (SQL-based via VEC_DISTANCE_COSINE)
  // -------------------------------------------------------------------------

  async searchSimilar(
    query: string,
    documentType?: EmbeddingDocumentType,
    topK?: number,
    threshold?: number,
  ): Promise<SimilarityResult[]> {
    const k = topK ?? config.RAG_TOP_K;
    const minScore = threshold ?? config.RAG_SIMILARITY_THRESHOLD;

    const queryVector = await this.embed(query);

    const rows = await embeddingRepository.searchSimilar(
      JSON.stringify(queryVector),
      documentType,
      k,
      minScore,
    );

    return rows.map(row => ({
      documentType: row.document_type as EmbeddingDocumentType,
      documentId: row.document_id,
      score: row.score,
    }));
  }

  // -------------------------------------------------------------------------
  // Delete an embedding
  // -------------------------------------------------------------------------

  async deleteEmbedding(documentType: EmbeddingDocumentType, documentId: string): Promise<void> {
    await embeddingRepository.delete(documentType, documentId);
  }

  // -------------------------------------------------------------------------
  // Cosine similarity (kept for tests and potential offline use)
  // -------------------------------------------------------------------------

  static cosineSimilarity(a: number[], b: number[]): number {
    if (a.length !== b.length || a.length === 0) return 0;

    let dotProduct = 0;
    let normA = 0;
    let normB = 0;

    for (let i = 0; i < a.length; i++) {
      dotProduct += a[i] * b[i];
      normA += a[i] * a[i];
      normB += b[i] * b[i];
    }

    const denominator = Math.sqrt(normA) * Math.sqrt(normB);
    if (denominator === 0) return 0;

    return dotProduct / denominator;
  }
}

export const embeddingService = new EmbeddingService();
