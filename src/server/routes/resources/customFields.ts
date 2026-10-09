import { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import { z } from 'zod';
import { customFieldService } from '../../services/CustomFieldService';
import { customFieldRepository } from '../../database/CustomFieldRepository';
import { authMiddleware } from '../../middleware/auth';
import { requireScope } from '../../middleware/requireScope';
import { requireProjectAccess } from '../../middleware/requireProjectAccess';
import { checkEntityProjectAccess } from '../../middleware/checkEntityProjectAccess';
import logger from '../../utils/logger';
import { sendValidationError } from '../../utils/validationError';

const bulkValuesSchema = z.object({
  projectId: z.string().optional(),
  values: z.array(z.object({
    fieldId: z.string({ message: 'Each value must say which custom field it is for (fieldId).' })
      .min(1, 'Each value must say which custom field it is for (fieldId).'),
    text: z.string().optional().nullable(),
    number: z.number().optional().nullable(),
    date: z.string().optional().nullable(),
    boolean: z.boolean().optional().nullable(),
  }).passthrough(), { message: 'Send the custom field values to save (values).' }),
});

// Field definitions (2026-10-07): an empty or partial body used to reach the database and come
// back as a 500. Types are the ones the app offers (plus select/multiselect, which the sample
// project and the MCP tool use); lengths match the custom_fields columns.
const FIELD_TYPES = ['text', 'number', 'date', 'dropdown', 'select', 'multiselect', 'checkbox'] as const;
const fieldTypeSchema = z.enum(FIELD_TYPES, { message: `Field type must be one of: ${FIELD_TYPES.join(', ')}.` });
const optionsSchema = z.array(z.string().max(200), { message: 'Options must be a list of text values.' }).max(200);

const createFieldSchema = z.object({
  entityType: z.string({ message: 'Say what the field is for (entityType, e.g. task or project).' })
    .min(1, 'Say what the field is for (entityType, e.g. task or project).').max(20),
  fieldName: z.string({ message: 'Enter a name for the field (fieldName).' })
    .min(1, 'Enter a name for the field (fieldName).').max(100, 'The field name can be at most 100 characters.'),
  fieldLabel: z.string({ message: 'Enter a label for the field (fieldLabel).' })
    .min(1, 'Enter a label for the field (fieldLabel).').max(100, 'The field label can be at most 100 characters.'),
  fieldType: fieldTypeSchema,
  options: optionsSchema.optional(),
  isRequired: z.boolean().optional(),
  sortOrder: z.number().int().optional(),
});

const updateFieldSchema = z.object({
  fieldLabel: z.string().min(1, 'The field label cannot be empty.').max(100, 'The field label can be at most 100 characters.').optional(),
  fieldType: fieldTypeSchema.optional(),
  options: optionsSchema.optional(),
  isRequired: z.boolean().optional(),
  sortOrder: z.number().int().optional(),
});

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
  fastify.post('/project/:projectId', { preHandler: [requireScope('write'), requireProjectAccess('manager')] }, async (request: FastifyRequest, reply: FastifyReply) => {
    try {
      const user = request.user!;
      const { projectId } = request.params as { projectId: string };
      const body = createFieldSchema.parse(request.body ?? {});
      const field = await customFieldService.createField({ ...body, projectId, createdBy: user.userId });
      return { field };
    } catch (error: any) {
      if (error instanceof z.ZodError) return sendValidationError(reply, error);
      if (error?.code === 'ER_DUP_ENTRY') {
        return reply.status(409).send({ error: 'Conflict', message: 'This project already has a custom field with that name.' });
      }
      logger.error('Create custom field error', { error });
      return reply.status(500).send({ error: 'Failed to create custom field' });
    }
  });

  // PUT /:id — update field (editor minimum, handler-level check)
  fastify.put('/:id', { preHandler: [requireScope('write')] }, async (request: FastifyRequest, reply: FastifyReply) => {
    try {
      const user = request.user!;
      const { id } = request.params as { id: string };
      const existing = await customFieldRepository.findById(id);
      if (!existing) return reply.status(404).send({ error: 'Custom field not found' });

      const allowed = await checkEntityProjectAccess(existing.projectId, user.userId, user.role, 'manager', reply);
      if (!allowed) return reply;

      const body = updateFieldSchema.parse(request.body ?? {});
      const field = await customFieldService.updateField(id, body);
      return { field };
    } catch (error) {
      if (error instanceof z.ZodError) return sendValidationError(reply, error);
      logger.error('Update custom field error', { error });
      return reply.status(500).send({ error: 'Failed to update custom field' });
    }
  });

  // DELETE /:id (manager minimum, handler-level check)
  fastify.delete('/:id', { preHandler: [requireScope('write')] }, async (request: FastifyRequest, reply: FastifyReply) => {
    try {
      const user = request.user!;
      const { id } = request.params as { id: string };
      const existing = await customFieldRepository.findById(id);
      if (!existing) return reply.status(404).send({ error: 'Custom field not found' });

      const allowed = await checkEntityProjectAccess(existing.projectId, user.userId, user.role, 'manager', reply);
      if (!allowed) return reply;

      await customFieldService.deleteField(id);
      return { message: 'Custom field deleted' };
    } catch (error) {
      logger.error('Delete custom field error', { error });
      return reply.status(500).send({ error: 'Failed to delete custom field' });
    }
  });

  // GET /values/:entityType/:entityId — get values for an entity
  fastify.get('/values/:entityType/:entityId', { preHandler: [requireScope('read'), requireProjectAccess('viewer', { resolve: async (req) => (req.query as { projectId?: string }).projectId ?? null })] }, async (request: FastifyRequest, reply: FastifyReply) => {
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

  // POST /values/:entityType/:entityId — bulk upsert values (editor minimum)
  fastify.post('/values/:entityType/:entityId', { preHandler: [requireScope('write')] }, async (request: FastifyRequest, reply: FastifyReply) => {
    try {
      const user = request.user!;
      const { entityId } = request.params as { entityType: string; entityId: string };
      const body = bulkValuesSchema.parse(request.body ?? {}) as {
        projectId?: string;
        values: Array<{ fieldId: string; text?: string; number?: number; date?: string; boolean?: boolean }>;
      };

      // Resolve projectId: prefer body, fall back to first field's project
      let projectId = body.projectId;
      if (!projectId && body.values.length > 0) {
        const field = await customFieldRepository.findById(body.values[0].fieldId);
        projectId = field?.projectId;
      }
      if (projectId) {
        const allowed = await checkEntityProjectAccess(projectId, user.userId, user.role, 'manager', reply);
        if (!allowed) return reply;
      }

      await customFieldService.bulkSetValues(entityId, body.values);
      return { message: 'Values saved' };
    } catch (error) {
      if (error instanceof z.ZodError) return sendValidationError(reply, error);
      logger.error('Bulk set values error', { error });
      return reply.status(500).send({ error: 'Failed to save values' });
    }
  });
}
