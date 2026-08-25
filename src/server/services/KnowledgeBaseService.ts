import { createHash } from 'crypto';
import { readFile } from 'fs/promises';
import { join } from 'path';
import { embeddingService } from './EmbeddingService';
import { embeddingRepository } from '../database/EmbeddingRepository';
import { knowledgeBaseRepository } from '../database/KnowledgeBaseRepository';
import logger from '../utils/logger';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface KBChunk {
  id: string;
  sourceFile: string;
  sourceName: string;
  sectionPath: string;
  title: string;
  content: string;
  contentHash: string;
}

export interface KBSearchResult {
  id: string;
  title: string;
  sectionPath: string;
  sourceFile: string;
  content: string;
  score: number;
}

export interface ReindexResult {
  total: number;
  updated: number;
  skipped: number;
  pruned: number;
}

// ---------------------------------------------------------------------------
// Doc sources
// ---------------------------------------------------------------------------

const DOC_SOURCES: Array<{ file: string; name: string }> = [
  { file: 'docs/USER_GUIDE.md', name: 'User Guide' },
  { file: 'PRODUCT_MANUAL.md', name: 'Product Manual' },
  { file: 'WORLD_CLASS_FEATURES.md', name: 'Feature Specs' },
  { file: 'docs/ADMIN_MANUAL.md', name: 'Admin Manual' },
  { file: 'docs/AI_DESIGN_FEATURES.md', name: 'AI Design' },
];

const MAX_CHUNK_WORDS = 1500;

// ---------------------------------------------------------------------------
// KnowledgeBaseService
// ---------------------------------------------------------------------------

export class KnowledgeBaseService {

  // -------------------------------------------------------------------------
  // Parse markdown into chunks
  // -------------------------------------------------------------------------

