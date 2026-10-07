import { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import { z } from 'zod';
import { intakeFormService } from '../../services/IntakeFormService';
import { authMiddleware } from '../../middleware/auth';
import { requireScope } from '../../middleware/requireScope';
import logger from '../../utils/logger';
import { sendValidationError } from '../../utils/validationError';
import { duplicateProjectNameReply } from '../../utils/duplicateProject';
import { checkProjectRoleFor } from '../../middleware/requireProjectAccess';

const intakeFieldSchema = z.object({
  id: z.string({ message: 'Each form field needs an id.' }).min(1, 'Each form field needs an id.'),
  label: z.string({ message: 'Give every form field a label.' }).min(1, 'Give every form field a label.'),
  type: z.string({ message: 'Choose a type for every form field.' }).min(1, 'Choose a type for every form field.'),
  required: z.boolean().default(false),
  options: z.array(z.string()).optional(),
});

const createFormSchema = z.object({
  name: z.string({ message: 'Enter a name for the intake form.' }).trim().min(1, 'Enter a name for the intake form.').max(200, 'Keep the form name under 200 characters.'),
  description: z.string().max(2000, 'Keep the description under 2000 characters.').optional(),
  fields: z.array(intakeFieldSchema, { message: 'Add at least one field to the form.' }).min(1, 'Add at least one field to the form.'),
  projectDefaults: z.record(z.string(), z.unknown()).optional(),
});

const updateFormSchema = createFormSchema.partial().extend({
  isActive: z.boolean().optional(),
});

const reviewSubmissionSchema = z.object({
  status: z.string({ message: 'Choose a review decision (status).' }).min(1, 'Choose a review decision (status).'),
  notes: z.string().max(5000, 'Keep the review notes under 5000 characters.').optional(),
});

const submitFormSchema = z.object({
  values: z.record(z.string(), z.unknown(), { message: 'Fill in the form before submitting it (values).' }),
});

export async function intakeFormRoutes(fastify: FastifyInstance) {
  fastify.addHook('preHandler', authMiddleware);

  // POST /forms — create form
  fastify.post('/forms', { preHandler: [requireScope('write')] }, async (request: FastifyRequest, reply: FastifyReply) => {
    try {
      const user = request.user!;
      const body = createFormSchema.parse(request.body ?? {});
      const form = await intakeFormService.createForm(body, user.userId);
      return { form };
    } catch (error) {
      if (error instanceof z.ZodError) return sendValidationError(reply, error);
      logger.error('Create intake form error', { error });
      return reply.status(500).send({ error: 'Failed to create intake form' });
    }
  });

  // GET /forms — list forms
  fastify.get('/forms', { preHandler: [requireScope('read')] }, async (request: FastifyRequest, reply: FastifyReply) => {
    try {
      const forms = await intakeFormService.getForms();
      return { forms };
    } catch (error) {
      logger.error('Get intake forms error', { error });
      return reply.status(500).send({ error: 'Failed to fetch intake forms' });
    }
  });

  // GET /forms/:id — get form by id
  fastify.get('/forms/:id', { preHandler: [requireScope('read')] }, async (request: FastifyRequest, reply: FastifyReply) => {
    try {
      const { id } = request.params as { id: string };
      const form = await intakeFormService.getFormById(id);
      return { form };
    } catch (error) {
      logger.error('Get intake form error', { error });
      return reply.status(500).send({ error: 'Failed to fetch intake form' });
    }
  });

  // PUT /forms/:id — update form
  fastify.put('/forms/:id', { preHandler: [requireScope('write')] }, async (request: FastifyRequest, reply: FastifyReply) => {
    try {
      const { id } = request.params as { id: string };
      const body = updateFormSchema.parse(request.body ?? {});
      const form = await intakeFormService.updateForm(id, body);
      return { form };
    } catch (error) {
      if (error instanceof z.ZodError) return sendValidationError(reply, error);
      logger.error('Update intake form error', { error });
      return reply.status(500).send({ error: 'Failed to update intake form' });
    }
  });

  // DELETE /forms/:id — delete form
  fastify.delete('/forms/:id', { preHandler: [requireScope('write')] }, async (request: FastifyRequest, reply: FastifyReply) => {
    try {
      const { id } = request.params as { id: string };
      await intakeFormService.deleteForm(id);
      return { message: 'Intake form deleted' };
    } catch (error) {
      logger.error('Delete intake form error', { error });
      return reply.status(500).send({ error: 'Failed to delete intake form' });
    }
  });

  // POST /forms/:id/submit — submit form
  fastify.post('/forms/:id/submit', { preHandler: [requireScope('write')] }, async (request: FastifyRequest, reply: FastifyReply) => {
    try {
      const user = request.user!;
      const { id } = request.params as { id: string };
      const { values } = submitFormSchema.parse(request.body ?? {});
      const form = await intakeFormService.getFormById(id);
      if (!form) return reply.status(404).send({ error: 'Not found', message: 'That intake form no longer exists.' });
      const submission = await intakeFormService.submitForm(id, values, user.userId);
      return { submission };
    } catch (error) {
      if (error instanceof z.ZodError) return sendValidationError(reply, error);
      logger.error('Submit intake form error', { error });
      return reply.status(500).send({ error: 'Failed to submit intake form' });
    }
  });

  // GET /submissions — list submissions
  fastify.get('/submissions', { preHandler: [requireScope('read')] }, async (request: FastifyRequest, reply: FastifyReply) => {
    try {
      const { formId, status } = request.query as { formId?: string; status?: string };
      const submissions = await intakeFormService.getSubmissions(formId, status);
      return { submissions };
    } catch (error) {
      logger.error('Get submissions error', { error });
      return reply.status(500).send({ error: 'Failed to fetch submissions' });
    }
  });

  // GET /submissions/:id — get submission by id
  fastify.get('/submissions/:id', { preHandler: [requireScope('read')] }, async (request: FastifyRequest, reply: FastifyReply) => {
    try {
      const { id } = request.params as { id: string };
      const submission = await intakeFormService.getSubmissionById(id);
      return { submission };
    } catch (error) {
      logger.error('Get submission error', { error });
      return reply.status(500).send({ error: 'Failed to fetch submission' });
    }
  });

  // POST /submissions/:id/review — review submission
  fastify.post('/submissions/:id/review', { preHandler: [requireScope('write')] }, async (request: FastifyRequest, reply: FastifyReply) => {
    try {
      const user = request.user!;
      const { id } = request.params as { id: string };
      const { status, notes } = reviewSubmissionSchema.parse(request.body ?? {});
      const existing = await intakeFormService.getSubmissionById(id);
      if (!existing) return reply.status(404).send({ error: 'Not found', message: 'That intake submission no longer exists.' });
      const result = await intakeFormService.reviewSubmission(id, status, notes || '', user.userId);
      return { result };
    } catch (error) {
      if (error instanceof z.ZodError) return sendValidationError(reply, error);
      logger.error('Review submission error', { error });
      return reply.status(500).send({ error: 'Failed to review submission' });
    }
  });

  // POST /submissions/:id/convert — convert to project
  fastify.post('/submissions/:id/convert', { preHandler: [requireScope('write')] }, async (request: FastifyRequest, reply: FastifyReply) => {
    try {
      const user = request.user!;
      const { id } = request.params as { id: string };
      const project = await intakeFormService.convertToProject(id, user.userId);
      return { project };
    } catch (error) {
      const message = error instanceof Error ? error.message : '';
      if (message === 'Submission not found') return reply.status(404).send({ error: 'Not found', message: 'That intake submission no longer exists.' });
      if (message === 'Form not found') return reply.status(404).send({ error: 'Not found', message: 'The intake form for this submission no longer exists.' });
      const nameTaken = await duplicateProjectNameReply(error, reply, (pid) => checkProjectRoleFor(request.user!, pid, 'viewer').then(d => d.ok));
      if (nameTaken) return nameTaken;
      logger.error('Convert to project error', { error });
      return reply.status(500).send({ error: 'Failed to convert to project' });
    }
  });
}
