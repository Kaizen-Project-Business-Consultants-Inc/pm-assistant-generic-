import { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import { z } from 'zod';
import { v4 as uuidv4 } from 'uuid';
import { timingSafeEqual } from 'crypto';
import { databaseService } from '../../database/connection';
import { rateLimiter } from '../../middleware/rateLimiter';
import { emailService } from '../../services/EmailService';
import { config } from '../../config';

const joinSchema = z.object({
  email: z.string().email(),
});

export async function waitlistRoutes(fastify: FastifyInstance) {
  fastify.post('/', async (request: FastifyRequest, reply: FastifyReply) => {
    // Rate limit: 5 joins per minute per IP
    const ip = request.ip || 'unknown';
    const rl = rateLimiter.check(`waitlist:join:${ip}`, 5, 60_000);
    if (!rl.allowed) {
      return reply.status(429).send({ error: 'Too many requests. Please try again later.' });
    }

    const result = joinSchema.safeParse(request.body);
    if (!result.success) {
      return reply.status(400).send({ error: 'Valid email required' });
    }

    const { email } = result.data;

    try {
      const cleanEmail = email.toLowerCase().trim();
      await databaseService.query(
        'INSERT INTO waitlist (id, email) VALUES (?, ?)',
        [uuidv4(), cleanEmail]
      );

      // Fire-and-forget notification to sales
      emailService.sendWaitlistNotification(cleanEmail).catch((err) => {
        fastify.log.error(err, 'Failed to send waitlist notification email');
      });

      return reply.status(201).send({ message: 'You\'re on the list!' });
    } catch (err: any) {
      if (err?.code === 'ER_DUP_ENTRY') {
        return reply.status(200).send({ message: 'You\'re already on the list!' });
      }
      fastify.log.error(err);
      return reply.status(500).send({ error: 'Something went wrong. Please try again.' });
    }
  });

  fastify.get('/count', async (request: FastifyRequest, reply: FastifyReply) => {
    // Rate limit: 30 requests per minute per IP
    const ip = request.ip || 'unknown';
    const rl = rateLimiter.check(`waitlist:count:${ip}`, 30, 60_000);
    if (!rl.allowed) {
      return reply.status(429).send({ error: 'Too many requests. Please try again later.' });
    }

    const rows = await databaseService.query<any>('SELECT COUNT(*) as count FROM waitlist');
    return reply.send({ count: rows[0]?.count ?? 0 });
  });

  fastify.get('/admin', async (request: FastifyRequest, reply: FastifyReply) => {
    const adminKey = process.env.WAITLIST_ADMIN_KEY;
    if (!adminKey) return reply.status(503).send({ error: 'Waitlist admin not configured' });
    const key = request.headers['x-admin-key'] as string | undefined;
    if (!key || key.length !== adminKey.length || !timingSafeEqual(Buffer.from(key), Buffer.from(adminKey))) {
      return reply.status(401).send({ error: 'Unauthorized' });
    }
    const rows = await databaseService.query<any>(
      'SELECT email, created_at FROM waitlist ORDER BY created_at DESC'
    );
    return reply.send({ count: rows.length, entries: rows });
  });

  fastify.get('/admin/export', async (request: FastifyRequest, reply: FastifyReply) => {
    const adminKey = process.env.WAITLIST_ADMIN_KEY;
    if (!adminKey) return reply.status(503).send({ error: 'Waitlist admin not configured' });
    const key = request.headers['x-admin-key'] as string | undefined;
    if (!key || key.length !== adminKey.length || !timingSafeEqual(Buffer.from(key), Buffer.from(adminKey))) {
      return reply.status(401).send({ error: 'Unauthorized' });
    }
    const rows = await databaseService.query<any>(
      'SELECT email, created_at FROM waitlist ORDER BY created_at ASC'
    );
    const csv = ['email,joined_at', ...rows.map((r: any) => `${r.email},${r.created_at}`)].join('\n');
    reply.header('Content-Type', 'text/csv');
    reply.header('Content-Disposition', 'attachment; filename="waitlist.csv"');
    return reply.send(csv);
  });
}
