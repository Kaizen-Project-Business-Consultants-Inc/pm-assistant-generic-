import { v4 as uuidv4 } from 'uuid';
import { databaseService } from './connection';
import type { ProjectDocument, DocumentType, ProjectPhase, ProcessingStatus, DocumentAIResponse } from '../schemas/documentSchemas';

function parseJson<T>(val: unknown, fallback: T): T {
  if (!val) return fallback;
  if (typeof val === 'string') {
    try { return JSON.parse(val); } catch { return fallback; }
  }
  return val as T;
}

function mapRow(row: any): ProjectDocument {
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
    processingStatus: row.processing_status,
    errorMessage: row.error_message || null,
    uploadedBy: row.uploaded_by,
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
      'SELECT * FROM project_documents WHERE id = ?',
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
      `SELECT * FROM project_documents WHERE ${where} ORDER BY is_pinned DESC, created_at DESC LIMIT 500`,
      params,
    );
    return rows.map(mapRow);
  }

  async findByIds(ids: string[]): Promise<ProjectDocument[]> {
    if (ids.length === 0) return [];
    const placeholders = ids.map(() => '?').join(',');
    const rows = await databaseService.query<any>(
      `SELECT * FROM project_documents WHERE id IN (${placeholders})`,
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

  async delete(id: string): Promise<void> {
    await databaseService.query('DELETE FROM project_documents WHERE id = ?', [id]);
  }
}

export const projectDocumentRepository = new ProjectDocumentRepository();
