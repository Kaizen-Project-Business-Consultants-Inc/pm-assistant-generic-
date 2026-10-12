import { v4 as uuidv4 } from 'uuid';
import { databaseService } from './connection';
import type { ProjectDocument, DocumentType, ProjectPhase, ProcessingStatus, DocumentAIResponse } from '../schemas/documentSchemas';
import { chunksOf } from '../utils/chunksOf';

function parseJson<T>(val: unknown, fallback: T): T {
  if (!val) return fallback;
  if (typeof val === 'string') {
    try { return JSON.parse(val); } catch { return fallback; }
  }
  return val as T;
}

/**
 * An analysis that has said "processing" for longer than this never finished (the server restarted,
 * the AI call hung): it shows as failed, polling stops, and "Analyse again" may claim it
 * (audit 2 review, 2026-10-11). Uses updated_at, which the claim sets.
 */
export const STALE_PROCESSING_MINUTES = 10;
const STALE_SQL = `(processing_status = 'processing' AND updated_at < NOW() - INTERVAL ${STALE_PROCESSING_MINUTES} MINUTE)`;
const STALE_MESSAGE = "The analysis didn't finish. Click Analyse again with AI to try again.";
/** Every column, plus whether a "processing" row is stale */
const SELECT_ONE = `SELECT *, ${STALE_SQL} AS processing_stale FROM project_documents`;
/** The list leaves out extracted_text (whole documents' text; the list polls while analysing) */
const LIST_COLUMNS = `id, project_id, filename, original_filename, description, content_type, file_size,
  document_type, project_phase, tags, folder, is_pinned, ai_summary, ai_insights, confidence, processing_status,
  error_message, uploaded_by, connector_id, external_id, external_path, external_modified_at, external_etag,
  created_at, updated_at, ${STALE_SQL} AS processing_stale`;

function mapRow(row: any): ProjectDocument {
  const stale = !!Number(row.processing_stale);
  return {
    id: row.id,
    projectId: row.project_id,
    filename: row.filename,
    originalFilename: row.original_filename,
    description: row.description || null,
    contentType: row.content_type,
    fileSize: Number(row.file_size) || 0,
    extractedText: row.extracted_text || null,
    documentType: row.document_type,
    projectPhase: row.project_phase,
    tags: parseJson<string[]>(row.tags, []),
    folder: row.folder || null,
    isPinned: !!row.is_pinned,
    aiSummary: row.ai_summary || null,
    aiInsights: parseJson<DocumentAIResponse | null>(row.ai_insights, null),
    confidence: Number(row.confidence) || 0,
    processingStatus: stale ? 'failed' : row.processing_status,
    errorMessage: stale ? STALE_MESSAGE : (row.error_message || null),
    uploadedBy: row.uploaded_by,
    connectorId: row.connector_id || null,
    externalId: row.external_id || null,
    externalPath: row.external_path || null,
    externalModifiedAt: row.external_modified_at ? String(row.external_modified_at) : null,
    externalEtag: row.external_etag || null,
    createdAt: String(row.created_at),
    updatedAt: String(row.updated_at),
  };
}

