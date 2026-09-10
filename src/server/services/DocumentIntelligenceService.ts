import { projectDocumentRepository } from '../database/ProjectDocumentRepository';
import { documentEntityLinkRepository } from '../database/DocumentEntityLinkRepository';
import { databaseService } from '../database/connection';
import { claudeService } from './claudeService';
import { embeddingService } from './EmbeddingService';
import { extractText, chunkText } from './documentTextExtractor';
import { DocumentAIResponseSchema, type DocumentAIResponse, type EntityLinkType } from '../schemas/documentSchemas';
import { sanitizeForPrompt } from '../utils/promptSanitizer';
import logger from '../utils/logger';
import fs from 'fs/promises';
import path from 'path';
import { config } from '../config';

const SYSTEM_PROMPT = `You are Kovarti's Document Intelligence Engine.

Analyze the provided document and output STRICT JSON matching this schema:
1. Classification: document_type (requirements|design|meeting_minutes|risk_log|issue_log|financial|governance|decision_log|contract|proposal|misc), project_phase (initiation|planning|execution|monitoring|closure|unknown), tags (string array)
2. Summary: summary (executive summary, max 2000 chars) and key_points (string array)
3. Extracted items: decisions[], risks[] (with severity low/medium/high), issues[], actions[] (with optional assignee/due_date), dates_mentioned[]
4. Entity linking: related_entities with tasks[], risks[], milestones[] — each has {id, name, reason}. Only link to entities from the PROJECT CONTEXT that are clearly referenced in the document.
5. confidence: 0-1 score for classification confidence

Rules:
- Use ONLY the provided document content — do not hallucinate
- Mark inferred items with "inferred": true
- If uncertain about classification, set confidence low
- Only link to entities that are clearly referenced
- Keep tags lowercase, max 20 tags
- Keep arrays reasonable — max 30 items each`;

class DocumentIntelligenceService {
  /**
   * Main processing pipeline for an uploaded document.
   */
  async processDocument(projectId: string, documentId: string, filePath: string, userId: string): Promise<void> {
    try {
      await projectDocumentRepository.updateStatus(documentId, 'processing');

      // 1. Read file and extract text
      const buffer = await fs.readFile(filePath);
      const doc = await projectDocumentRepository.findById(documentId);
      if (!doc) throw new Error(`Document ${documentId} not found`);

      const text = await extractText(buffer, doc.contentType);
      if (!text || text.trim().length < 10) {
        await projectDocumentRepository.updateStatus(documentId, 'failed', 'Document appears empty or contains too little text.');
        return;
      }

      // 2. Gather project context for entity linking
      const context = await this.getProjectContext(projectId);

      // 3. Call AI for classification + insights
      const userMessage = this.buildUserMessage(text, doc.originalFilename, context);
      const aiResult = await claudeService.completeWithJsonSchema<DocumentAIResponse>({
        systemPrompt: SYSTEM_PROMPT,
        userMessage,
        schema: DocumentAIResponseSchema,
        maxTokens: 4000,
        userId,
      });

      const aiData = aiResult.data;

      // 4. Store AI results
      await projectDocumentRepository.updateProcessingResult(documentId, {
        extractedText: text,
        documentType: aiData.document_type,
        projectPhase: aiData.project_phase,
        tags: aiData.tags,
        aiSummary: aiData.summary,
        aiInsights: aiData,
        confidence: aiData.confidence,
      });

      // 5. Create entity links
      const links = this.buildEntityLinks(aiData);
      if (links.length > 0) {
        await documentEntityLinkRepository.createLinks(documentId, links);
      }

      // 6. Fire-and-forget: create embeddings for text chunks
      this.createEmbeddings(documentId, text).catch(err =>
        logger.error('Document embedding creation failed', { documentId, error: err.message }),
      );

    } catch (error: any) {
      logger.error('Document processing failed', { documentId, error: error.message });
      await projectDocumentRepository.updateStatus(documentId, 'failed', error.message).catch(() => {});
    }
  }

  /**
   * Semantic search over document embeddings.
   */
  async searchDocuments(projectId: string, query: string, topK = 10) {
    const results = await embeddingService.searchSimilar(query, 'project_document', topK);
    if (results.length === 0) return [];

    const docIds = results.map(r => r.documentId);
    const docs = await projectDocumentRepository.findByIds(docIds);

    // Filter to only documents in the requested project
    const projectDocs = docs.filter(d => d.projectId === projectId);
    const docMap = new Map(projectDocs.map(d => [d.id, d]));

    return results
      .filter(r => docMap.has(r.documentId))
      .map(r => ({
        document: docMap.get(r.documentId)!,
        score: r.score,
      }));
  }

