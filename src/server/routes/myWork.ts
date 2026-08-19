import { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import { authMiddleware } from '../middleware/auth';
import { requireScope } from '../middleware/requireScope';
import { myWorkService } from '../services/MyWorkService';

export async function myWorkRoutes(fastify: FastifyInstance) {
  fastify.addHook('preHandler', authMiddleware);

  fastify.get('/', { preHandler: [requireScope('read')] }, async (request: FastifyRequest, reply: FastifyReply) => {
    const user = request.user!;
    if (!user?.userId) return reply.status(401).send({ error: 'Unauthorized' });

    try {
      const result = await myWorkService.getMyWork(user.userId);
      return result;
    } catch (err: any) {
      request.log.error({ err: err.message, stack: err.stack }, 'my-work failed');
      return reply.status(500).send({ error: 'Internal server error', message: err.message });
    }
  });
}
