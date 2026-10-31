import { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import { authMiddleware } from '../../middleware/auth';
import { requireScope } from '../../middleware/requireScope';
import { requireProjectAccess } from '../../middleware/requireProjectAccess';
import { changeHistoryService, NotLatestChangeError, ChangeStateError } from '../../services/ChangeHistoryService';
import { scheduleService } from '../../services/ScheduleService';
import { planMoves } from '../../services/indentPlan';
import { computeScheduleRowNumbers } from '../../utils/scheduleRowNumbers';
import { heavyActionLimit } from '../../middleware/rateLimiter';
import logger from '../../utils/logger';
import { z } from 'zod';

const indentSchema = z.object({
  taskIds: z.array(z.string().min(1).max(64)).min(1).max(200),
  direction: z.enum(['indent', 'outdent']),
  /** indent: the heading to put them under (the row above, as the screen shows it); none: the row above in plan order */
  underTaskId: z.string().min(1).max(64).optional(),
});

/** A refusal reads as sentences: "<reason>. Nothing was moved." */
const nothingMoved = (reason: string) => `${reason}${/[.!?]$/.test(reason) ? '' : '.'} Nothing was moved.`;

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

  // POST /:scheduleId/changes/:changeId/undo — only the newest change, while nothing has changed since
  fastify.post('/:scheduleId/changes/:changeId/undo', {
    preHandler: [requireScope('write'), requireProjectAccess('manager')],
    schema: { description: 'Undo one group change', tags: ['schedules'] },
  }, async (request: FastifyRequest, reply: FastifyReply) => {
    try {
      const { scheduleId, changeId } = request.params as { scheduleId: string; changeId: string };
      return await changeHistoryService.undo(scheduleId, changeId);
    } catch (error: any) {
      if (error instanceof NotLatestChangeError) return reply.status(409).send({ error: 'not_latest', message: error.message });
      if (error instanceof ChangeStateError) return reply.status(409).send({ error: 'state', message: error.message });
      logger.error('Change undo error', { error });
      return reply.status(500).send({ error: 'Internal server error', message: 'The undo did not complete. Nothing further was changed; please try again.' });
    }
  });

  // POST /:scheduleId/indent — indent / outdent tasks (Gantt and Table keys and menus): the same planner and
  // transaction as Mjuzi's indent_tasks (loop, milestone, linked-heading and depth rules), one History line
  fastify.post('/:scheduleId/indent', {
    preHandler: [requireScope('write'), requireProjectAccess('manager'), heavyActionLimit('task-indent', 120)],
    schema: { description: 'Indent or outdent tasks (one Schedule History change)', tags: ['schedules'] },
  }, async (request: FastifyRequest, reply: FastifyReply) => {
    try {
      const { scheduleId } = request.params as { scheduleId: string };
      const body = indentSchema.parse(request.body);
      const ids = [...new Set(body.taskIds)];
      const all = await scheduleService.findTasksByScheduleId(scheduleId);
      const known = new Set(all.map(t => t.id));
      if (ids.some(id => !known.has(id)) || (body.underTaskId && !known.has(body.underTaskId))) {
        return reply.status(400).send({ error: 'Validation error', message: 'Every task must be in this schedule. Nothing was moved.' });
      }
      const rowOf = computeScheduleRowNumbers(all);
      const plan = planMoves(ids, all, rowOf, { direction: body.direction, underTaskId: body.direction === 'indent' ? body.underTaskId : undefined });
      if ('refuse' in plan) return reply.status(400).send({ error: 'Validation error', message: plan.refuse });
      if (plan.moves.length === 0) return { moved: [], changeId: null };
      const schedule = await scheduleService.findById(scheduleId);
      if (!schedule) return reply.status(404).send({ error: 'Not found', message: 'Schedule not found' });
      const n = plan.moves.length;
      const rowName = (id: string) => `row ${rowOf.get(id) ?? 0} "${all.find(t => t.id === id)?.name ?? id}"`;
      const { changeId } = await changeHistoryService.reparentTasksWithHistory({
        projectId: schedule.projectId, scheduleId, moves: plan.moves,
        summary: `${body.direction === 'indent' ? 'Indented' : 'Outdented'} ${n} task${n === 1 ? '' : 's'} ${plan.target ? `under ${rowName(plan.target)}` : 'up one level'}: ${plan.moves.map(m => `row ${rowOf.get(m.id)}`).join(', ')}`,
      });
      return { moved: plan.moves.map(m => ({ taskId: m.id, newParentId: m.parentId })), changeId };
    } catch (error: any) {
      if (error instanceof z.ZodError) return reply.status(400).send({ error: 'Validation error', message: 'Say which tasks and whether to indent or outdent.' });
      if (error?.refused === true) return reply.status(400).send({ error: 'Validation error', message: nothingMoved(error.message) });
      logger.error('Indent error', { error });
      return reply.status(500).send({ error: 'Internal server error', message: 'The change was not saved. Nothing was moved; please try again.' });
    }
  });
}