  // ---------------------------------------------------------------------------
  // Private helpers
  // ---------------------------------------------------------------------------

  private async getProjectContext(projectId: string): Promise<{
    tasks: { id: string; name: string }[];
    risks: { id: string; name: string }[];
    milestones: { id: string; name: string }[];
  }> {
    try {
      const [tasks, risks, milestones] = await Promise.all([
        databaseService.query<any>(
          `SELECT t.id, t.name FROM tasks t
           JOIN schedules s ON t.schedule_id = s.id
           WHERE s.project_id = ? AND t.status != 'cancelled'
           LIMIT 100`,
          [projectId],
        ),
        databaseService.query<any>(
          `SELECT id, title AS name FROM project_risks WHERE project_id = ? AND status != 'closed' LIMIT 100`,
          [projectId],
        ),
        databaseService.query<any>(
          `SELECT t.id, t.name FROM tasks t
           JOIN schedules s ON t.schedule_id = s.id
           WHERE s.project_id = ? AND t.task_type = 'milestone'
           LIMIT 50`,
          [projectId],
        ),
      ]);
      return { tasks, risks, milestones };
    } catch {
      return { tasks: [], risks: [], milestones: [] };
    }
  }

  private buildUserMessage(
    text: string,
    filename: string,
    context: { tasks: { id: string; name: string }[]; risks: { id: string; name: string }[]; milestones: { id: string; name: string }[] },
  ): string {
    const sanitizedText = sanitizeForPrompt(text, 80000);
    const taskList = context.tasks.map(t => `- ${t.id}: ${t.name}`).join('\n') || 'None';
    const riskList = context.risks.map(r => `- ${r.id}: ${r.name}`).join('\n') || 'None';
    const milestoneList = context.milestones.map(m => `- ${m.id}: ${m.name}`).join('\n') || 'None';

    return `DOCUMENT TEXT:
<user-data field="document">${sanitizedText}</user-data>

DOCUMENT METADATA:
<user-data field="metadata">Filename: ${sanitizeForPrompt(filename, 500)}</user-data>

PROJECT CONTEXT:
Tasks:
${taskList}

Risks:
${riskList}

Milestones:
${milestoneList}`;
  }

  private buildEntityLinks(aiData: DocumentAIResponse): {
    entityType: EntityLinkType;
    entityId: string;
    linkReason?: string;
  }[] {
    const links: { entityType: EntityLinkType; entityId: string; linkReason?: string }[] = [];
    const re = aiData.related_entities;

    if (re.tasks) {
      for (const t of re.tasks) {
        links.push({ entityType: 'task', entityId: t.id, linkReason: t.reason });
      }
    }
    if (re.risks) {
      for (const r of re.risks) {
        links.push({ entityType: 'risk', entityId: r.id, linkReason: r.reason });
      }
    }
    if (re.milestones) {
      for (const m of re.milestones) {
        links.push({ entityType: 'milestone', entityId: m.id, linkReason: m.reason });
      }
    }

    return links;
  }

  private async createEmbeddings(documentId: string, text: string): Promise<void> {
    if (!embeddingService.isAvailable()) return;

    const chunks = chunkText(text);
    for (let i = 0; i < chunks.length; i++) {
      const chunkId = `${documentId}_chunk_${i}`;
      await embeddingService.upsertEmbedding('project_document', chunkId, chunks[i]);
    }
  }

  /**
   * Delete all embeddings for a document (all chunks).
   */
  async deleteDocumentEmbeddings(documentId: string): Promise<void> {
    if (!embeddingService.isAvailable()) return;
    // Delete the main document embedding and chunk embeddings
    // Since chunks use documentId_chunk_N pattern, we need to delete each
    // For now, delete the base ID — the chunk IDs need individual deletion
    // We'll rely on the DB FK cascade for entity links, and clean up embeddings best-effort
    try {
      // Get the document to check how many chunks it might have
      const doc = await projectDocumentRepository.findById(documentId);
      const textLength = doc?.extractedText?.length || 0;
      const estimatedChunks = Math.ceil(textLength / 4000) + 1;
      for (let i = 0; i < estimatedChunks; i++) {
        await embeddingService.deleteEmbedding('project_document', `${documentId}_chunk_${i}`);
      }
    } catch (err: any) {
      logger.warn('Failed to clean up document embeddings', { documentId, error: err.message });
    }
  }

  /**
   * Get the file path for a document.
   */
  getFilePath(projectId: string, filename: string): string {
    return path.join(config.UPLOAD_DIR, 'documents', projectId, filename);
  }
}

export const documentIntelligenceService = new DocumentIntelligenceService();
