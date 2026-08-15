import { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import { z } from 'zod';
import { expenseService } from '../../services/ExpenseService';
import { authMiddleware } from '../../middleware/auth';
import { requireScope } from '../../middleware/requireScope';

const EXPENSE_CATEGORIES = ['labor', 'materials', 'software', 'hardware', 'travel', 'contractors', 'training', 'consulting', 'licenses', 'other'] as const;

const createExpenseSchema = z.object({
  projectId: z.string().min(1),
  date: z.string().min(1),
  amount: z.number().positive(),
  category: z.enum(EXPENSE_CATEGORIES),
  vendor: z.string().max(255).optional(),
  description: z.string().max(2000).optional(),
});

const updateExpenseSchema = z.object({
  date: z.string().optional(),
  amount: z.number().positive().optional(),
  category: z.enum(EXPENSE_CATEGORIES).optional(),
  vendor: z.string().max(255).optional(),
  description: z.string().max(2000).optional(),
});

export async function expenseRoutes(fastify: FastifyInstance) {
  fastify.addHook('preHandler', authMiddleware);

  // POST / — create expense
  fastify.post('/', { preHandler: [requireScope('write')] }, async (request: FastifyRequest, reply: FastifyReply) => {
    try {
      const user = request.user!;
      const body = createExpenseSchema.parse(request.body);
      const expense = await expenseService.create({ ...body, createdBy: user.userId });
      return { expense };
    } catch (error: any) {
      if (error.name === 'ZodError') return reply.status(400).send({ error: 'Invalid expense data', details: error.errors });
      return reply.status(500).send({ error: 'Failed to create expense' });
    }
  });

  // GET /project/:projectId — list expenses
  fastify.get('/project/:projectId', { preHandler: [requireScope('read')] }, async (request: FastifyRequest, reply: FastifyReply) => {
    try {
      const { projectId } = request.params as { projectId: string };
      const { startDate, endDate } = request.query as { startDate?: string; endDate?: string };
      const expenses = await expenseService.getByProject(projectId, startDate, endDate);
      return { expenses };
    } catch {
      return reply.status(500).send({ error: 'Failed to fetch expenses' });
    }
  });

  // GET /project/:projectId/summary — category breakdown
  fastify.get('/project/:projectId/summary', { preHandler: [requireScope('read')] }, async (request: FastifyRequest, reply: FastifyReply) => {
    try {
      const { projectId } = request.params as { projectId: string };
      const categories = await expenseService.getSummaryByCategory(projectId);
      const monthly = await expenseService.getMonthlySpend(projectId);
      return { categories, monthly };
    } catch {
      return reply.status(500).send({ error: 'Failed to fetch expense summary' });
    }
  });

  // PUT /:id — update expense
  fastify.put('/:id', { preHandler: [requireScope('write')] }, async (request: FastifyRequest, reply: FastifyReply) => {
    try {
      const { id } = request.params as { id: string };
      const body = updateExpenseSchema.parse(request.body);
      const expense = await expenseService.update(id, body);
      if (!expense) return reply.status(404).send({ error: 'Expense not found' });
      return { expense };
    } catch (error: any) {
      if (error.name === 'ZodError') return reply.status(400).send({ error: 'Invalid data', details: error.errors });
      return reply.status(500).send({ error: 'Failed to update expense' });
    }
  });

  // DELETE /:id — delete expense
  fastify.delete('/:id', { preHandler: [requireScope('write')] }, async (request: FastifyRequest, reply: FastifyReply) => {
    try {
      const { id } = request.params as { id: string };
      const deleted = await expenseService.delete(id);
      if (!deleted) return reply.status(404).send({ error: 'Expense not found' });
      return { message: 'Expense deleted' };
    } catch {
      return reply.status(500).send({ error: 'Failed to delete expense' });
    }
  });
}
