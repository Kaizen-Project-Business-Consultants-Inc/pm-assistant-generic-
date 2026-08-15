import { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import { customFieldService } from '../../services/CustomFieldService';
import { authMiddleware } from '../../middleware/auth';
import { requireScope } from '../../middleware/requireScope';
import { requireProjectAccess } from '../../middleware/requireProjectAccess';
import logger from '../../utils/logger';

export async function customFieldRoutes(fastify: FastifyInstance) {
  fastify.addHook('preHandler', authMiddleware);

  // GET /project/:projectId — list field definitions
  fastify.get('/project/:projectId', { preHandler: [requireScope('read'), requireProjectAccess('viewer')] }, async (request: FastifyRequest, reply: FastifyReply) => {
    try {
      const { projectId } = request.params as { projectId: string };
      const { entityType } = request.query as { entityType?: string };
      const fields = await customFieldService.getFieldsByProject(projectId, entityType);
      return { fields };
    } catch (error) {
      logger.error('Get custom fields error', { error });
      return reply.status(500).send({ error: 'Failed to fetch custom fields' });
    }
  });

  // POST /project/:projectId — create field
  fastify.post('/project/:projectId', { preHandler: [requireScope('write'), requireProjectAccess('editor')] }, async (request: FastifyRequest, reply: FastifyReply) => {
    try {
      const user = request.user!;
      const { projectId } = request.params as { projectId: string };
      const body = request.body as {
        entityType: string; fieldName: string; fieldLabel: string;
        fieldType: string; options?: string[]; isRequired?: boolean; sortOrder?: number;
      };
      const field = await customFieldService.createField({ ...body, projectId, createdBy: user.userId });
      return { field };
    } catch (error) {
      logger.error('Create custom field error', { error });
      return reply.status(500).send({ error: 'Failed to create custom field' });
    }
  });

  // PUT /:id — update field
  fastify.put('/:id', { preHandler: [requireScope('write')] }, async (request: FastifyRequest, reply: FastifyReply) => {
    try {
      const { id } = request.params as { id: string };
      const body = request.body as { fieldLabel?: string; fieldType?: string; options?: string[]; isRequired?: boolean; sortOrder?: number };
      const field = await customFieldService.updateField(id, body);
      return { field };
    } catch (error) {
      logger.error('Update custom field error', { error });
      return reply.status(500).send({ error: 'Failed to update custom field' });
    }
  });

  // DELETE /:id
  fastify.delete('/:id', { preHandler: [requireScope('write')] }, async (request: FastifyRequest, reply: FastifyReply) => {
    try {
      const { id } = request.params as { id: string };
      await customFieldService.deleteField(id);
      return { message: 'Custom field deleted' };
    } catch (error) {
      logger.error('Delete custom field error', { error });
      return reply.status(500).send({ error: 'Failed to delete custom field' });
    }
  });

  // GET /values/:entityType/:entityId — get values for an entity
  fastify.get('/values/:entityType/:entityId', { preHandler: [requireScope('read')] }, async (request: FastifyRequest, reply: FastifyReply) => {
    try {
      const { entityType, entityId } = request.params as { entityType: string; entityId: string };
      const { projectId } = request.query as { projectId: string };
      if (!projectId) return reply.status(400).send({ error: 'projectId query param is required' });

      const fieldsWithValues = await customFieldService.getValues(entityType, entityId, projectId);
      return { fields: fieldsWithValues };
    } catch (error) {
      logger.error('Get custom field values error', { error });
      return reply.status(500).send({ error: 'Failed to fetch custom field values' });
    }
  });

  // POST /values/:entityType/:entityId — bulk upsert values
  fastify.post('/values/:entityType/:entityId', { preHandler: [requireScope('write')] }, async (request: FastifyRequest, reply: FastifyReply) => {
    try {
      const { entityId } = request.params as { entityType: string; entityId: string };
      const { values } = request.body as {
        values: Array<{ fieldId: string; text?: string; number?: number; date?: string; boolean?: boolean }>;
      };
      await customFieldService.bulkSetValues(entityId, values);
      return { message: 'Values saved' };
    } catch (error) {
      logger.error('Bulk set values error', { error });
      return reply.status(500).send({ error: 'Failed to save values' });
    }
  });
}
