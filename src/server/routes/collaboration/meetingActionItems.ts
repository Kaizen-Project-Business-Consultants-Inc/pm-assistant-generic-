import { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import { authMiddleware } from '../../middleware/auth';
import { requireScope } from '../../middleware/requireScope';
import { meetingActionItemService } from '../../services/MeetingActionItemService';
import { requireProjectAccess } from '../../middleware/requireProjectAccess';
import { meetingRepository } from '../../database/MeetingRepository';

/**
 * Meeting action items — READ-ONLY HISTORY (Oct 2026).
 *
 * Meeting actions now live in the RAID log (project_risks, type 'action', source 'meeting'),
 * where only the project manager adds them. The old list is kept so past items can still be
 * looked up, but nothing creates, edits, completes or cancels them any more. Old rows are not
 * copied into RAID — only a project manager adds to RAID.
 */
const meetingProject = async (meetingId?: string) => (meetingId ? (await meetingRepository.findById(meetingId))?.projectId ?? null : null);
const listMember = requireProjectAccess('viewer', {
  resolve: async (req) => {
    const q = req.query as { projectId?: string; meetingId?: string };
    return q.meetingId ? meetingProject(q.meetingId) : q.projectId ?? null;
  },
});
const itemMember = requireProjectAccess('viewer', {
  resolve: async (req) => (await meetingActionItemService.getItem((req.params as { id: string }).id))?.projectId ?? null,
});

export async function meetingActionItemRoutes(fastify: FastifyInstance) {
  fastify.addHook('preHandler', authMiddleware);

  // GET / — list past action items (filter by projectId or meetingId, status, assigneeUserId, overdue)
  fastify.get('/', { preHandler: [requireScope('read'), listMember] }, async (request: FastifyRequest, reply: FastifyReply) => {
    const { projectId, meetingId, status, assigneeUserId, overdue } = request.query as {
      projectId?: string; meetingId?: string; status?: string;
      assigneeUserId?: string; overdue?: string;
    };

    if (meetingId) {
      const items = await meetingActionItemService.getItemsByMeeting(meetingId);
      return { items };
    }
    if (!projectId) return reply.status(400).send({ error: 'projectId required', message: 'Choose a project or a meeting.' });

    const items = await meetingActionItemService.getItemsByProject(projectId, {
      status,
      assigneeUserId,
      overdue: overdue === 'true',
    });
    return { items };
  });

  // GET /:id — one past action item
  fastify.get('/:id', { preHandler: [requireScope('read'), itemMember] }, async (request: FastifyRequest, reply: FastifyReply) => {
    const { id } = request.params as { id: string };
    const item = await meetingActionItemService.getItem(id);
    if (!item) return reply.status(404).send({ error: 'Action item not found' });
    return item;
  });
}
