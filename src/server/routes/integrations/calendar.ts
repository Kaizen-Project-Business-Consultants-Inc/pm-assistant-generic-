import { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import crypto from 'crypto';
import { z } from 'zod';
import { googleCalendarAdapter } from '../../services/integrations/GoogleCalendarAdapter';
import { calendarSyncService } from '../../services/integrations/CalendarSyncService';
import { integrationRepository, parseConfig } from '../../database/IntegrationRepository';
import { databaseService } from '../../database/connection';
import { authMiddleware } from '../../middleware/auth';
import { requireScope } from '../../middleware/requireScope';
import { config } from '../../config';
import logger from '../../utils/logger';

export async function googleCalendarRoutes(fastify: FastifyInstance) {
  // GET /callback — OAuth callback (called by Google redirect, NO auth — must be before addHook)
  fastify.get('/callback', {
    schema: { description: 'Google Calendar OAuth callback', tags: ['calendar'] },
  }, async (request: FastifyRequest, reply: FastifyReply) => {
    const { code, state, error: oauthError } = request.query as { code?: string; state?: string; error?: string };

    if (oauthError) {
      return reply.redirect(`${config.APP_URL}/oauth/callback?error=${encodeURIComponent(oauthError)}`);
    }

    if (!code || !state) {
      return reply.redirect(`${config.APP_URL}/oauth/callback?error=missing_params`);
    }

    try {
      const userId = state.split(':')[1];
      if (!userId) throw new Error('Invalid state');

      const redirectUri = `${config.APP_URL}/api/v1/calendar/callback`;
      const token = await googleCalendarAdapter.exchangeCode(code, redirectUri);

      const existing = await databaseService.query(
        "SELECT id FROM integrations WHERE user_id = ? AND provider = 'google_calendar' LIMIT 1",
        [userId],
      ) as any[];

      const integConfig: Record<string, any> = {
        accessToken: token.access_token,
        refreshToken: token.refresh_token,
        tokenExpiresAt: Date.now() + token.expires_in * 1000,
        calendarId: 'primary',
        syncDirection: 'both',
      };

      if (existing.length > 0) {
        await integrationRepository.updateIntegration(existing[0].id, { config: integConfig, isActive: true });
      } else {
        await integrationRepository.create(userId, 'google_calendar', integConfig);
      }

      return reply.redirect(`${config.APP_URL}/oauth/callback?success=true&provider=google_calendar`);
    } catch (err: any) {
      logger.error('Google Calendar OAuth callback failed', { error: err.message });
      return reply.redirect(`${config.APP_URL}/oauth/callback?error=${encodeURIComponent(err.message)}`);
    }
  });

  // All remaining routes require auth
  fastify.addHook('preHandler', authMiddleware);

  // GET /connect — returns OAuth URL
  fastify.get('/connect', {
    preHandler: [requireScope('write')],
    schema: { description: 'Initiate Google Calendar OAuth flow', tags: ['calendar'] },
  }, async (request: FastifyRequest, reply: FastifyReply) => {
    if (!googleCalendarAdapter.isConfigured) {
      return reply.status(501).send({ error: 'Google Calendar integration is not configured' });
    }

    const state = crypto.randomBytes(16).toString('hex') + ':' + request.user!.userId;
    const redirectUri = `${config.APP_URL}/api/v1/calendar/callback`;
    const url = googleCalendarAdapter.buildAuthUrl({ redirectUri, state });
    return { url, state };
  });

  // GET /calendars — list user's calendars
  fastify.get('/calendars', {
    preHandler: [requireScope('read')],
    schema: { description: 'List user Google Calendars', tags: ['calendar'] },
  }, async (request: FastifyRequest, reply: FastifyReply) => {
    try {
      const userId = request.user!.userId;
      const [integ] = await databaseService.query(
        "SELECT * FROM integrations WHERE user_id = ? AND provider = 'google_calendar' AND is_active = 1 LIMIT 1",
        [userId],
      ) as any[];

      if (!integ) return reply.status(404).send({ error: 'No active Google Calendar integration' });

      const cfg = parseConfig(integ.config);
      // Refresh token if needed
      let accessToken = cfg.accessToken;
      if (!accessToken || Date.now() > (cfg.tokenExpiresAt || 0) - 60000) {
        const refreshed = await googleCalendarAdapter.refreshToken(cfg.refreshToken);
        accessToken = refreshed.access_token;
        cfg.accessToken = accessToken;
        cfg.tokenExpiresAt = Date.now() + refreshed.expires_in * 1000;
        await integrationRepository.updateIntegration(integ.id, { config: cfg });
      }

      const calendars = await googleCalendarAdapter.listCalendars(accessToken);
      return { calendars };
    } catch (err) {
      logger.error('List calendars error', { error: err });
      return reply.status(500).send({ error: 'Failed to list calendars' });
    }
  });

  // POST /sync — manual trigger full sync
  fastify.post('/sync', {
    preHandler: [requireScope('write')],
    schema: { description: 'Trigger calendar sync', tags: ['calendar'] },
  }, async (request: FastifyRequest, reply: FastifyReply) => {
    try {
      const result = await calendarSyncService.syncUserCalendar(request.user!.userId);
      return { message: 'Sync completed', ...result };
    } catch (err) {
      logger.error('Calendar sync error', { error: err });
      return reply.status(500).send({ error: 'Calendar sync failed' });
    }
  });

  // POST /link-task — link a task to a calendar event
  fastify.post('/link-task', {
    preHandler: [requireScope('write')],
    schema: { description: 'Push a task to Google Calendar', tags: ['calendar'] },
  }, async (request: FastifyRequest, reply: FastifyReply) => {
    const { taskId, name, startDate, endDate, dueDate, description } = z.object({
      taskId: z.string().min(1),
      name: z.string().min(1),
      startDate: z.string().optional(),
      endDate: z.string().optional(),
      dueDate: z.string().optional(),
      description: z.string().optional(),
    }).parse(request.body);

    try {
      await calendarSyncService.pushTaskToCalendar(
        { id: taskId, name, description, startDate, endDate, dueDate },
        request.user!.userId,
      );
      return { message: 'Task linked to calendar' };
    } catch (err) {
      logger.error('Link task error', { error: err });
      return reply.status(500).send({ error: 'Failed to link task to calendar' });
    }
  });

  // DELETE /unlink-task/:taskId — remove link
  fastify.delete('/unlink-task/:taskId', {
    preHandler: [requireScope('write')],
    schema: { description: 'Unlink a task from Google Calendar', tags: ['calendar'] },
  }, async (request: FastifyRequest, reply: FastifyReply) => {
    const { taskId } = request.params as { taskId: string };
    try {
      await calendarSyncService.unlinkTask(taskId);
      return { message: 'Task unlinked from calendar' };
    } catch (err) {
      logger.error('Unlink task error', { error: err });
      return reply.status(500).send({ error: 'Failed to unlink task' });
    }
  });

  // POST /settings — update calendar settings (which calendar, sync direction)
  fastify.post('/settings', {
    preHandler: [requireScope('write')],
    schema: { description: 'Update calendar sync settings', tags: ['calendar'] },
  }, async (request: FastifyRequest, reply: FastifyReply) => {
    const { calendarId, syncDirection } = z.object({
      calendarId: z.string().optional(),
      syncDirection: z.enum(['push', 'pull', 'both']).optional(),
    }).parse(request.body);

    try {
      const userId = request.user!.userId;
      const [integ] = await databaseService.query(
        "SELECT * FROM integrations WHERE user_id = ? AND provider = 'google_calendar' AND is_active = 1 LIMIT 1",
        [userId],
      ) as any[];

      if (!integ) return reply.status(404).send({ error: 'No active Google Calendar integration' });

      const cfg = parseConfig(integ.config);
      if (calendarId) cfg.calendarId = calendarId;
      if (syncDirection) cfg.syncDirection = syncDirection;
      await integrationRepository.updateIntegration(integ.id, { config: cfg });

      return { message: 'Settings updated' };
    } catch (err) {
      logger.error('Calendar settings error', { error: err });
      return reply.status(500).send({ error: 'Failed to update settings' });
    }
  });

  // DELETE /disconnect — disconnect Google Calendar
  fastify.delete('/disconnect', {
    preHandler: [requireScope('write')],
    schema: { description: 'Disconnect Google Calendar', tags: ['calendar'] },
  }, async (request: FastifyRequest, reply: FastifyReply) => {
    try {
      const userId = request.user!.userId;
      const [integ] = await databaseService.query(
        "SELECT id FROM integrations WHERE user_id = ? AND provider = 'google_calendar' LIMIT 1",
        [userId],
      ) as any[];

      if (integ) {
        await integrationRepository.updateIntegration(integ.id, { isActive: false });
      }
      return { message: 'Google Calendar disconnected' };
    } catch (err) {
      logger.error('Calendar disconnect error', { error: err });
      return reply.status(500).send({ error: 'Failed to disconnect' });
    }
  });
}
