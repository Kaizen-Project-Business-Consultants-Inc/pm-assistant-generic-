import { describe, it, expect, vi, beforeEach } from 'vitest';

// ---------------------------------------------------------------------------
// Mocks — must be declared before importing the service under test
// ---------------------------------------------------------------------------

vi.mock('../../database/ProjectDocumentRepository', () => ({
  projectDocumentRepository: {
    findById: vi.fn(),
    findByIds: vi.fn(),
    updateStatus: vi.fn().mockResolvedValue(undefined),
    updateProcessingResult: vi.fn().mockResolvedValue(undefined),
  },
}));

vi.mock('../../database/DocumentEntityLinkRepository', () => ({
  documentEntityLinkRepository: {
    createLinks: vi.fn().mockResolvedValue(undefined),
  },
}));

vi.mock('../../database/connection', () => ({
  databaseService: {
    query: vi.fn().mockResolvedValue([]),
  },
}));

vi.mock('../../services/claudeService', () => ({
  claudeService: {
    completeWithJsonSchema: vi.fn(),
  },
}));

vi.mock('../../services/EmbeddingService', () => ({
  embeddingService: {
    isAvailable: vi.fn().mockReturnValue(false),
    searchSimilar: vi.fn().mockResolvedValue([]),
    upsertEmbedding: vi.fn().mockResolvedValue(undefined),
    deleteEmbedding: vi.fn().mockResolvedValue(undefined),
  },
}));

vi.mock('../../services/documentTextExtractor', () => ({
  extractText: vi.fn().mockResolvedValue('Extracted document text content for testing purposes.'),
  chunkText: vi.fn().mockReturnValue(['chunk-0', 'chunk-1']),
}));

vi.mock('../../utils/promptSanitizer', () => ({
  sanitizeForPrompt: vi.fn().mockImplementation((text: string) => text),
}));

vi.mock('../../utils/logger', () => ({
  default: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}));

vi.mock('../../config', () => ({
  config: {
    UPLOAD_DIR: '/tmp/uploads',
  },
}));

vi.mock('fs/promises', () => ({
  default: {
    readFile: vi.fn().mockResolvedValue(Buffer.from('fake file content')),
  },
}));

// ---------------------------------------------------------------------------
// Imports (after mocks)
// ---------------------------------------------------------------------------

import { documentIntelligenceService } from '../../services/DocumentIntelligenceService';
import { projectDocumentRepository } from '../../database/ProjectDocumentRepository';
import { documentEntityLinkRepository } from '../../database/DocumentEntityLinkRepository';
import { databaseService } from '../../database/connection';
import { claudeService } from '../../services/claudeService';
import { embeddingService } from '../../services/EmbeddingService';
import { extractText } from '../../services/documentTextExtractor';
import logger from '../../utils/logger';
import fs from 'fs/promises';
import type { DocumentAIResponse } from '../../schemas/documentSchemas';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeAIResponse(overrides: Partial<DocumentAIResponse> = {}): DocumentAIResponse {
  return {
    document_type: 'requirements',
    project_phase: 'planning',
    tags: ['scope', 'mvp'],
    summary: 'A requirements document for the MVP.',
    key_points: ['Defines scope', 'Lists acceptance criteria'],
    decisions: [],
    risks: [{ text: 'Timeline risk' }],
    issues: [],
    actions: [{ text: 'Review with stakeholders' }],
    dates_mentioned: ['2026-10-01'],
    related_entities: {
      tasks: [{ id: 't1', name: 'Design wireframes', reason: 'Referenced in section 3' }],
      risks: [{ id: 'r1', name: 'Budget overrun', reason: 'Mentioned in risk table' }],
      milestones: [],
    },
    confidence: 0.85,
    ...overrides,
  };
}

