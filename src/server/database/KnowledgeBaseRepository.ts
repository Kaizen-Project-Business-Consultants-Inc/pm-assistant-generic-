import { databaseService } from './connection';

export interface KnowledgeBaseChunkRow {
  id: string;
  source_file: string;
  section_path: string;
  title: string;
  content: string;
  content_hash: string;
  created_at: string;
  updated_at: string;
}

class KnowledgeBaseRepository {
  async upsertChunk(
    id: string,
    sourceFile: string,
    sectionPath: string,
    title: string,
    content: string,
    contentHash: string,
  ): Promise<void> {
    await databaseService.queryControlPlane(
      `INSERT INTO knowledge_base_chunks (id, source_file, section_path, title, content, content_hash)
       VALUES (?, ?, ?, ?, ?, ?)
       ON DUPLICATE KEY UPDATE
         source_file = VALUES(source_file),
         section_path = VALUES(section_path),
         title = VALUES(title),
         content = VALUES(content),
         content_hash = VALUES(content_hash)`,
      [id, sourceFile, sectionPath, title, content, contentHash],
    );
  }

  async findByIds(ids: string[]): Promise<KnowledgeBaseChunkRow[]> {
    if (ids.length === 0) return [];
    const placeholders = ids.map(() => '?').join(',');
    return databaseService.queryControlPlane<KnowledgeBaseChunkRow>(
      `SELECT * FROM knowledge_base_chunks WHERE id IN (${placeholders})`,
      ids,
    );
  }

  async findAllIds(): Promise<string[]> {
    const rows = await databaseService.queryControlPlane<{ id: string }>(
      'SELECT id FROM knowledge_base_chunks',
    );
    return rows.map(r => r.id);
  }

  async deleteByIds(ids: string[]): Promise<void> {
    if (ids.length === 0) return;
    const placeholders = ids.map(() => '?').join(',');
    await databaseService.queryControlPlane(
      `DELETE FROM knowledge_base_chunks WHERE id IN (${placeholders})`,
      ids,
    );
  }

  async count(): Promise<number> {
    const rows = await databaseService.queryControlPlane<{ cnt: number }>(
      'SELECT COUNT(*) as cnt FROM knowledge_base_chunks',
    );
    return rows[0]?.cnt ?? 0;
  }

  async getLastUpdated(): Promise<string | null> {
    const rows = await databaseService.queryControlPlane<{ latest: string }>(
      'SELECT MAX(updated_at) as latest FROM knowledge_base_chunks',
    );
    return rows[0]?.latest ?? null;
  }
}

export const knowledgeBaseRepository = new KnowledgeBaseRepository();