  parseMarkdownToChunks(markdown: string, sourceFile: string, sourceName: string): KBChunk[] {
    const lines = markdown.split('\n');
    const chunks: KBChunk[] = [];

    let currentH2 = '';
    let currentH3 = '';
    let buffer: string[] = [];

    const flush = () => {
      const content = buffer.join('\n').trim();
      if (!content) return;

      const title = currentH3 || currentH2 || sourceName;
      const pathParts = [sourceName];
      if (currentH2) pathParts.push(currentH2);
      if (currentH3) pathParts.push(currentH3);
      const sectionPath = pathParts.join(' > ');

      const breadcrumb = `[${sectionPath}]\n\n`;
      const fullContent = breadcrumb + content;

      // Split large chunks at paragraph boundaries
      const subChunks = this.splitLargeChunk(fullContent, MAX_CHUNK_WORDS);

      for (let i = 0; i < subChunks.length; i++) {
        const chunkContent = subChunks[i];
        const suffix = subChunks.length > 1 ? `-part${i + 1}` : '';
        const id = this.makeSlug(sourceName, currentH2, currentH3) + suffix;

        chunks.push({
          id,
          sourceFile,
          sourceName,
          sectionPath,
          title: subChunks.length > 1 ? `${title} (Part ${i + 1})` : title,
          content: chunkContent,
          contentHash: createHash('sha256').update(chunkContent).digest('hex'),
        });
      }
    };

    for (const line of lines) {
      // Detect ## heading (but not ###)
      if (/^## (?!#)/.test(line)) {
        flush();
        currentH2 = line.replace(/^## /, '').trim();
        currentH3 = '';
        buffer = [];
        continue;
      }

      // Detect ### heading
      if (/^### /.test(line)) {
        flush();
        currentH3 = line.replace(/^### /, '').trim();
        buffer = [];
        continue;
      }

      buffer.push(line);
    }

    // Flush remaining content
    flush();

    return chunks;
  }

  // -------------------------------------------------------------------------
  // Reindex all doc sources
  // -------------------------------------------------------------------------

  async reindex(): Promise<ReindexResult> {
    if (!embeddingService.isAvailable()) {
      throw new Error('Embedding service is not available — cannot reindex knowledge base');
    }

    const projectRoot = join(__dirname, '..', '..', '..');
    const allChunks: KBChunk[] = [];

    // Parse all doc files
    for (const src of DOC_SOURCES) {
      try {
        const filePath = join(projectRoot, src.file);
        const content = await readFile(filePath, 'utf-8');
        const chunks = this.parseMarkdownToChunks(content, src.file, src.name);
        allChunks.push(...chunks);
        logger.info(`KB reindex: parsed ${chunks.length} chunks from ${src.file}`);
      } catch (err) {
        logger.warn(`KB reindex: could not read ${src.file}: ${err}`);
      }
    }

    // Build a map of new chunk IDs and hashes
    const newChunkMap = new Map(allChunks.map(c => [c.id, c]));

    // Get existing chunk IDs + hashes for skip detection
    const existingChunks = await knowledgeBaseRepository.findByIds([...newChunkMap.keys()]);
    const existingHashMap = new Map(existingChunks.map(c => [c.id, c.content_hash]));

    let updated = 0;
    let skipped = 0;

    for (const chunk of allChunks) {
      const existingHash = existingHashMap.get(chunk.id);
      if (existingHash === chunk.contentHash) {
        skipped++;
        continue;
      }

      // Upsert chunk text
      await knowledgeBaseRepository.upsertChunk(
        chunk.id,
        chunk.sourceFile,
        chunk.sectionPath,
        chunk.title,
        chunk.content,
        chunk.contentHash,
      );

      // Upsert embedding
      await embeddingService.upsertEmbedding('knowledge_base', chunk.id, chunk.content);
      updated++;
    }

    // Prune orphaned chunks (deleted sections)
    const allExistingIds = await knowledgeBaseRepository.findAllIds();
    const orphanIds = allExistingIds.filter(id => !newChunkMap.has(id));
    if (orphanIds.length > 0) {
      await knowledgeBaseRepository.deleteByIds(orphanIds);
      for (const id of orphanIds) {
        await embeddingRepository.delete('knowledge_base', id);
      }
      logger.info(`KB reindex: pruned ${orphanIds.length} orphaned chunks`);
    }

    logger.info(`KB reindex complete: ${allChunks.length} total, ${updated} updated, ${skipped} skipped, ${orphanIds.length} pruned`);

    return {
      total: allChunks.length,
      updated,
      skipped,
      pruned: orphanIds.length,
    };
  }

  // -------------------------------------------------------------------------
  // Search knowledge base
  // -------------------------------------------------------------------------

  async search(query: string, topK = 5): Promise<KBSearchResult[]> {
    if (!embeddingService.isAvailable()) {
      return [];
    }

    // Embed query and search embeddings table
    const similarResults = await embeddingService.searchSimilar(
      query,
      'knowledge_base',
      topK,
      0.3, // lower threshold for docs — broader recall
    );

    if (similarResults.length === 0) return [];

    // Fetch chunk text
    const chunkIds = similarResults.map(r => r.documentId);
    const chunks = await knowledgeBaseRepository.findByIds(chunkIds);
    const chunkMap = new Map(chunks.map(c => [c.id, c]));

    return similarResults
      .map(r => {
        const chunk = chunkMap.get(r.documentId);
        if (!chunk) return null;
        return {
          id: chunk.id,
          title: chunk.title,
          sectionPath: chunk.section_path,
          sourceFile: chunk.source_file,
          content: chunk.content,
          score: r.score,
        };
      })
      .filter((r): r is KBSearchResult => r !== null);
  }

  // -------------------------------------------------------------------------
  // Helpers
  // -------------------------------------------------------------------------

  private makeSlug(sourceName: string, h2: string, h3: string): string {
    const parts = ['kb', sourceName, h2, h3].filter(Boolean);
    return parts
      .join(':')
      .toLowerCase()
      .replace(/[^a-z0-9:]+/g, '-')
      .replace(/-+/g, '-')
      .replace(/(^-|-$)/g, '');
  }

  private splitLargeChunk(content: string, maxWords: number): string[] {
    const wordCount = content.split(/\s+/).length;
    if (wordCount <= maxWords) return [content];

    // Split at paragraph boundaries (double-newline)
    const paragraphs = content.split(/\n\n+/);
    const result: string[] = [];
    let current: string[] = [];
    let currentWords = 0;

    for (const para of paragraphs) {
      const paraWords = para.split(/\s+/).length;
      if (currentWords + paraWords > maxWords && current.length > 0) {
        result.push(current.join('\n\n'));
        current = [para];
        currentWords = paraWords;
      } else {
        current.push(para);
        currentWords += paraWords;
      }
    }

    if (current.length > 0) {
      result.push(current.join('\n\n'));
    }

    return result;
  }
}

export const knowledgeBaseService = new KnowledgeBaseService();
