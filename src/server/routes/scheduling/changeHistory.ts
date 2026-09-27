import { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import { z } from 'zod';
import { authMiddleware } from '../../middleware/auth';
import { requireScope } from '../../middleware/requireScope';
import { requireProjectAccess } from '../../middleware/requireProjectAccess';
import { changeHistoryService, ChangeConflictError, ChangeStateError } from '../../services/ChangeHistoryService';
import logger from '../../utils/logger';

/** Schedule History: group changes of the last 30 days, and Undo for each. */
export async function changeHistoryRoutes(fastify: FastifyInstance) {
  fastify.addHook('preHandler', authMiddleware);

  // GET /:scheduleId/changes
  fastify.get('/:scheduleId/changes', {
    preHandler: [requireScope('read'), requireProjectAccess('viewer')],
    schema: { description: 'Group changes to this schedule in the last 30 days', tags: ['schedules'] },
  }, async (request: FastifyRequest, reply: FastifyReply) => {
    try {
      const { scheduleId } = request.params as { scheduleId: string };
      return { changes: await changeHistoryService.list(scheduleId) };
    } catch (error) {
      logger.error('Change history list error', { error });
      return reply.status(500).send({ error: 'Internal server error', message: 'Could not load the schedule history' });
    }
  });

  // POST /:scheduleId/changes/:changeId/undo   body: { force?: boolean }
  fastify.post('/:scheduleId/changes/:changeId/undo', {
    preHandler: [requireScope('write'), requireProjectAccess('editor')],
    schema: { description: 'Undo one group change', tags: ['schedules'] },
  }, async (request: FastifyRequest, reply: FastifyReply) => {
    try {
      const { scheduleId, changeId } = request.params as { scheduleId: string; changeId: string };
      const { force } = z.object({ force: z.boolean().optional() }).parse(request.body ?? {});
      return await changeHistoryService.undo(scheduleId, changeId, { force });
    } catch (error: any) {
      if (error instanceof ChangeConflictError) {
        return reply.status(409).send({
          error: 'edited_since',
          editedCount: error.editedCount,
          message: `${error.editedCount} of these tasks ${error.editedCount === 1 ? 'was' : 'were'} changed after this. Undo anyway to overwrite those later changes.`,
        });
      }
      if (error instanceof ChangeStateError) return reply.status(409).send({ error: 'state', message: error.message });
      if (error instanceof z.ZodError) return reply.status(400).send({ error: 'Validation error', message: 'force must be true or false' });
      logger.error('Change undo error', { error });
      return reply.status(500).send({ error: 'Internal server error', message: 'The undo did not complete. Nothing further was changed; please try again.' });
    }
  });
}
