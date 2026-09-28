import { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import { requireProjectAccess } from '../../middleware/requireProjectAccess';
import { authMiddleware } from '../../middleware/auth';
import { requireScope } from '../../middleware/requireScope';
import { standupSummaryService } from '../../services/StandupSummaryService';
import { emailService } from '../../services/EmailService';
import { databaseService } from '../../database/connection';
import logger from '../../utils/logger';

export async function standupRoutes(fastify: FastifyInstance) {
  fastify.addHook('preHandler', authMiddleware);

  // Get standup summary for a project
  fastify.get('/project/:projectId', { preHandler: [requireScope('read'), requireProjectAccess('viewer')] }, async (request: FastifyRequest, reply: FastifyReply) => {
    try {
      const user = request.user!;
      if (!user?.userId) return reply.status(401).send({ error: 'Unauthorized' });

      const { projectId } = request.params as { projectId: string };
      const { refresh } = request.query as { refresh?: string };
      const forceRefresh = refresh === 'true';

      const summary = await standupSummaryService.getStandupSummary(projectId, user.userId, forceRefresh);
      return { data: summary };
    } catch (error) {
      logger.error('Standup summary error', { error });
      return reply.status(500).send({ error: 'Failed to generate standup summary' });
    }
  });

  // Email standup summary for a project
  fastify.get('/project/:projectId/email', { preHandler: [requireScope('write'), requireProjectAccess('manager')] }, async (request: FastifyRequest, reply: FastifyReply) => {
    try {
      const user = request.user!;
      if (!user?.userId) return reply.status(401).send({ error: 'Unauthorized' });

      const { projectId } = request.params as { projectId: string };

      // Lookup user email from DB
      const users = await databaseService.queryControlPlane<any>(
        `SELECT email FROM users WHERE id = ? LIMIT 1`,
        [user.userId],
      );
      if (!users.length || !users[0].email) {
        return reply.status(400).send({ error: 'No email address on file' });
      }

      const summary = await standupSummaryService.getStandupSummary(projectId, user.userId);
      await emailService.sendStandupEmail(users[0].email, summary.changes, summary.narrative);
      return { data: { sent: true } };
    } catch (error) {
      logger.error('Standup email error', { error });
      return reply.status(500).send({ error: 'Failed to send standup email' });
    }
  });
}