function makeDocRecord(overrides: Record<string, unknown> = {}) {
  return {
    id: 'doc-1',
    projectId: 'proj-1',
    filename: 'stored-abc.pdf',
    originalFilename: 'requirements.pdf',
    contentType: 'application/pdf',
    fileSize: 12345,
    extractedText: null,
    documentType: 'misc',
    projectPhase: 'unknown',
    tags: [],
    processingStatus: 'pending',
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('DocumentIntelligenceService', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  // =========================================================================
  // processDocument
  // =========================================================================
  describe('processDocument', () => {
    const projectId = 'proj-1';
    const documentId = 'doc-1';
    const filePath = '/tmp/uploads/documents/proj-1/stored-abc.pdf';
    const userId = 'user-1';

    it('happy path — processes a document end-to-end', async () => {
      const aiData = makeAIResponse();
      (projectDocumentRepository.findById as ReturnType<typeof vi.fn>).mockResolvedValue(makeDocRecord());
      (claudeService.completeWithJsonSchema as ReturnType<typeof vi.fn>).mockResolvedValue({ data: aiData });

      await documentIntelligenceService.processDocument(projectId, documentId, filePath, userId);

      // Sets status to processing
      expect(projectDocumentRepository.updateStatus).toHaveBeenCalledWith(documentId, 'processing');

      // Reads the file
      expect(fs.readFile).toHaveBeenCalledWith(filePath);

      // Fetches document record
      expect(projectDocumentRepository.findById).toHaveBeenCalledWith(documentId);

      // Extracts text
      expect(extractText).toHaveBeenCalled();

      // Calls AI
      expect(claudeService.completeWithJsonSchema).toHaveBeenCalledWith(
        expect.objectContaining({
          systemPrompt: expect.stringContaining('Document Intelligence Engine'),
          userMessage: expect.stringContaining('DOCUMENT TEXT'),
          maxTokens: 4000,
          userId,
        }),
      );

      // Stores results
      expect(projectDocumentRepository.updateProcessingResult).toHaveBeenCalledWith(documentId, {
        extractedText: 'Extracted document text content for testing purposes.',
        documentType: 'requirements',
        projectPhase: 'planning',
        tags: ['scope', 'mvp'],
        aiSummary: 'A requirements document for the MVP.',
        aiInsights: aiData,
        confidence: 0.85,
      });

      // Creates entity links (1 task + 1 risk = 2 links)
      expect(documentEntityLinkRepository.createLinks).toHaveBeenCalledWith(documentId, [
        { entityType: 'task', entityId: 't1', linkReason: 'Referenced in section 3' },
        { entityType: 'risk', entityId: 'r1', linkReason: 'Mentioned in risk table' },
      ]);
    });

    it('skips entity link creation when no entities are referenced', async () => {
      const aiData = makeAIResponse({
        related_entities: { tasks: [], risks: [], milestones: [] },
      });
      (projectDocumentRepository.findById as ReturnType<typeof vi.fn>).mockResolvedValue(makeDocRecord());
      (claudeService.completeWithJsonSchema as ReturnType<typeof vi.fn>).mockResolvedValue({ data: aiData });

      await documentIntelligenceService.processDocument(projectId, documentId, filePath, userId);

      expect(documentEntityLinkRepository.createLinks).not.toHaveBeenCalled();
    });

    it('includes milestone links when present', async () => {
      const aiData = makeAIResponse({
        related_entities: {
          tasks: [],
          risks: [],
          milestones: [{ id: 'm1', name: 'Go Live', reason: 'Target date' }],
        },
      });
      (projectDocumentRepository.findById as ReturnType<typeof vi.fn>).mockResolvedValue(makeDocRecord());
      (claudeService.completeWithJsonSchema as ReturnType<typeof vi.fn>).mockResolvedValue({ data: aiData });

      await documentIntelligenceService.processDocument(projectId, documentId, filePath, userId);

      expect(documentEntityLinkRepository.createLinks).toHaveBeenCalledWith(documentId, [
        { entityType: 'milestone', entityId: 'm1', linkReason: 'Target date' },
      ]);
    });

    it('marks document as failed when document record is not found', async () => {
      (projectDocumentRepository.findById as ReturnType<typeof vi.fn>).mockResolvedValue(null);

      await documentIntelligenceService.processDocument(projectId, documentId, filePath, userId);

      expect(logger.error).toHaveBeenCalledWith('Document processing failed', expect.objectContaining({ documentId }));
      expect(projectDocumentRepository.updateStatus).toHaveBeenCalledWith(documentId, 'failed', expect.stringContaining('not found'));
    });

    it('marks document as failed when extracted text is too short', async () => {
      (projectDocumentRepository.findById as ReturnType<typeof vi.fn>).mockResolvedValue(makeDocRecord());
      (extractText as ReturnType<typeof vi.fn>).mockResolvedValueOnce('short');

      await documentIntelligenceService.processDocument(projectId, documentId, filePath, userId);

      expect(projectDocumentRepository.updateStatus).toHaveBeenCalledWith(documentId, 'failed', expect.stringContaining('empty'));
      // Should NOT call AI
      expect(claudeService.completeWithJsonSchema).not.toHaveBeenCalled();
    });

    it('marks document as failed when extracted text is null', async () => {
      (projectDocumentRepository.findById as ReturnType<typeof vi.fn>).mockResolvedValue(makeDocRecord());
      (extractText as ReturnType<typeof vi.fn>).mockResolvedValueOnce(null);

      await documentIntelligenceService.processDocument(projectId, documentId, filePath, userId);

      expect(projectDocumentRepository.updateStatus).toHaveBeenCalledWith(documentId, 'failed', expect.stringContaining('empty'));
    });

    it('marks document as failed when extracted text is only whitespace', async () => {
      (projectDocumentRepository.findById as ReturnType<typeof vi.fn>).mockResolvedValue(makeDocRecord());
      (extractText as ReturnType<typeof vi.fn>).mockResolvedValueOnce('      ');

      await documentIntelligenceService.processDocument(projectId, documentId, filePath, userId);

      expect(projectDocumentRepository.updateStatus).toHaveBeenCalledWith(documentId, 'failed', expect.stringContaining('empty'));
    });

    it('marks document as failed when AI call throws', async () => {
      (projectDocumentRepository.findById as ReturnType<typeof vi.fn>).mockResolvedValue(makeDocRecord());
      (claudeService.completeWithJsonSchema as ReturnType<typeof vi.fn>).mockRejectedValue(new Error('AI timeout'));

      await documentIntelligenceService.processDocument(projectId, documentId, filePath, userId);

      expect(logger.error).toHaveBeenCalledWith('Document processing failed', expect.objectContaining({ documentId }));
      expect(projectDocumentRepository.updateStatus).toHaveBeenCalledWith(documentId, 'failed', 'AI timeout');
    });

    it('marks document as failed when file read throws', async () => {
      (fs.readFile as ReturnType<typeof vi.fn>).mockRejectedValueOnce(new Error('ENOENT'));

      await documentIntelligenceService.processDocument(projectId, documentId, filePath, userId);

      expect(projectDocumentRepository.updateStatus).toHaveBeenCalledWith(documentId, 'failed', 'ENOENT');
    });

    it('does not throw if updateStatus fails inside catch handler', async () => {
      (projectDocumentRepository.findById as ReturnType<typeof vi.fn>).mockResolvedValue(null);
      // Make the updateStatus call inside catch also reject
      (projectDocumentRepository.updateStatus as ReturnType<typeof vi.fn>)
        .mockResolvedValueOnce(undefined) // first call: 'processing'
        .mockRejectedValueOnce(new Error('DB down')); // catch handler call

      // Should not throw
      await expect(
        documentIntelligenceService.processDocument(projectId, documentId, filePath, userId),
      ).resolves.toBeUndefined();
    });

    it('fires-and-forgets embedding creation (does not block)', async () => {
      const aiData = makeAIResponse({ related_entities: { tasks: [], risks: [], milestones: [] } });
      (projectDocumentRepository.findById as ReturnType<typeof vi.fn>).mockResolvedValue(makeDocRecord());
      (claudeService.completeWithJsonSchema as ReturnType<typeof vi.fn>).mockResolvedValue({ data: aiData });
      (embeddingService.isAvailable as ReturnType<typeof vi.fn>).mockReturnValue(false);

      await documentIntelligenceService.processDocument(projectId, documentId, filePath, userId);

      // Processing completes (updateProcessingResult was called) even if embeddings are skipped
      expect(projectDocumentRepository.updateProcessingResult).toHaveBeenCalled();
    });

    it('gathers project context (tasks, risks, milestones) via DB queries', async () => {
      const aiData = makeAIResponse({ related_entities: { tasks: [], risks: [], milestones: [] } });
      (projectDocumentRepository.findById as ReturnType<typeof vi.fn>).mockResolvedValue(makeDocRecord());
      (claudeService.completeWithJsonSchema as ReturnType<typeof vi.fn>).mockResolvedValue({ data: aiData });

      // Return some context data
      (databaseService.query as ReturnType<typeof vi.fn>)
        .mockResolvedValueOnce([{ id: 't1', name: 'Task A' }])   // tasks
        .mockResolvedValueOnce([{ id: 'r1', name: 'Risk A' }])   // risks
        .mockResolvedValueOnce([{ id: 'm1', name: 'Milestone A' }]); // milestones

      await documentIntelligenceService.processDocument(projectId, documentId, filePath, userId);

      expect(databaseService.query).toHaveBeenCalledTimes(3);
      // The user message should contain context entities
      const userMessage = (claudeService.completeWithJsonSchema as ReturnType<typeof vi.fn>).mock.calls[0][0].userMessage;
      expect(userMessage).toContain('Task A');
      expect(userMessage).toContain('Risk A');
      expect(userMessage).toContain('Milestone A');
    });

    it('uses empty context when DB queries fail', async () => {
      const aiData = makeAIResponse({ related_entities: { tasks: [], risks: [], milestones: [] } });
      (projectDocumentRepository.findById as ReturnType<typeof vi.fn>).mockResolvedValue(makeDocRecord());
      (claudeService.completeWithJsonSchema as ReturnType<typeof vi.fn>).mockResolvedValue({ data: aiData });

      // Context queries fail
      (databaseService.query as ReturnType<typeof vi.fn>).mockRejectedValue(new Error('DB error'));

      await documentIntelligenceService.processDocument(projectId, documentId, filePath, userId);

      // Should still proceed — user message will show "None" for context
      const userMessage = (claudeService.completeWithJsonSchema as ReturnType<typeof vi.fn>).mock.calls[0][0].userMessage;
      expect(userMessage).toContain('None');
    });
  });

  // =========================================================================
  // searchDocuments
  // =========================================================================
  describe('searchDocuments', () => {
    const projectId = 'proj-1';

    it('returns empty array when no embedding results', async () => {
      (embeddingService.searchSimilar as ReturnType<typeof vi.fn>).mockResolvedValue([]);

      const results = await documentIntelligenceService.searchDocuments(projectId, 'risk analysis');

      expect(results).toEqual([]);
      expect(projectDocumentRepository.findByIds).not.toHaveBeenCalled();
    });

    it('returns matched documents filtered by projectId', async () => {
      const searchResults = [
        { documentId: 'doc-1', score: 0.9 },
        { documentId: 'doc-2', score: 0.7 },
      ];
      (embeddingService.searchSimilar as ReturnType<typeof vi.fn>).mockResolvedValue(searchResults);
      (projectDocumentRepository.findByIds as ReturnType<typeof vi.fn>).mockResolvedValue([
        makeDocRecord({ id: 'doc-1', projectId: 'proj-1' }),
        makeDocRecord({ id: 'doc-2', projectId: 'proj-other' }), // different project
      ]);

      const results = await documentIntelligenceService.searchDocuments(projectId, 'query');

      expect(results).toHaveLength(1);
      expect(results[0].document.id).toBe('doc-1');
      expect(results[0].score).toBe(0.9);
    });

    it('passes topK parameter to searchSimilar', async () => {
      (embeddingService.searchSimilar as ReturnType<typeof vi.fn>).mockResolvedValue([]);

      await documentIntelligenceService.searchDocuments(projectId, 'query', 5);

      expect(embeddingService.searchSimilar).toHaveBeenCalledWith('query', 'project_document', 5);
    });

    it('defaults topK to 10', async () => {
      (embeddingService.searchSimilar as ReturnType<typeof vi.fn>).mockResolvedValue([]);

      await documentIntelligenceService.searchDocuments(projectId, 'query');

      expect(embeddingService.searchSimilar).toHaveBeenCalledWith('query', 'project_document', 10);
    });

    it('returns results in the same order as embedding scores', async () => {
      const searchResults = [
        { documentId: 'doc-a', score: 0.95 },
        { documentId: 'doc-b', score: 0.80 },
        { documentId: 'doc-c', score: 0.60 },
      ];
      (embeddingService.searchSimilar as ReturnType<typeof vi.fn>).mockResolvedValue(searchResults);
      (projectDocumentRepository.findByIds as ReturnType<typeof vi.fn>).mockResolvedValue([
        makeDocRecord({ id: 'doc-c', projectId }),
        makeDocRecord({ id: 'doc-a', projectId }),
        makeDocRecord({ id: 'doc-b', projectId }),
      ]);

      const results = await documentIntelligenceService.searchDocuments(projectId, 'query');

      expect(results).toHaveLength(3);
      expect(results[0].document.id).toBe('doc-a');
      expect(results[1].document.id).toBe('doc-b');
      expect(results[2].document.id).toBe('doc-c');
    });
  });

  // =========================================================================
  // deleteDocumentEmbeddings
  // =========================================================================
  describe('deleteDocumentEmbeddings', () => {
    it('does nothing when embeddings are not available', async () => {
      (embeddingService.isAvailable as ReturnType<typeof vi.fn>).mockReturnValue(false);

      await documentIntelligenceService.deleteDocumentEmbeddings('doc-1');

      expect(projectDocumentRepository.findById).not.toHaveBeenCalled();
      expect(embeddingService.deleteEmbedding).not.toHaveBeenCalled();
    });

    it('deletes estimated chunk embeddings based on text length', async () => {
      (embeddingService.isAvailable as ReturnType<typeof vi.fn>).mockReturnValue(true);
      // 8500 chars of extracted text => ceil(8500 / 4000) + 1 = 4 chunks
      (projectDocumentRepository.findById as ReturnType<typeof vi.fn>).mockResolvedValue(
        makeDocRecord({ extractedText: 'x'.repeat(8500) }),
      );

      await documentIntelligenceService.deleteDocumentEmbeddings('doc-1');

      expect(embeddingService.deleteEmbedding).toHaveBeenCalledTimes(4);
      expect(embeddingService.deleteEmbedding).toHaveBeenCalledWith('project_document', 'doc-1_chunk_0');
      expect(embeddingService.deleteEmbedding).toHaveBeenCalledWith('project_document', 'doc-1_chunk_1');
      expect(embeddingService.deleteEmbedding).toHaveBeenCalledWith('project_document', 'doc-1_chunk_2');
      expect(embeddingService.deleteEmbedding).toHaveBeenCalledWith('project_document', 'doc-1_chunk_3');
    });

    it('handles document with no extracted text', async () => {
      (embeddingService.isAvailable as ReturnType<typeof vi.fn>).mockReturnValue(true);
      (projectDocumentRepository.findById as ReturnType<typeof vi.fn>).mockResolvedValue(
        makeDocRecord({ extractedText: null }),
      );

      await documentIntelligenceService.deleteDocumentEmbeddings('doc-1');

      // ceil(0/4000)+1 = 1 chunk
      expect(embeddingService.deleteEmbedding).toHaveBeenCalledTimes(1);
      expect(embeddingService.deleteEmbedding).toHaveBeenCalledWith('project_document', 'doc-1_chunk_0');
    });

    it('handles document not found (null)', async () => {
      (embeddingService.isAvailable as ReturnType<typeof vi.fn>).mockReturnValue(true);
      (projectDocumentRepository.findById as ReturnType<typeof vi.fn>).mockResolvedValue(null);

      await documentIntelligenceService.deleteDocumentEmbeddings('doc-1');

      // textLength = 0 => 1 chunk
      expect(embeddingService.deleteEmbedding).toHaveBeenCalledTimes(1);
    });

    it('logs warning when cleanup fails but does not throw', async () => {
      (embeddingService.isAvailable as ReturnType<typeof vi.fn>).mockReturnValue(true);
      (projectDocumentRepository.findById as ReturnType<typeof vi.fn>).mockRejectedValue(new Error('DB gone'));

      await expect(documentIntelligenceService.deleteDocumentEmbeddings('doc-1')).resolves.toBeUndefined();

      expect(logger.warn).toHaveBeenCalledWith(
        'Failed to clean up document embeddings',
        expect.objectContaining({ documentId: 'doc-1' }),
      );
    });
  });

  // =========================================================================
  // getFilePath
  // =========================================================================
  describe('getFilePath', () => {
    it('builds path from UPLOAD_DIR, project ID, and filename', () => {
      const result = documentIntelligenceService.getFilePath('proj-1', 'stored-abc.pdf');
      // path.join normalizes separators per platform
      expect(result).toContain('documents');
      expect(result).toContain('proj-1');
      expect(result).toContain('stored-abc.pdf');
    });
  });

  // =========================================================================
  // createEmbeddings (via processDocument — private but exercised indirectly)
  // =========================================================================
  describe('embedding creation (via processDocument)', () => {
    it('creates embeddings for each text chunk when service is available', async () => {
      const aiData = makeAIResponse({ related_entities: { tasks: [], risks: [], milestones: [] } });
      (projectDocumentRepository.findById as ReturnType<typeof vi.fn>).mockResolvedValue(makeDocRecord());
      (claudeService.completeWithJsonSchema as ReturnType<typeof vi.fn>).mockResolvedValue({ data: aiData });
      (embeddingService.isAvailable as ReturnType<typeof vi.fn>).mockReturnValue(true);

      await documentIntelligenceService.processDocument('proj-1', 'doc-1', '/tmp/file.pdf', 'user-1');

      // Wait for the fire-and-forget promise
      await new Promise(resolve => setTimeout(resolve, 50));

      expect(embeddingService.upsertEmbedding).toHaveBeenCalledTimes(2);
      expect(embeddingService.upsertEmbedding).toHaveBeenCalledWith('project_document', 'doc-1_chunk_0', 'chunk-0');
      expect(embeddingService.upsertEmbedding).toHaveBeenCalledWith('project_document', 'doc-1_chunk_1', 'chunk-1');
    });

    it('skips embedding creation when service is not available', async () => {
      const aiData = makeAIResponse({ related_entities: { tasks: [], risks: [], milestones: [] } });
      (projectDocumentRepository.findById as ReturnType<typeof vi.fn>).mockResolvedValue(makeDocRecord());
      (claudeService.completeWithJsonSchema as ReturnType<typeof vi.fn>).mockResolvedValue({ data: aiData });
      (embeddingService.isAvailable as ReturnType<typeof vi.fn>).mockReturnValue(false);

      await documentIntelligenceService.processDocument('proj-1', 'doc-1', '/tmp/file.pdf', 'user-1');

      await new Promise(resolve => setTimeout(resolve, 50));

      expect(embeddingService.upsertEmbedding).not.toHaveBeenCalled();
    });

    it('logs error when embedding creation fails but does not fail processing', async () => {
      const aiData = makeAIResponse({ related_entities: { tasks: [], risks: [], milestones: [] } });
      (projectDocumentRepository.findById as ReturnType<typeof vi.fn>).mockResolvedValue(makeDocRecord());
      (claudeService.completeWithJsonSchema as ReturnType<typeof vi.fn>).mockResolvedValue({ data: aiData });
      (embeddingService.isAvailable as ReturnType<typeof vi.fn>).mockReturnValue(true);
      (embeddingService.upsertEmbedding as ReturnType<typeof vi.fn>).mockRejectedValue(new Error('Embedding API down'));

      await documentIntelligenceService.processDocument('proj-1', 'doc-1', '/tmp/file.pdf', 'user-1');

      // Processing result was still stored
      expect(projectDocumentRepository.updateProcessingResult).toHaveBeenCalled();

      // Wait for fire-and-forget to settle
      await new Promise(resolve => setTimeout(resolve, 50));

      expect(logger.error).toHaveBeenCalledWith(
        'Document embedding creation failed',
        expect.objectContaining({ documentId: 'doc-1' }),
      );
    });
  });
});
