import { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import { fileAttachmentService } from '../../services/FileAttachmentService';
import { authMiddleware } from '../../middleware/auth';
import { requireScope } from '../../middleware/requireScope';
import { ownWorkScope } from '../../middleware/viewerWriteBypass';
import { checkProjectRole } from '../../middleware/requireProjectAccess';
import { sprintService } from '../../services/SprintService';
import { meetingRepository } from '../../database/MeetingRepository';
import { validateMimeType } from '../../utils/mimeValidator';
import { config } from '../../config';
import { scheduleService } from '../../services/ScheduleService';
import { riskService } from '../../services/RiskService';
import logger from '../../utils/logger';

/** Which project an attachment's item belongs to ('goal' is organisation-level: null) */
async function entityProject(entityType: string, entityId: string): Promise<string | null> {
  switch (entityType) {
    case 'project': return entityId;
    case 'schedule': return (await scheduleService.findById(entityId))?.projectId ?? null;
    case 'task': {
      const t = await scheduleService.findTaskById(entityId);
      return t ? (await scheduleService.findById(t.scheduleId))?.projectId ?? null : null;
    }
    case 'risk': case 'issue': case 'decision': case 'action':
      return (await riskService.findById(entityId))?.projectId ?? null;
    case 'sprint': return (await sprintService.getById(entityId))?.projectId ?? null;
    case 'meeting': return (await meetingRepository.findById(entityId))?.projectId ?? null;
    default: return null;
  }
}
const RAID_TYPES = new Set(['risk', 'issue', 'decision', 'action']);

/**
 * Attachments (Sep 2026 rules): adding, replacing or deleting a file on project items is
 * for the project's Manager/Owner. The owner of a RAID item may also attach files to their
 * own item (evidence for their progress updates). Reading needs project access.
 * Organisation-level items (goals) keep the old behaviour.
 */
async function attachmentGate(request: FastifyRequest, reply: FastifyReply, entityType: string, entityId: string, write: boolean): Promise<boolean> {
  if (entityType === 'goal') return true;
  const projectId = await entityProject(entityType, entityId);
  if (!projectId) { reply.status(404).send({ error: 'Not found', message: 'That item was not found.' }); return false; }
  if (!write) {
    const d = await checkProjectRole(request, projectId, 'viewer');
    if (!d.ok) { reply.status(d.status).send(d.body); return false; }
    return true;
  }
  const pm = await checkProjectRole(request, projectId, 'manager');
  if (pm.ok) return true;
  if (RAID_TYPES.has(entityType)) {
    const item = await riskService.findById(entityId);
    const member = await checkProjectRole(request, projectId, 'viewer');
    if (member.ok && item?.ownerId === request.user!.userId) return true;
  }
  reply.status(403).send({ error: 'Insufficient project role', message: "Only the project's Manager or Owner can change files on this item." });
  return false;
}

/** Reading files needs access to the item's project (it used to need only a login) */
async function readByEntity(request: FastifyRequest, reply: FastifyReply) {
  const { entityType, entityId } = request.params as { entityType: string; entityId: string };
  await attachmentGate(request, reply, entityType, entityId, false);
}
async function readById(request: FastifyRequest, reply: FastifyReply) {
  const existing = await fileAttachmentService.getById((request.params as { id: string }).id);
  if (!existing) return reply.status(404).send({ error: 'Attachment not found' });
  await attachmentGate(request, reply, existing.entityType, existing.entityId, false);
}

export async function fileAttachmentRoutes(fastify: FastifyInstance) {
  fastify.addHook('preHandler', authMiddleware);

  // POST /:entityType/:entityId — multipart upload
  // Viewers can upload attachments to tasks/RAID items assigned to them
  fastify.post('/:entityType/:entityId', {
    preHandler: [ownWorkScope()],
  }, async (request: FastifyRequest, reply: FastifyReply) => {
    try {
      const user = request.user!;
      const { entityType, entityId } = request.params as { entityType: string; entityId: string };

      // Project check (checkProjectRole): the PM, or the owner of this RAID item
      if (!(await attachmentGate(request, reply, entityType, entityId, true))) return;
      // A JSON (or empty) body makes request.file() throw "the request is not multipart" — a 500 (2026-10-07)
      if (!request.isMultipart()) {
        return reply.status(400).send({ error: 'No file uploaded', message: 'Send the file as a form upload (multipart/form-data).' });
      }
      const file = await request.file();
      if (!file) return reply.status(400).send({ error: 'No file uploaded' });

      const buffer = await file.toBuffer();

      const mimeCheck = validateMimeType(file.mimetype, buffer);
      if (!mimeCheck.valid) {
        return reply.status(415).send({ error: 'Unsupported file type', message: mimeCheck.error });
      }

      const attachment = await fileAttachmentService.upload(
        entityType, entityId, user.userId,
        file.filename, file.mimetype, buffer,
      );
      return { attachment };
    } catch (error) {
      logger.error('Upload error', { error });
      return reply.status(500).send({ error: 'Failed to upload file' });
    }
  });

  // GET /:entityType/:entityId — list attachments
  fastify.get('/:entityType/:entityId', { preHandler: [requireScope('read'), readByEntity] }, async (request: FastifyRequest, reply: FastifyReply) => {
    try {
      const { entityType, entityId } = request.params as { entityType: string; entityId: string };
      const attachments = await fileAttachmentService.getByEntity(entityType, entityId);
      return { attachments };
    } catch (error) {
      logger.error('List attachments error', { error });
      return reply.status(500).send({ error: 'Failed to list attachments' });
    }
  });

  // GET /:id/download — stream file
  fastify.get('/:id/download', { preHandler: [requireScope('read'), readById] }, async (request: FastifyRequest, reply: FastifyReply) => {
    try {
      const { id } = request.params as { id: string };
      const attachment = await fileAttachmentService.getById(id);
      if (!attachment) return reply.status(404).send({ error: 'File not found' });

      const fs = await import('fs');
      const path = await import('path');
      const resolvedPath = path.resolve(attachment.filePath);
      const uploadDir = path.resolve(config.UPLOAD_DIR);
      if (!resolvedPath.startsWith(uploadDir)) {
        logger.error('Path traversal attempt', { filePath: attachment.filePath, resolvedPath });
        return reply.status(403).send({ error: 'Access denied' });
      }
      if (!fs.existsSync(attachment.filePath)) {
        return reply.status(404).send({ error: 'File not found on disk' });
      }

      const stream = fs.createReadStream(attachment.filePath);
      reply.header('Content-Type', attachment.mimeType);
      const safeName = attachment.originalName.replace(/["\r\n]/g, '_');
      reply.header('Content-Disposition', `attachment; filename="${safeName}"; filename*=UTF-8''${encodeURIComponent(attachment.originalName)}`);
      return reply.send(stream);
    } catch (error) {
      logger.error('Download error', { error });
      return reply.status(500).send({ error: 'Failed to download file' });
    }
  });

  // POST /:id/version — upload new version
  fastify.post('/:id/version', { preHandler: [requireScope('write')] }, async (request: FastifyRequest, reply: FastifyReply) => {
    try {
      const user = request.user!;
      const { id } = request.params as { id: string };
      const existing = await fileAttachmentService.getById(id);
      if (!existing) return reply.status(404).send({ error: 'Attachment not found' });
      // Project check (checkProjectRole) on the item the file belongs to
      if (!(await attachmentGate(request, reply, existing.entityType, existing.entityId, true))) return;
      // A JSON (or empty) body makes request.file() throw "the request is not multipart" — a 500 (2026-10-07)
      if (!request.isMultipart()) {
        return reply.status(400).send({ error: 'No file uploaded', message: 'Send the file as a form upload (multipart/form-data).' });
      }
      const file = await request.file();
      if (!file) return reply.status(400).send({ error: 'No file uploaded' });

      const buffer = await file.toBuffer();

      const mimeCheck = validateMimeType(file.mimetype, buffer);
      if (!mimeCheck.valid) {
        return reply.status(415).send({ error: 'Unsupported file type', message: mimeCheck.error });
      }

      const attachment = await fileAttachmentService.uploadNewVersion(
        id, user.userId, file.filename, file.mimetype, buffer,
      );
      return { attachment };
    } catch (error) {
      logger.error('Upload version error', { error });
      return reply.status(500).send({ error: 'Failed to upload new version' });
    }
  });

  // GET /:id/versions — version history
  fastify.get('/:id/versions', { preHandler: [requireScope('read'), readById] }, async (request: FastifyRequest, reply: FastifyReply) => {
    try {
      const { id } = request.params as { id: string };
      const versions = await fileAttachmentService.getVersionHistory(id);
      return { versions };
    } catch (error) {
      logger.error('Version history error', { error });
      return reply.status(500).send({ error: 'Failed to fetch version history' });
    }
  });

  // DELETE /:id
  fastify.delete('/:id', { preHandler: [requireScope('write')] }, async (request: FastifyRequest, reply: FastifyReply) => {
    try {
      const { id } = request.params as { id: string };
      const existing = await fileAttachmentService.getById(id);
      if (!existing) return reply.status(404).send({ error: 'Attachment not found' });
      // Deleting: the PM only (checkProjectRole), not the item owner
      if (existing.entityType !== 'goal') {
        const projectId = await entityProject(existing.entityType, existing.entityId);
        const pm = projectId ? await checkProjectRole(request, projectId, 'manager') : null;
        if (!pm?.ok) return reply.status(pm && !pm.ok ? pm.status : 404).send(pm && !pm.ok ? pm.body : { error: 'Not found' });
      }
      await fileAttachmentService.delete(id);
      return { message: 'Attachment deleted' };
    } catch (error) {
      logger.error('Delete attachment error', { error });
      return reply.status(500).send({ error: 'Failed to delete attachment' });
    }
  });
}
