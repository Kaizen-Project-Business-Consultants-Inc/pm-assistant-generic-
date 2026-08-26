import { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import { z } from 'zod';
import { v4 as uuidv4 } from 'uuid';
import { authMiddleware } from '../../middleware/auth';
import { requireScope } from '../../middleware/requireScope';
import { databaseService } from '../../database/connection';
import { emailService } from '../../services/EmailService';
import { rateLimiter } from '../../middleware/rateLimiter';
import logger from '../../utils/logger';

const MAX_SCREENSHOT_BYTES = 5 * 1024 * 1024; // 5MB

const submitFeedbackSchema = z.object({
  overallRating: z.number().int().min(1).max(5),
  scheduleRating: z.number().int().min(1).max(5).nullable().optional(),
  raidRating: z.number().int().min(1).max(5).nullable().optional(),
  aiRating: z.number().int().min(1).max(5).nullable().optional(),
  reportingRating: z.number().int().min(1).max(5).nullable().optional(),
  category: z.enum(['bug', 'feature_request', 'general']).default('general'),
  comment: z.string().max(5000).optional(),
  screenshotData: z.string().optional(),
});

const updateFeedbackSchema = z.object({
  status: z.enum(['new', 'reviewed', 'resolved']).optional(),
  adminNotes: z.string().max(5000).optional(),
  adminReply: z.string().max(5000).optional(),
});

export async function feedbackRoutes(fastify: FastifyInstance) {
  fastify.addHook('preHandler', authMiddleware);

  // POST / — Submit feedback
  fastify.post('/', { preHandler: [requireScope('read')] }, async (request: FastifyRequest, reply: FastifyReply) => {
    try {
      const userId = request.user!.userId;

      // Rate limit: 3 feedback submissions per hour
      const rl = rateLimiter.check(`feedback:${userId}`, 3, 3600_000);
      if (!rl.allowed) {
        return reply.status(429).send({ error: 'Too many submissions. Please try again later.' });
      }

      const body = submitFeedbackSchema.parse(request.body);

      // Validate screenshot if provided
      let screenshotData: string | null = null;
      if (body.screenshotData) {
        if (!body.screenshotData.match(/^data:image\/(png|jpeg|jpg|gif|webp);base64,/)) {
          return reply.status(400).send({ error: 'Invalid screenshot format. Must be a base64-encoded image.' });
        }
        const base64Part = body.screenshotData.split(',')[1] || '';
        const byteSize = Math.ceil(base64Part.length * 3 / 4);
        if (byteSize > MAX_SCREENSHOT_BYTES) {
          return reply.status(400).send({ error: 'Screenshot too large. Maximum 5MB.' });
        }
        screenshotData = body.screenshotData;
      }

      const id = uuidv4();

      await databaseService.queryControlPlane(
        `INSERT INTO feedback (id, user_id, overall_rating, schedule_rating, raid_rating, ai_rating, reporting_rating, category, comment, screenshot_data)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [id, userId, body.overallRating, body.scheduleRating ?? null, body.raidRating ?? null, body.aiRating ?? null, body.reportingRating ?? null, body.category, body.comment ?? null, screenshotData],
      );

      // Notify admin via email (fire-and-forget)
      const alertEmail = process.env.ALERT_EMAIL;
      if (alertEmail) {
        const commentSnippet = body.comment ? body.comment.slice(0, 200) : '(no comment)';
        emailService.sendNotificationEmail(
          alertEmail,
          `New Feedback (${body.overallRating}/5 stars)`,
          'User Feedback Received',
          `Overall: ${body.overallRating}/5 | Category: ${body.category}\n${commentSnippet}`,
          `${process.env.APP_URL || 'https://pm.kpbc.ca'}/admin/feedback`,
          'View Feedback',
        ).catch(err => logger.warn('Failed to send feedback notification email', { error: err }));
      }

      return reply.status(201).send({ id, message: 'Thank you for your feedback!' });
    } catch (error) {
      if (error instanceof z.ZodError) {
        return reply.status(400).send({ error: 'Validation error', details: error.issues });
      }
      logger.error('Submit feedback error', { error });
      return reply.status(500).send({ error: 'Failed to submit feedback' });
    }
  });

  // GET /mine — User's own feedback submissions
  fastify.get('/mine', { preHandler: [requireScope('read')] }, async (request: FastifyRequest, reply: FastifyReply) => {
    try {
      const userId = request.user!.userId;

      const rows = await databaseService.queryControlPlane(
        `SELECT id, category, comment, overall_rating, status,
                admin_reply, admin_reply_at,
                screenshot_data IS NOT NULL AS has_screenshot,
                created_at, updated_at
         FROM feedback
         WHERE user_id = ?
         ORDER BY created_at DESC
         LIMIT 50`,
        [userId],
      );

      return {
        feedback: (rows as any[]).map(r => ({
          id: r.id,
          category: r.category,
          comment: r.comment,
          overallRating: r.overall_rating,
          status: r.status,
          adminReply: r.admin_reply,
          adminReplyAt: r.admin_reply_at,
          hasScreenshot: !!r.has_screenshot,
          createdAt: r.created_at,
          updatedAt: r.updated_at,
        })),
      };
    } catch (error) {
      logger.error('Get my feedback error', { error });
      return reply.status(500).send({ error: 'Failed to get feedback' });
    }
  });

  // GET /:id/screenshot — Get screenshot data for a specific feedback item (owner only)
  fastify.get('/:id/screenshot', { preHandler: [requireScope('read')] }, async (request: FastifyRequest, reply: FastifyReply) => {
    try {
      const userId = request.user!.userId;
      const { id } = request.params as { id: string };
      const isAdmin = request.user!.role === 'admin';

      const rows = await databaseService.queryControlPlane(
        `SELECT screenshot_data, user_id FROM feedback WHERE id = ?`,
        [id],
      ) as any[];

      if (!rows.length) {
        return reply.status(404).send({ error: 'Feedback not found' });
      }

      // Only the owner or admin can view the screenshot
      if (rows[0].user_id !== userId && !isAdmin) {
        return reply.status(403).send({ error: 'Access denied' });
      }

      if (!rows[0].screenshot_data) {
        return reply.status(404).send({ error: 'No screenshot attached' });
      }

      return { screenshotData: rows[0].screenshot_data };
    } catch (error) {
      logger.error('Get feedback screenshot error', { error });
      return reply.status(500).send({ error: 'Failed to get screenshot' });
    }
  });

  // GET / — List all feedback (admin only)
  fastify.get('/', { preHandler: [requireScope('admin')] }, async (request: FastifyRequest, reply: FastifyReply) => {
    try {
      const { status, limit = '50', offset = '0' } = request.query as { status?: string; limit?: string; offset?: string };

      let sql = `SELECT f.id, f.user_id, f.overall_rating, f.schedule_rating, f.raid_rating, f.ai_rating, f.reporting_rating,
                        f.category, f.comment, f.status, f.admin_notes, f.admin_reply, f.admin_reply_at,
                        f.screenshot_data IS NOT NULL AS has_screenshot,
                        f.created_at,
                        u.username, u.full_name, u.email as user_email
                 FROM feedback f
                 LEFT JOIN users u ON f.user_id = u.id`;
      const params: any[] = [];

      if (status) {
        sql += ' WHERE f.status = ?';
        params.push(status);
      }

      sql += ' ORDER BY f.created_at DESC LIMIT ? OFFSET ?';
      params.push(parseInt(limit), parseInt(offset));

      const rows = await databaseService.queryControlPlane(sql, params);

      // Get aggregate stats
      const statsRows = await databaseService.queryControlPlane(
        `SELECT
           COUNT(*) as total,
           ROUND(AVG(overall_rating), 1) as avg_overall,
           ROUND(AVG(schedule_rating), 1) as avg_schedule,
           ROUND(AVG(raid_rating), 1) as avg_raid,
           ROUND(AVG(ai_rating), 1) as avg_ai,
           ROUND(AVG(reporting_rating), 1) as avg_reporting,
           SUM(status = 'new') as new_count,
           SUM(status = 'reviewed') as reviewed_count,
           SUM(status = 'resolved') as resolved_count
         FROM feedback`,
      );

      return {
        feedback: (rows as any[]).map(r => ({
          id: r.id,
          userId: r.user_id,
          username: r.username,
          fullName: r.full_name,
          userEmail: r.user_email,
          overallRating: r.overall_rating,
          scheduleRating: r.schedule_rating,
          raidRating: r.raid_rating,
          aiRating: r.ai_rating,
          reportingRating: r.reporting_rating,
          category: r.category,
          comment: r.comment,
          status: r.status,
          adminNotes: r.admin_notes,
          adminReply: r.admin_reply,
          adminReplyAt: r.admin_reply_at,
          hasScreenshot: !!r.has_screenshot,
          createdAt: r.created_at,
        })),
        stats: statsRows[0] || {},
      };
    } catch (error) {
      logger.error('List feedback error', { error });
      return reply.status(500).send({ error: 'Failed to list feedback' });
    }
  });

  // PATCH /:id — Update feedback status/notes/reply (admin only)
  fastify.patch('/:id', { preHandler: [requireScope('admin')] }, async (request: FastifyRequest, reply: FastifyReply) => {
    try {
      const { id } = request.params as { id: string };
      const adminUserId = request.user!.userId;
      const body = updateFeedbackSchema.parse(request.body);

      const updates: string[] = [];
      const params: any[] = [];

      if (body.status) {
        updates.push('status = ?');
        params.push(body.status);
      }
      if (body.adminNotes !== undefined) {
        updates.push('admin_notes = ?');
        params.push(body.adminNotes);
      }
      if (body.adminReply !== undefined) {
        updates.push('admin_reply = ?', 'admin_reply_at = NOW()', 'admin_reply_by = ?');
        params.push(body.adminReply, adminUserId);
      }

      if (updates.length === 0) {
        return reply.status(400).send({ error: 'No updates provided' });
      }

      params.push(id);
      const result = await databaseService.queryControlPlane(`UPDATE feedback SET ${updates.join(', ')} WHERE id = ?`, params) as any;
      if ((result.affectedRows ?? 0) === 0) {
        return reply.status(404).send({ error: 'Feedback not found' });
      }

      // If admin reply was added, notify the feedback author via email (fire-and-forget)
      if (body.adminReply) {
        const feedbackRows = await databaseService.queryControlPlane(
          `SELECT f.comment, f.category, u.email, u.full_name
           FROM feedback f LEFT JOIN users u ON f.user_id = u.id
           WHERE f.id = ?`,
          [id],
        ) as any[];
        if (feedbackRows.length && feedbackRows[0].email) {
          const row = feedbackRows[0];
          emailService.sendNotificationEmail(
            row.email,
            'Your feedback has a response',
            `Hi ${row.full_name || 'there'}`,
            `We've responded to your ${row.category === 'bug' ? 'bug report' : row.category === 'feature_request' ? 'feature request' : 'feedback'}:\n\n"${body.adminReply}"`,
            `${process.env.APP_URL || 'https://kovarti.com'}/my-feedback`,
            'View My Feedback',
          ).catch(err => logger.warn('Failed to send feedback reply email', { error: err }));
        }
      }

      return { message: 'Feedback updated' };
    } catch (error) {
      if (error instanceof z.ZodError) {
        return reply.status(400).send({ error: 'Validation error', details: error.issues });
      }
      logger.error('Update feedback error', { error });
      return reply.status(500).send({ error: 'Failed to update feedback' });
    }
  });
}