class ProjectDocumentRepository {
  async create(data: {
    projectId: string;
    filename: string;
    originalFilename: string;
    contentType: string;
    fileSize: number;
    uploadedBy: string;
    description?: string;
  }): Promise<ProjectDocument> {
    const id = uuidv4();
    await databaseService.query(
      `INSERT INTO project_documents (id, project_id, filename, original_filename, description, content_type, file_size, uploaded_by)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
      [id, data.projectId, data.filename, data.originalFilename, data.description || null, data.contentType, data.fileSize, data.uploadedBy],
    );
    return (await this.findById(id))!;
  }

  async findById(id: string): Promise<ProjectDocument | null> {
    const rows = await databaseService.query<any>(
      `${SELECT_ONE} WHERE id = ?`,
      [id],
    );
    return rows.length > 0 ? mapRow(rows[0]) : null;
  }

  async findByProject(projectId: string, filters?: {
    documentType?: DocumentType;
    projectPhase?: ProjectPhase;
    processingStatus?: ProcessingStatus;
    folder?: string;
    search?: string;
  }): Promise<ProjectDocument[]> {
    let where = 'project_id = ?';
    const params: any[] = [projectId];
    if (filters?.documentType) { where += ' AND document_type = ?'; params.push(filters.documentType); }
    if (filters?.projectPhase) { where += ' AND project_phase = ?'; params.push(filters.projectPhase); }
    if (filters?.processingStatus) { where += ' AND processing_status = ?'; params.push(filters.processingStatus); }
    if (filters?.folder) { where += ' AND folder = ?'; params.push(filters.folder); }
    if (filters?.search) {
      where += ' AND (original_filename LIKE ? OR ai_summary LIKE ? OR description LIKE ?)';
      const term = `%${filters.search}%`;
      params.push(term, term, term);
    }

    const rows = await databaseService.query<any>(
      `SELECT ${LIST_COLUMNS} FROM project_documents WHERE ${where} ORDER BY is_pinned DESC, created_at DESC LIMIT 500`,
      params,
    );
    return rows.map(mapRow);
  }

  async findByIds(ids: string[]): Promise<ProjectDocument[]> {
    if (ids.length === 0) return [];
    const placeholders = ids.map(() => '?').join(',');
    const rows = await databaseService.query<any>(
      `${SELECT_ONE} WHERE id IN (${placeholders})`,
      ids,
    );
    return rows.map(mapRow);
  }

  async updateProcessingResult(id: string, result: {
    extractedText: string;
    documentType: DocumentType;
    projectPhase: ProjectPhase;
    tags: string[];
    aiSummary: string;
    aiInsights: DocumentAIResponse;
    confidence: number;
  }): Promise<void> {
    await databaseService.query(
      `UPDATE project_documents SET
         extracted_text = ?, document_type = ?, project_phase = ?,
         tags = ?, ai_summary = ?, ai_insights = ?,
         confidence = ?, processing_status = 'completed'
       WHERE id = ?`,
      [
        result.extractedText,
        result.documentType,
        result.projectPhase,
        JSON.stringify(result.tags),
        result.aiSummary,
        JSON.stringify(result.aiInsights),
        result.confidence,
        id,
      ],
    );
  }

  /**
   * Claim a document for an AI analysis, atomically: only one click wins (a second gets false), and
   * a "processing" claim older than STALE_PROCESSING_MINUTES can be taken over. So two clicks never
   * both pay for the AI. updated_at is set explicitly: taking over a stale claim changes no other
   * value, and ON UPDATE CURRENT_TIMESTAMP only fires when a value changes, so the row would still
   * read as stale and a third click could win again.
   */
  async claimForAnalysis(id: string): Promise<boolean> {
    const result = await databaseService.query<{ affectedRows?: number }>(
      `UPDATE project_documents SET processing_status = 'processing', error_message = NULL, updated_at = NOW()
        WHERE id = ? AND (processing_status <> 'processing' OR updated_at < NOW() - INTERVAL ${STALE_PROCESSING_MINUTES} MINUTE)`,
      [id],
    );
    return (((result as unknown as { affectedRows?: number }).affectedRows) ?? 0) > 0;
  }

  async updateStatus(id: string, status: ProcessingStatus, errorMessage?: string): Promise<void> {
    await databaseService.query(
      'UPDATE project_documents SET processing_status = ?, error_message = ? WHERE id = ?',
      [status, errorMessage || null, id],
    );
  }

  async updateMeta(id: string, data: {
    description?: string | null;
    folder?: string | null;
    isPinned?: boolean;
  }): Promise<void> {
    const sets: string[] = [];
    const params: any[] = [];
    if (data.description !== undefined) { sets.push('description = ?'); params.push(data.description); }
    if (data.folder !== undefined) { sets.push('folder = ?'); params.push(data.folder); }
    if (data.isPinned !== undefined) { sets.push('is_pinned = ?'); params.push(data.isPinned ? 1 : 0); }
    if (sets.length === 0) return;
    params.push(id);
    await databaseService.query(`UPDATE project_documents SET ${sets.join(', ')} WHERE id = ?`, params);
  }

  async getDistinctFolders(projectId: string): Promise<string[]> {
    const rows = await databaseService.query<any>(
      `SELECT DISTINCT folder FROM project_documents WHERE project_id = ? AND folder IS NOT NULL AND folder != '' ORDER BY folder`,
      [projectId],
    );
    return rows.map((r: any) => r.folder);
  }

  /** A connector's documents for these drive items, by item id (500 ids per read) */
  async findByExternalIds(connectorId: string, externalIds: string[]): Promise<Map<string, { id: string; externalEtag: string | null }>> {
    const out = new Map<string, { id: string; externalEtag: string | null }>();
    for (const ids of chunksOf([...new Set(externalIds)], 500)) {
      // eslint-disable-next-line no-await-in-loop -- one read per 500 items
      const rows = await databaseService.query<any>(
        // only what the sync compares — not each document's extracted text
        `SELECT id, external_id, external_etag FROM project_documents WHERE connector_id = ? AND external_id IN (${ids.map(() => '?').join(',')})`,
        [connectorId, ...ids],
      );
      for (const r of rows) out.set(r.external_id, { id: r.id, externalEtag: r.external_etag ?? null });
    }
    return out;
  }

  async upsertFromConnector(data: {
    existingId?: string;
    projectId: string;
    connectorId: string;
    externalId: string;
    externalPath: string;
    externalModifiedAt: Date | null;
    externalEtag: string | null;
    filename: string;
    originalFilename: string;
    contentType: string;
    fileSize: number;
    uploadedBy: string;
  }): Promise<ProjectDocument> {
    if (data.existingId) {
      // Update existing record. The file changed, so the earlier analysis (about the old version)
      // goes: text, summary, insights, tags, links here; the sync removes its embeddings first.
      // It waits for "Analyse with AI" again (audit 2 review, 2026-10-11).
      await databaseService.query(
        `UPDATE project_documents SET
           filename = ?, original_filename = ?, content_type = ?, file_size = ?,
           external_path = ?, external_modified_at = ?, external_etag = ?,
           processing_status = 'pending', error_message = NULL,
           extracted_text = NULL, ai_summary = NULL, ai_insights = NULL, tags = NULL,
           document_type = 'misc', project_phase = 'unknown', confidence = 0
         WHERE id = ?`,
        [
          data.filename, data.originalFilename, data.contentType, data.fileSize,
          data.externalPath, data.externalModifiedAt, data.externalEtag,
          data.existingId,
        ],
      );
      await databaseService.query('DELETE FROM document_entity_links WHERE document_id = ?', [data.existingId]);
      return (await this.findById(data.existingId))!;
    }

    // Insert new record
    const id = uuidv4();
    await databaseService.query(
      `INSERT INTO project_documents
       (id, project_id, filename, original_filename, content_type, file_size, uploaded_by,
        connector_id, external_id, external_path, external_modified_at, external_etag)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        id, data.projectId, data.filename, data.originalFilename, data.contentType, data.fileSize,
        data.uploadedBy, data.connectorId, data.externalId, data.externalPath,
        data.externalModifiedAt, data.externalEtag,
      ],
    );
    return (await this.findById(id))!;
  }

  async countByProject(projectId: string): Promise<number> {
    const rows = await databaseService.query<any>(
      'SELECT COUNT(*) as cnt FROM project_documents WHERE project_id = ?',
      [projectId],
    );
    return Number(rows[0]?.cnt) || 0;
  }

  async delete(id: string): Promise<void> {
    await databaseService.query('DELETE FROM project_documents WHERE id = ?', [id]);
  }
}

export const projectDocumentRepository = new ProjectDocumentRepository();
