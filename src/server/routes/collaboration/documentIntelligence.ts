import { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import { v4 as uuidv4 } from 'uuid';
import fs from 'fs';
import fsPromises from 'fs/promises';
import path from 'path';
import { authMiddleware } from '../../middleware/auth';
import { requireScope } from '../../middleware/requireScope';
import { validateMimeType } from '../../utils/mimeValidator';
import { projectDocumentRepository } from '../../database/ProjectDocumentRepository';
import { documentEntityLinkRepository } from '../../database/DocumentEntityLinkRepository';
import { documentIntelligenceService } from '../../services/DocumentIntelligenceService';
import { config } from '../../config';
import logger from '../../utils/logger';

const ALLOWED_MIME_TYPES = [
  'application/pdf',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  'application/msword',
  'text/plain',
  'text/csv',
  'text/markdown',
];

const MAX_FILE_SIZE = 10 * 1024 * 1024; // 10MB

export async function documentIntelligenceRoutes(fastify: FastifyInstance) {
  fastify.addHook('preHandler', authMiddleware);

  // POST /:projectId/documents/upload — multipart file upload
  fastify.post('/:projectId/documents/upload', { preHandler: [requireScope('write')] }, async (request: FastifyRequest, reply: FastifyReply) => {
    try {
      const user = request.user!;
      const { projectId } = request.params as { projectId: string };

      const file = await request.file();
      if (!file) return reply.status(400).send({ error: 'No file uploaded' });

      const buffer = await file.toBuffer();

      if (buffer.length > MAX_FILE_SIZE) {
        return reply.status(400).send({ error: 'File too large. Maximum size is 10MB.' });
      }

      const mimeCheck = validateMimeType(file.mimetype, buffer);
      if (!mimeCheck.valid || !ALLOWED_MIME_TYPES.includes(file.mimetype)) {
        return reply.status(415).send({ error: 'Unsupported file type. Allowed: PDF, DOCX, DOC, TXT, CSV, MD.' });
      }

      // Save file to disk
      const docFilename = `${uuidv4()}${path.extname(file.filename)}`;
      const uploadDir = path.join(config.UPLOAD_DIR, 'documents', projectId);
      if (!fs.existsSync(uploadDir)) {
        fs.mkdirSync(uploadDir, { recursive: true });
      }
      const filePath = path.join(uploadDir, docFilename);
      await fsPromises.writeFile(filePath, buffer);

      // Extract optional description from multipart fields
      const description = (file.fields?.description as any)?.value || null;

      // Create DB record
      const doc = await projectDocumentRepository.create({
        projectId,
        filename: docFilename,
        originalFilename: file.filename,
        contentType: file.mimetype,
        fileSize: buffer.length,
        uploadedBy: user.userId,
        description: description ? String(description).slice(0, 500) : undefined,
      });

      // Trigger async processing (fire-and-forget)
      documentIntelligenceService.processDocument(projectId, doc.id, filePath, user.userId).catch(err =>
        logger.error('Document processing background error', { documentId: doc.id, error: err.message }),
      );

      return { document: doc };
    } catch (error: any) {
      logger.error('Document upload error', { error: error.message });
      return reply.status(500).send({ error: 'Failed to upload document' });
    }
  });

  // GET /:projectId/documents — list documents with filters
  fastify.get('/:projectId/documents', { preHandler: [requireScope('read')] }, async (request: FastifyRequest) => {
    const { projectId } = request.params as { projectId: string };
    const query = request.query as {
      documentType?: string;
      projectPhase?: string;
      folder?: string;
      search?: string;
    };

    const documents = await projectDocumentRepository.findByProject(projectId, {
      documentType: query.documentType as any,
      projectPhase: query.projectPhase as any,
      folder: query.folder,
      search: query.search,
    });

    return { documents };
  });

  // GET /:projectId/documents/folders — list distinct folder names
  fastify.get('/:projectId/documents/folders', { preHandler: [requireScope('read')] }, async (request: FastifyRequest) => {
    const { projectId } = request.params as { projectId: string };
    const folders = await projectDocumentRepository.getDistinctFolders(projectId);
    return { folders };
  });

  // PATCH /:projectId/documents/:documentId — update description, folder, pin status
  fastify.patch('/:projectId/documents/:documentId', { preHandler: [requireScope('write')] }, async (request: FastifyRequest, reply: FastifyReply) => {
    const { documentId } = request.params as { projectId: string; documentId: string };
    const body = request.body as { description?: string | null; folder?: string | null; isPinned?: boolean };

    const document = await projectDocumentRepository.findById(documentId);
    if (!document) return reply.status(404).send({ error: 'Document not found' });

    await projectDocumentRepository.updateMeta(documentId, {
      description: body.description !== undefined ? (body.description ? String(body.description).slice(0, 500) : null) : undefined,
      folder: body.folder !== undefined ? (body.folder ? String(body.folder).slice(0, 100) : null) : undefined,
      isPinned: body.isPinned,
    });

    const updated = await projectDocumentRepository.findById(documentId);
    return { document: updated };
  });

  // GET /:projectId/documents/search — semantic search with text fallback
  fastify.get('/:projectId/documents/search', { preHandler: [requireScope('read')] }, async (request: FastifyRequest) => {
    const { projectId } = request.params as { projectId: string };
    const { q, topK } = request.query as { q?: string; topK?: string };

    if (!q || q.trim().length < 2) {
      return { results: [] };
    }

    const query = q.trim();
    const limit = topK ? parseInt(topK, 10) : 10;

    // Try semantic search first, fall back to text search
    try {
      const results = await documentIntelligenceService.searchDocuments(projectId, query, limit);
      if (results.length > 0) return { results };
    } catch (err: any) {
      logger.warn('Semantic search unavailable, falling back to text search', { error: err.message });
    }

    // Text-based fallback
    const docs = await projectDocumentRepository.findByProject(projectId, { search: query });
    return {
      results: docs.slice(0, limit).map(doc => ({ document: doc, score: 0 })),
    };
  });

  // GET /:projectId/documents/:documentId — full document with insights + linked entities
  fastify.get('/:projectId/documents/:documentId', { preHandler: [requireScope('read')] }, async (request: FastifyRequest, reply: FastifyReply) => {
    const { documentId } = request.params as { projectId: string; documentId: string };

    const document = await projectDocumentRepository.findById(documentId);
    if (!document) return reply.status(404).send({ error: 'Document not found' });

    const entityLinks = await documentEntityLinkRepository.findByDocument(documentId);

    return { document, entityLinks };
  });

  // GET /:projectId/documents/:documentId/download — stream file back to client
  fastify.get('/:projectId/documents/:documentId/download', { preHandler: [requireScope('read')] }, async (request: FastifyRequest, reply: FastifyReply) => {
    const { projectId, documentId } = request.params as { projectId: string; documentId: string };

    const document = await projectDocumentRepository.findById(documentId);
    if (!document || document.projectId !== projectId) {
      return reply.status(404).send({ error: 'Document not found' });
    }

    const filePath = documentIntelligenceService.getFilePath(projectId, document.filename);
    try {
      await fsPromises.access(filePath);
    } catch {
      return reply.status(404).send({ error: 'File not found on disk' });
    }

    const stream = fs.createReadStream(filePath);
    return reply
      .header('Content-Type', document.contentType)
      .header('Content-Disposition', `attachment; filename="${encodeURIComponent(document.originalFilename)}"`)
      .header('Content-Length', document.fileSize)
      .send(stream);
  });

  // DELETE /:projectId/documents/:documentId — remove document + embeddings + entity links
  fastify.delete('/:projectId/documents/:documentId', { preHandler: [requireScope('write')] }, async (request: FastifyRequest, reply: FastifyReply) => {
    const { projectId, documentId } = request.params as { projectId: string; documentId: string };

    const document = await projectDocumentRepository.findById(documentId);
    if (!document) return reply.status(404).send({ error: 'Document not found' });

    // Delete file from disk
    try {
      const filePath = documentIntelligenceService.getFilePath(projectId, document.filename);
      await fsPromises.unlink(filePath);
    } catch {
      // File may already be gone
    }

    // Delete embeddings (fire-and-forget)
    documentIntelligenceService.deleteDocumentEmbeddings(documentId).catch(() => {});

    // Delete from DB (entity links cascade via FK)
    await projectDocumentRepository.delete(documentId);

    return { success: true };
  });

  // POST /:projectId/documents/:documentId/reprocess — re-run AI processing
  fastify.post('/:projectId/documents/:documentId/reprocess', { preHandler: [requireScope('write')] }, async (request: FastifyRequest, reply: FastifyReply) => {
    const user = request.user!;
    const { projectId, documentId } = request.params as { projectId: string; documentId: string };

    const document = await projectDocumentRepository.findById(documentId);
    if (!document) return reply.status(404).send({ error: 'Document not found' });

    const filePath = documentIntelligenceService.getFilePath(projectId, document.filename);

    // Clear old entity links before reprocessing
    await documentEntityLinkRepository.deleteByDocument(documentId);

    // Fire-and-forget reprocessing
    documentIntelligenceService.processDocument(projectId, documentId, filePath, user.userId).catch(err =>
      logger.error('Document reprocessing error', { documentId, error: err.message }),
    );

    return { success: true, message: 'Reprocessing started' };
  });
}
