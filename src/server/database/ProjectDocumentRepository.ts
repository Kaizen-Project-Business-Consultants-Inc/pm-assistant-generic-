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
    contentType: row.content_type,
    fileSize: Number(row.file_size) || 0,
    extractedText: row.extracted_text || null,
    documentType: row.document_type,
    projectPhase: row.project_phase,
    tags: parseJson<string[]>(row.tags, []),
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
  }): Promise<ProjectDocument> {
    const id = uuidv4();
    await databaseService.query(
      `INSERT INTO project_documents (id, project_id, filename, original_filename, content_type, file_size, uploaded_by)
       VALUES (?, ?, ?, ?, ?, ?, ?)`,
      [id, data.projectId, data.filename, data.originalFilename, data.contentType, data.fileSize, data.uploadedBy],
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
    search?: string;
  }): Promise<ProjectDocument[]> {
    let where = 'project_id = ?';
    const params: any[] = [projectId];
    if (filters?.documentType) { where += ' AND document_type = ?'; params.push(filters.documentType); }
    if (filters?.projectPhase) { where += ' AND project_phase = ?'; params.push(filters.projectPhase); }
    if (filters?.processingStatus) { where += ' AND processing_status = ?'; params.push(filters.processingStatus); }
    if (filters?.search) {
      where += ' AND (original_filename LIKE ? OR ai_summary LIKE ?)';
      const term = `%${filters.search}%`;
      params.push(term, term);
    }

    const rows = await databaseService.query<any>(
      `SELECT * FROM project_documents WHERE ${where} ORDER BY created_at DESC LIMIT 500`,
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

  async delete(id: string): Promise<void> {
    await databaseService.query('DELETE FROM project_documents WHERE id = ?', [id]);
  }
}

export const projectDocumentRepository = new ProjectDocumentRepository();
