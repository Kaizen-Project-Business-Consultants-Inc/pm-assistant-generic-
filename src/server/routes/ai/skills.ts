import { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import { authMiddleware } from '../../middleware/auth';
import { requireScope } from '../../middleware/requireScope';
import { skillRegistryService } from '../../services/context/SkillRegistryService';

export async function skillRoutes(fastify: FastifyInstance) {
  fastify.addHook('preHandler', authMiddleware);

  // GET /api/v1/skills — list skills (front-matter only, filtered by role)
  fastify.get('/', {
    preHandler: [requireScope('read')],
    schema: { description: 'List available skills', tags: ['skills'] },
  }, async (request: FastifyRequest, reply: FastifyReply) => {
    try {
      const user = (request as any).user;
      const skills = await skillRegistryService.getSkillsForRole(user.role);
      return { skills };
    } catch (err) {
      fastify.log.error({ err }, 'Failed to list skills');
      return reply.status(500).send({ error: 'Failed to list skills' });
    }
  });

  // GET /api/v1/skills/:id — get full skill detail
  fastify.get('/:id', {
    preHandler: [requireScope('read')],
    schema: { description: 'Get full skill detail', tags: ['skills'] },
  }, async (request: FastifyRequest, reply: FastifyReply) => {
    try {
      const { id } = request.params as { id: string };
      const skill = await skillRegistryService.getSkillDetail(id);
      if (!skill) {
        return reply.status(404).send({ error: 'Skill not found' });
      }
      return { skill };
    } catch (err) {
      fastify.log.error({ err }, 'Failed to get skill');
      return reply.status(500).send({ error: 'Failed to get skill' });
    }
  });

  // POST /api/v1/skills — create skill (admin)
  fastify.post('/', {
    preHandler: [requireScope('admin')],
    schema: { description: 'Create a new skill', tags: ['skills'] },
  }, async (request: FastifyRequest, reply: FastifyReply) => {
    try {
      const body = request.body as {
        skillName: string;
        category?: string;
        summary: string;
        detailedProcedure?: string;
        applicableRoles?: string[];
      };
      const user = (request as any).user;

      if (!body.skillName || !body.summary) {
        return reply.status(400).send({ error: 'skillName and summary are required' });
      }

      const skill = await skillRegistryService.createSkill(body, user.id);
      return reply.status(201).send({ skill });
    } catch (err) {
      fastify.log.error({ err }, 'Failed to create skill');
      return reply.status(500).send({ error: 'Failed to create skill' });
    }
  });

  // PUT /api/v1/skills/:id — update skill (admin)
  fastify.put('/:id', {
    preHandler: [requireScope('admin')],
    schema: { description: 'Update a skill', tags: ['skills'] },
  }, async (request: FastifyRequest, reply: FastifyReply) => {
    try {
      const { id } = request.params as { id: string };
      const body = request.body as {
        skillName?: string;
        category?: string;
        summary?: string;
        detailedProcedure?: string;
        applicableRoles?: string[];
        isActive?: boolean;
      };

      const skill = await skillRegistryService.updateSkill(id, body);
      if (!skill) {
        return reply.status(404).send({ error: 'Skill not found' });
      }
      return { skill };
    } catch (err) {
      fastify.log.error({ err }, 'Failed to update skill');
      return reply.status(500).send({ error: 'Failed to update skill' });
    }
  });
}
